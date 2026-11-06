import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createUpdateController, createDesktopUpdateController, INITIAL_CHECK_DELAY_MS, CHECK_INTERVAL_MS } from '../electron/updater.mjs';
import { isAllowedUpdateUrl, sanitizeUpdateHeaders, secureUpdateSession, UPDATE_FEED, UPDATE_RELEASE_URL } from '../electron/updater-policy.mjs';

class MockUpdater extends EventEmitter {
  feed;
  checks = 0;
  downloads = 0;
  installs = [];
  checkAction = async () => { this.emit('update-not-available', { version: '1.0.1' }); };
  setFeedURL(feed) { this.feed = feed; }
  checkForUpdates() { this.checks += 1; return this.checkAction(); }
  async downloadUpdate() { this.downloads += 1; this.emit('update-downloaded', { version: '1.0.2' }); return []; }
  quitAndInstall(...args) { this.installs.push(args); }
}

test('display labels remain separate from numeric update versions through download and reset', () => {
  const updater = new MockUpdater();
  const controller = createUpdateController({ currentVersion: '1.0.5', currentDisplayVersion: '1.0.4b', updater });
  assert.equal(controller.getState().currentVersion, '1.0.5');
  assert.equal(controller.getState().currentDisplayVersion, '1.0.4b');
  updater.emit('update-available', { version: '1.0.6', releaseName: 'PhoneGest Barcode Studio 1.0.4c' });
  assert.equal(controller.getState().availableVersion, '1.0.6');
  assert.equal(controller.getState().availableDisplayVersion, '1.0.4c');
  updater.emit('download-progress', { percent: 70 });
  updater.emit('update-downloaded', { version: '1.0.6' });
  assert.equal(controller.getState().availableVersion, '1.0.6');
  assert.equal(controller.getState().availableDisplayVersion, '1.0.4c');
  updater.emit('update-not-available', { version: '1.0.5' });
  assert.equal(controller.getState().availableVersion, undefined);
  assert.equal(controller.getState().availableDisplayVersion, undefined);
  assert.equal(controller.getState().currentDisplayVersion, '1.0.4b');
  controller.dispose();
});

test('older numeric clients can receive a labelled release and malformed names safely fall back', () => {
  const updater = new MockUpdater();
  const controller = createUpdateController({ currentVersion: '1.0.4', updater });
  updater.emit('update-available', { version: '1.0.5', releaseName: '1.0.4b' });
  assert.equal(controller.getState().currentVersion, '1.0.4');
  assert.equal(controller.getState().currentDisplayVersion, '1.0.4');
  assert.equal(controller.getState().availableVersion, '1.0.5');
  assert.equal(controller.getState().availableDisplayVersion, '1.0.4b');
  updater.emit('update-available', { version: '1.0.6', releaseName: '<script>private remote text</script>' });
  assert.equal(controller.getState().availableDisplayVersion, '1.0.6');
  updater.emit('update-downloaded', { version: '1.0.7', releaseName: '1.0.4d' });
  assert.equal(controller.getState().availableVersion, '1.0.7');
  assert.equal(controller.getState().availableDisplayVersion, '1.0.4d');
  assert.equal(JSON.stringify(controller.getState()).includes('private remote text'), false);
  controller.dispose();
});

test('unsupported desktop editions retain their configured display label without network access', () => {
  const controller = createDesktopUpdateController({ app: { isPackaged: false, getVersion: () => '1.0.5' }, currentDisplayVersion: '1.0.4b' });
  assert.equal(controller.getState().status, 'unsupported');
  assert.equal(controller.getState().currentVersion, '1.0.5');
  assert.equal(controller.getState().currentDisplayVersion, '1.0.4b');
  controller.dispose();
});

test('update policy permits only this public repository and its release CDN redirects', () => {
  for (const url of [
    `${UPDATE_RELEASE_URL}`,
    'https://github.com/ImPaul17/phonegest-barcode-studio/releases.atom',
    'https://github.com/ImPaul17/phonegest-barcode-studio/releases/tag/v1.0.1',
    'https://github.com/ImPaul17/phonegest-barcode-studio/releases/tag/1.0.2',
    'https://github.com/ImPaul17/phonegest-barcode-studio/releases/download/v1.0.2/latest.yml',
    'https://github.com/ImPaul17/phonegest-barcode-studio/releases/download/v1.0.2/PhoneGest-Barcode-Studio-1.0.2-Instalador.exe',
    'https://api.github.com/repos/ImPaul17/phonegest-barcode-studio/releases/latest',
    'https://release-assets.githubusercontent.com/github-production-release-asset/123/asset?sig=temporary',
    'https://objects.githubusercontent.com/github-production-release-asset-2e65be/123/asset',
  ]) assert.equal(isAllowedUpdateUrl(url), true, url);
  for (const url of [
    'http://github.com/ImPaul17/phonegest-barcode-studio/releases/latest',
    'https://github.com/another/project/releases/latest',
    'https://github.com/another/project/releases/tag/v1.0.1',
    'https://github.com/ImPaul17/phonegest-barcode-studio/releases/tag/feature',
    'https://github.com/ImPaul17/phonegest-barcode-studio/releases/tag/v1.0.2-beta.1',
    'https://github.com/ImPaul17/phonegest-barcode-studio/releases/tag/v01.0.1',
    'https://github.com/ImPaul17/phonegest-barcode-studio/releases/tag/v1.0.1/other',
    'https://github.com/ImPaul17/phonegest-barcode-studio/issues',
    'https://github.com/ImPaul17/phonegest-barcode-studio/releases/download/v1.0.2/other.exe',
    'https://github.com:8443/ImPaul17/phonegest-barcode-studio/releases/latest',
    'https://github.com@evil.example/ImPaul17/phonegest-barcode-studio/releases/latest',
    'https://user:token@github.com/ImPaul17/phonegest-barcode-studio/releases/latest',
    'https://release-assets.githubusercontent.com.evil.example/github-production-release-asset/123/asset',
    'https://release-assets.githubusercontent.com/collect',
    'file:///C:/document.pdf', 'data:text/plain,test',
  ]) assert.equal(isAllowedUpdateUrl(url), false, url);
});

test('isolated updater session enforces every redirect and blocks uploading or identifying headers', () => {
  const hooks = {};
  const updateSession = {
    webRequest: {
      onBeforeRequest: (_filter, callback) => { hooks.request = callback; },
      onBeforeSendHeaders: (_filter, callback) => { hooks.headers = callback; },
    },
    setPermissionRequestHandler(callback) { hooks.permission = callback; },
    setPermissionCheckHandler(callback) { hooks.checkPermission = callback; },
    setDevicePermissionHandler(callback) { hooks.device = callback; },
  };
  secureUpdateSession(updateSession);
  let result;
  hooks.request({ method: 'GET', url: UPDATE_RELEASE_URL }, (value) => { result = value; });
  assert.equal(result.cancel, false);
  hooks.request({ method: 'POST', url: UPDATE_RELEASE_URL }, (value) => { result = value; });
  assert.equal(result.cancel, true);
  hooks.request({ method: 'GET', url: 'https://evil.example/redirect' }, (value) => { result = value; });
  assert.equal(result.cancel, true);
  const headers = sanitizeUpdateHeaders({ Accept: 'application/json', Range: 'bytes=0-', 'x-user-staging-id': 'tracking-uuid', Cookie: 'session=secret', Authorization: 'token secret', Origin: 'file:///document', Referer: 'private', 'X-Codes': 'L3A5KA9807022320129590Q', 'User-Agent': 'machine details' });
  assert.deepEqual(headers, { Accept: 'application/json', Range: 'bytes=0-', 'User-Agent': 'PhoneGest-Barcode-Studio-Updater' });
  assert.equal(hooks.checkPermission(), false);
  assert.equal(hooks.device(), false);
});

test('smoke, development and portable never initialize the updater or schedule network checks', async () => {
  for (const options of [
    { app: { isPackaged: false, getVersion: () => '1.0.1' } },
    { app: { isPackaged: true, getVersion: () => '1.0.1' }, isSmoke: true },
    { app: { isPackaged: true, getVersion: () => '1.0.1' }, environment: { PORTABLE_EXECUTABLE_FILE: 'PhoneGest.exe' } },
  ]) {
    const controller = createDesktopUpdateController({ platform: 'win32', ...options });
    controller.start();
    assert.equal(controller.getState().status, 'unsupported');
    assert.equal(controller.getState().canAutoUpdate, false);
    assert.equal((await controller.checkForUpdates()).status, 'unsupported');
    assert.equal((await controller.downloadUpdate()).status, 'unsupported');
    await assert.rejects(controller.installUpdate(), /todavía no está lista/);
    controller.dispose();
  }
});

test('automatic checks run after 8 seconds and every four hours, with explicit install only', async () => {
  const updater = new MockUpdater();
  const scheduled = [];
  const cleared = [];
  const timers = {
    setTimeout: (callback, delay) => { scheduled.push({ callback, delay }); return 'initial'; },
    setInterval: (callback, delay) => { scheduled.push({ callback, delay }); return 'periodic'; },
    clearTimeout: (id) => cleared.push(id), clearInterval: (id) => cleared.push(id),
  };
  const controller = createUpdateController({ currentVersion: '1.0.1', updater, timers });
  assert.deepEqual(updater.feed, UPDATE_FEED);
  assert.equal(updater.autoDownload, true);
  assert.equal(updater.autoInstallOnAppQuit, false);
  assert.equal(updater.allowDowngrade, false);
  assert.equal(updater.allowPrerelease, false);
  controller.start(); controller.start();
  assert.deepEqual(scheduled.map((item) => item.delay), [INITIAL_CHECK_DELAY_MS, CHECK_INTERVAL_MS]);
  assert.equal(updater.checks, 0);
  scheduled[0].callback();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(updater.checks, 1);
  assert.equal(controller.getState().status, 'up-to-date');
  assert.deepEqual(updater.installs, []);
  controller.dispose();
  assert.deepEqual(cleared, ['initial', 'periodic']);
});

test('availability, progress, ready and user restart preserve local session before installing once', async () => {
  const updater = new MockUpdater();
  const transitions = [];
  let releaseFlush;
  const flushed = new Promise((resolve) => { releaseFlush = resolve; });
  const controller = createUpdateController({ currentVersion: '1.0.1', updater, onState: (state) => transitions.push(state), prepareInstall: () => flushed });
  updater.emit('update-available', { version: '1.0.2', releaseNotes: 'Untrusted remote HTML' });
  updater.emit('download-progress', { percent: 42.5, transferred: 100, total: 1000 });
  assert.equal(controller.getState().progress, 42.5);
  assert.equal(Object.hasOwn(controller.getState(), 'releaseNotes'), false);
  updater.emit('update-downloaded', { version: '1.0.2', downloadedFile: 'private/cache/file.exe' });
  assert.equal(controller.getState().status, 'downloaded');
  assert.equal(Object.hasOwn(controller.getState(), 'downloadedFile'), false);
  const installing = controller.installUpdate();
  const duplicate = controller.installUpdate();
  assert.deepEqual(updater.installs, []);
  releaseFlush();
  await Promise.all([installing, duplicate]);
  assert.deepEqual(updater.installs, [[true, true]]);
  assert.deepEqual(transitions.map((state) => state.status), ['available', 'downloading', 'downloaded']);
  controller.dispose();
});

test('offline checks and failed download remain recoverable without exposing errors, IDs or URLs', async () => {
  const updater = new MockUpdater();
  const identifier = 'L3A5KA9807022320129590Q';
  updater.checkAction = async () => { throw new Error(`offline https://secret.example/${identifier}`); };
  const controller = createUpdateController({ currentVersion: '1.0.1', updater });
  const offline = await controller.checkForUpdates();
  assert.equal(offline.status, 'error');
  assert.match(offline.message, /sin conexión/);
  assert.equal(JSON.stringify(offline).includes(identifier), false);
  assert.equal(JSON.stringify(offline).includes('secret.example'), false);
  updater.checkAction = async () => { updater.emit('update-not-available', { version: '1.0.1' }); };
  assert.equal((await controller.checkForUpdates()).status, 'up-to-date');
  updater.emit('update-available', { version: '1.0.2' });
  updater.downloadUpdate = async () => { throw new Error('checksum mismatch secret path'); };
  assert.equal((await controller.downloadUpdate()).status, 'error');
  updater.downloadUpdate = async () => updater.emit('update-downloaded', { version: '1.0.2' });
  assert.equal((await controller.downloadUpdate()).status, 'downloaded');
  controller.dispose();
});

test('restart refuses busy or failed local save and recovers from installer errors', async () => {
  const updater = new MockUpdater();
  let allowed = false;
  let cancellations = 0;
  const controller = createUpdateController({ currentVersion: '1.0.1', updater, prepareInstall: async () => { if (!allowed) throw new Error('Espera a que termine la impresión.'); }, cancelInstall: () => { cancellations += 1; } });
  updater.emit('update-downloaded', { version: '1.0.2' });
  await assert.rejects(controller.installUpdate(), /impresión/);
  assert.deepEqual(updater.installs, []);
  assert.equal(controller.getState().status, 'downloaded');
  allowed = true;
  updater.quitAndInstall = () => updater.emit('error', new Error('Access denied secret path'));
  await controller.installUpdate();
  assert.equal(controller.getState().status, 'downloaded');
  assert.match(controller.getState().message, /volver a intentarlo/);
  assert.equal(cancellations, 2);
  controller.dispose();
});

test('manual download page is fixed; concurrent checks deduplicate; mutable snapshots are isolated', async () => {
  const updater = new MockUpdater();
  let finish;
  updater.checkAction = () => new Promise((resolve) => { finish = resolve; });
  const links = [];
  const controller = createUpdateController({ currentVersion: '1.0.1', updater, openReleasePage: async (url) => links.push(url) });
  const first = controller.checkForUpdates();
  const second = controller.checkForUpdates();
  assert.equal(updater.checks, 1);
  finish();
  await Promise.all([first, second]);
  await controller.openReleasePage('https://evil.example/');
  assert.deepEqual(links, [UPDATE_RELEASE_URL]);
  const copy = controller.getState(); copy.status = 'downloaded';
  assert.equal(controller.getState().status, 'up-to-date');
  controller.dispose();
});
