import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const entry = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(entry), '..');

if (!process.versions.electron || process.env.ELECTRON_RUN_AS_NODE) {
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  const child = spawn(require('electron'), [entry, ...process.argv.slice(2)], { cwd: root, env: environment, stdio: 'inherit', windowsHide: true });
  child.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
  child.on('exit', (code) => { process.exitCode = code ?? 1; });
} else {
  const { app, session } = require('electron');
  const { ElectronHttpExecutor } = require('electron-updater/out/electronHttpExecutor.js');
  const { createLetterNsisUpdater } = await import('../electron/letter-updater.mjs');
  const { isAppVersion } = await import('../shared/version.mjs');
  const { createUpdateController } = await import('../electron/updater.mjs');
  const { secureUpdateSession, isAllowedUpdateUrl, UPDATE_RELEASE_URL } = await import('../electron/updater-policy.mjs');
  const args = process.argv.slice(2);
  const argument = (name) => { const index = args.indexOf(name); return index === -1 ? undefined : args[index + 1]; };
  const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const version = argument('--current-version') || packageJson.version;
  const output = path.resolve(argument('--output') || path.join(root, 'build', 'update-smoke'));
  const shouldDownload = args.includes('--download');
  const audit = [];
  const privacyViolations = [];
  const transitions = [];
  const errors = [];
  let controller;
  let timeout;
  let downloadedInfo;
  app.setName('PhoneGest Update Smoke');
  app.setPath('userData', path.join(app.getPath('temp'), `phonegest-update-smoke-${process.pid}`));
  const startupTimeout = setTimeout(() => { console.error('Electron no se ha iniciado en 30 segundos.'); app.exit(1); }, 30000);

  void app.whenReady().then(async () => {
  clearTimeout(startupTimeout);
  try {
    assert.ok(isAppVersion(version), 'La versión de prueba debe seguir el formato x.y.z con una letra opcional.');
    await mkdir(output, { recursive: true });
    await mkdir(app.getPath('userData'), { recursive: true });
    const configFile = path.join(output, 'smoke-app-update.yml');
    await writeFile(configFile, 'updaterCacheDirName: phonegest-update-smoke\n');
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (_details, callback) => callback({ cancel: true }));
    const adapter = {
      version,
      name: 'PhoneGest Update Smoke',
      isPackaged: true,
      appUpdateConfigPath: configFile,
      userDataPath: app.getPath('userData'),
      baseCachePath: path.join(output, 'cache'),
      whenReady: () => app.whenReady(),
      relaunch: () => { throw new Error('El smoke nunca reinicia ni instala.'); },
      quit: () => { throw new Error('El smoke nunca reinicia ni instala.'); },
      onQuit: () => {},
    };
    const updater = createLetterNsisUpdater(adapter);
    updater.httpExecutor = new ElectronHttpExecutor((authInfo, callback) => updater.emit('login', authInfo, callback));
    updater.quitAndInstall = () => { throw new Error('El smoke nunca ejecuta el instalador.'); };
    const updateSession = updater.netSession;
    secureUpdateSession(updateSession);
    updateSession.webRequest.onCompleted({ urls: ['<all_urls>'] }, (details) => {
      const url = new URL(details.url);
      audit.push({ host: url.hostname, path: url.pathname, method: details.method, status: details.statusCode, allowed: isAllowedUpdateUrl(details.url) });
    });
    updateSession.webRequest.onErrorOccurred({ urls: ['<all_urls>'] }, (details) => {
      const url = new URL(details.url);
      audit.push({ host: url.hostname, path: url.pathname, method: details.method, error: details.error, allowed: isAllowedUpdateUrl(details.url) });
    });
    updateSession.webRequest.onSendHeaders({ urls: ['<all_urls>'] }, (details) => {
      for (const name of Object.keys(details.requestHeaders)) {
        if (/^(?:authorization|proxy-authorization|cookie|origin|referer|x-user-staging-id|x-github-token|x-auth-token|private-token)$/i.test(name)) privacyViolations.push(name);
      }
    });
    updater.on('update-downloaded', (info) => { downloadedInfo = info; });
    updater.on('error', (error) => errors.push({ code: error.code, message: String(error.message).split('\n')[0].replace(/https?:\/\/[^\s)]+/g, (value) => { try { const url = new URL(value); return `${url.origin}${url.pathname}`; } catch { return '[URL]'; } }).slice(0, 400) }));
    let finish;
    const ready = new Promise((resolve) => { finish = resolve; });
    controller = createUpdateController({
      currentVersion: version,
      currentDisplayVersion: version === packageJson.version ? packageJson.displayVersion : undefined,
      updater,
      prepareInstall: async () => { throw new Error('El smoke nunca instala actualizaciones.'); },
      onState: (state) => {
        transitions.push({ status: state.status, availableVersion: state.availableVersion, availableDisplayVersion: state.availableDisplayVersion, progress: state.progress });
        if (state.status === 'error' || state.status === 'up-to-date' || state.status === 'downloaded' || (!shouldDownload && state.status === 'available')) finish(state);
      },
    });
    // This test-only adapter can simulate an older installed version. Production
    // never accepts version, feed, URL or executable overrides from IPC or flags.
    updater.autoDownload = shouldDownload;
    timeout = setTimeout(() => finish({ status: 'error', message: 'Tiempo de espera agotado.' }), 5 * 60 * 1000);
    await controller.checkForUpdates();
    const state = await ready;
    if (state.status === 'error') throw new Error(state.message || 'Ha fallado la comprobación real.');
    let installer;
    if (shouldDownload && state.status === 'downloaded') {
      const file = updater.installerPath;
      assert.ok(file, 'El actualizador no ha guardado el instalador.');
      const expected = downloadedInfo?.files?.find((item) => /-Instalador\.exe$/i.test(item.url))?.sha512;
      assert.ok(expected, 'La versión publicada no incluye SHA512 del instalador.');
      const digest = createHash('sha512');
      for await (const chunk of createReadStream(file)) digest.update(chunk);
      const sha512 = digest.digest('base64');
      assert.equal(sha512, expected, 'El instalador no coincide con el SHA512 de latest.yml.');
      installer = { file: path.basename(file), bytes: (await stat(file)).size, sha512, checksumVerified: true, executed: false };
    }
    assert.deepEqual(privacyViolations, [], 'Se ha enviado una cabecera de identificación o autenticación.');
    assert.ok(audit.length > 0, 'No se ha observado la consulta HTTPS real.');
    assert.ok(audit.every((request) => request.allowed), 'Una consulta salió de los destinos permitidos.');
    const report = { success: true, currentVersion: version, state, releaseUrl: UPDATE_RELEASE_URL, downloadRequested: shouldDownload, installer, transitions, requests: audit, privacyViolations, installed: false };
    await writeFile(path.join(output, 'update-smoke-result.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ success: true, status: state.status, currentVersion: version, availableVersion: state.availableVersion, downloaded: Boolean(installer), checksumVerified: installer?.checksumVerified || false, installed: false, output }));
    controller.dispose();
    clearTimeout(timeout);
    app.exit(0);
  } catch (error) {
    clearTimeout(timeout);
    controller?.dispose();
    await mkdir(output, { recursive: true });
    await writeFile(path.join(output, 'update-smoke-result.json'), JSON.stringify({ success: false, message: error.message, transitions, errors, requests: audit, privacyViolations, installed: false }, null, 2));
    console.error(error.message);
    app.exit(1);
  }
  });
}
