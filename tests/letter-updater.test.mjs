import test from 'node:test';
import assert from 'node:assert/strict';
import { createLetterNsisUpdater } from '../electron/letter-updater.mjs';

function appAdapter(version = '1.0.4c') {
  return {
    get version() { return version; },
    name: 'PhoneGest updater fixture',
    isPackaged: true,
    whenReady: async () => {},
    onQuit: () => {},
    quit: () => { throw new Error('Tests never install or quit the application.'); },
    relaunch: () => { throw new Error('Tests never relaunch the application.'); },
  };
}

function releaseInfo(version = '1.0.4d', tag = `v${version}`) {
  return Object.freeze({
    version,
    tag,
    releaseName: version,
    files: Object.freeze([Object.freeze({ url: `PhoneGest-Barcode-Studio-${version}-Instalador.exe`, sha512: 'fixture' })]),
  });
}

function updaterFixture(info = releaseInfo()) {
  const app = appAdapter();
  const updater = createLetterNsisUpdater(app);
  updater.logger = null;
  updater.autoDownload = false;
  const provider = {};
  updater.getUpdateInfoAndProvider = async () => ({ info, provider });
  return { app, updater, provider };
}

test('the real NSIS check retains canonical app, metadata and event versions', async () => {
  const info = releaseInfo();
  const { app, updater, provider } = updaterFixture(info);
  const available = [];
  updater.on('update-available', value => available.push(value));
  const result = await updater.checkForUpdates();

  assert.equal(updater.app, app);
  assert.equal(app.version, '1.0.4c');
  assert.equal(updater.currentVersion.version, '1.0.4c');
  assert.equal(updater.currentVersion.raw, '1.0.4c');
  assert.equal(updater.currentVersion.format(), '1.0.4c');
  assert.equal(String(updater.currentVersion), '1.0.4c');
  assert.equal(updater.allowPrerelease, false);
  assert.equal(updater.allowDowngrade, false);
  assert.equal(result.isUpdateAvailable, true);
  assert.equal(result.downloadPromise, null);
  assert.equal(result.updateInfo, info);
  assert.equal(result.versionInfo, info);
  assert.deepEqual(available, [info]);
  assert.equal(updater.updateInfoAndProvider.info, info);
  assert.equal(updater.updateInfoAndProvider.provider, provider);
  assert.equal(info.files[0].url, 'PhoneGest-Barcode-Studio-1.0.4d-Instalador.exe');
});

test('the NSIS availability chain orders letters naturally and refuses equal or older revisions', async () => {
  for (const [version, expected] of [
    ['1.0.4', false], ['1.0.4a', false], ['1.0.4b', false], ['1.0.4c', false],
    ['1.0.4d', true], ['1.0.4z', true], ['1.0.5', true], ['1.0.10', true],
  ]) {
    const info = releaseInfo(version);
    const { updater } = updaterFixture(info);
    const events = [];
    updater.on('update-available', value => events.push(['available', value.version]));
    updater.on('update-not-available', value => events.push(['not-available', value.version]));
    const result = await updater.checkForUpdates();
    assert.equal(result.isUpdateAvailable, expected, version);
    assert.deepEqual(events, [[expected ? 'available' : 'not-available', version]], version);
    assert.equal(result.updateInfo.version, version);
    assert.equal(updater.currentVersion.version, '1.0.4c');
  }
});

test('the real updater rejects malformed versions and tags before announcing an update', async () => {
  for (const info of [
    releaseInfo('1.0.4dd'), releaseInfo('1.0.4D'), releaseInfo('1.0.4-d'),
    releaseInfo('1.0.4d\n'), releaseInfo('v1.0.4d'),
    releaseInfo('1.0.4d', 'v1.0.5'), releaseInfo('1.0.4d', 'feature'),
    { ...releaseInfo(), releaseName: '1.0.5' },
  ]) {
    const { updater } = updaterFixture(info);
    const available = [];
    updater.on('update-available', value => available.push(value));
    await assert.rejects(updater.checkForUpdates(), TypeError);
    assert.deepEqual(available, []);
    assert.equal(updater.updateInfoAndProvider, null);
  }
  assert.throws(() => createLetterNsisUpdater(appAdapter('1.0.4cc')), TypeError);
});

test('a cached release for the old revision B cannot downgrade a canonical installation', async () => {
  const { updater } = updaterFixture({ ...releaseInfo('1.0.5'), releaseName: '1.0.4b' });
  assert.equal((await updater.checkForUpdates()).isUpdateAvailable, false);
  assert.equal(updater.updateInfoAndProvider, null);
});

test('letter support preserves OS support and staged-rollout checks', async () => {
  const { updater } = updaterFixture();
  const checks = [];
  updater.isUpdateSupported = async info => { checks.push(['support', info.version]); return false; };
  updater.isUserWithinRollout = async info => { checks.push(['rollout', info.version]); return true; };
  assert.equal((await updater.checkForUpdates()).isUpdateAvailable, false);
  assert.deepEqual(checks, [['support', '1.0.4d']]);

  checks.length = 0;
  updater.isUpdateSupported = async info => { checks.push(['support', info.version]); return true; };
  updater.isUserWithinRollout = async info => { checks.push(['rollout', info.version]); return false; };
  assert.equal((await updater.checkForUpdates()).isUpdateAvailable, false);
  assert.deepEqual(checks, [['support', '1.0.4d'], ['rollout', '1.0.4d']]);
});
