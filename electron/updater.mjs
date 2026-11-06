import { createRequire } from 'node:module';
import { UPDATE_FEED, UPDATE_RELEASE_URL, secureUpdateSession } from './updater-policy.mjs';
import { getDisplayVersion } from '../shared/version.mjs';

export const INITIAL_CHECK_DELAY_MS = 8000;
export const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

const cleanVersion = (value) => typeof value === 'string' && /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(value) && value.length < 100 ? value : undefined;

/** The controller receives update actions only: no document/session content enters it. */
export function createUpdateController({
  currentVersion,
  currentDisplayVersion,
  updater = null,
  unsupportedReason = 'Instala PhoneGest Barcode Studio para recibir actualizaciones desde la aplicación.',
  onState = () => {},
  prepareInstall = async () => {},
  cancelInstall = () => {},
  openReleasePage = async () => {},
  now = () => new Date(),
  timers = { setTimeout, clearTimeout, setInterval, clearInterval },
} = {}) {
  let state = {
    status: updater ? 'idle' : 'unsupported',
    currentVersion,
    currentDisplayVersion: getDisplayVersion(currentVersion, currentDisplayVersion),
    canAutoUpdate: Boolean(updater),
    releaseUrl: UPDATE_RELEASE_URL,
    ...(updater ? {} : { message: unsupportedReason }),
  };
  let checkPromise = null;
  let downloadPromise = null;
  let installPromise = null;
  let installing = false;
  let initialTimer;
  let intervalTimer;
  let started = false;
  let disposed = false;
  const listeners = [];
  const snapshot = () => ({ ...state });
  function publish(patch) {
    if (disposed) return;
    state = { ...state, ...patch };
    onState(snapshot());
  }
  function fail(operation = 'check') {
    publish({
      status: 'error',
      message: operation === 'download'
        ? 'No se ha podido descargar la actualización. Comprueba la conexión e inténtalo de nuevo.'
        : 'No se han podido consultar las actualizaciones. Puedes seguir trabajando sin conexión.',
      lastCheckedAt: now().toISOString(),
    });
  }
  function listen(event, callback) {
    updater.on(event, callback);
    listeners.push([event, callback]);
  }

  if (updater) {
    updater.logger = null;
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = false;
    updater.autoRunAppAfterInstall = true;
    updater.allowDowngrade = false;
    updater.allowPrerelease = false;
    updater.disableWebInstaller = true;
    // Full HTTPS downloads avoid fallback requests outside the fixed release paths.
    updater.disableDifferentialDownload = true;
    updater.requestHeaders = { 'Cache-Control': 'no-cache' };
    updater.setFeedURL({ ...UPDATE_FEED });
    listen('login', (_authInfo, callback) => callback());
    listen('checking-for-update', () => publish({ status: 'checking', message: undefined, progress: undefined }));
    listen('update-not-available', () => publish({ status: 'up-to-date', message: 'Tienes la última versión.', availableVersion: undefined, availableDisplayVersion: undefined, progress: undefined, lastCheckedAt: now().toISOString() }));
    listen('update-available', (info) => {
      const version = cleanVersion(info?.version);
      if (!version) { fail(); return; }
      publish({ status: 'available', availableVersion: version, availableDisplayVersion: getDisplayVersion(version, info?.releaseName), progress: 0, message: 'Se está preparando la descarga de la actualización.', lastCheckedAt: now().toISOString() });
    });
    listen('download-progress', (progress) => {
      const percent = Number(progress?.percent);
      publish({ status: 'downloading', progress: Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 0, message: undefined });
    });
    listen('update-downloaded', (info) => {
      const version = cleanVersion(info?.version) || state.availableVersion;
      const displayVersion = info?.releaseName ?? (version === state.availableVersion ? state.availableDisplayVersion : undefined);
      publish({ status: 'downloaded', availableVersion: version, availableDisplayVersion: getDisplayVersion(version, displayVersion), progress: 100, message: 'La actualización está lista. Reinicia cuando te venga bien.' });
    });
    listen('error', () => {
      if (installing) {
        installing = false;
        cancelInstall();
        publish({ status: 'downloaded', message: 'No se ha podido abrir el instalador. Puedes volver a intentarlo.' });
      } else fail(['available', 'downloading'].includes(state.status) ? 'download' : 'check');
    });
  }

  async function checkForUpdates() {
    if (!updater || disposed || ['downloaded', 'downloading'].includes(state.status)) return snapshot();
    if (checkPromise) return checkPromise;
    checkPromise = (async () => {
      publish({ status: 'checking', message: undefined, progress: undefined });
      try {
        const result = await updater.checkForUpdates();
        // electron-updater starts autoDownload without awaiting it; consume failures.
        if (result?.downloadPromise) void Promise.resolve(result.downloadPromise).catch(() => fail('download'));
        if (state.status === 'checking') publish({ status: 'up-to-date', lastCheckedAt: now().toISOString(), message: 'Tienes la última versión.' });
      } catch { fail(); }
      return snapshot();
    })();
    try { return await checkPromise; }
    finally { checkPromise = null; }
  }

  async function downloadUpdate() {
    if (!updater || disposed || state.status === 'downloaded') return snapshot();
    if (downloadPromise) return downloadPromise;
    if (state.status === 'downloading') return snapshot();
    if (!state.availableVersion) return checkForUpdates();
    downloadPromise = (async () => {
      publish({ status: 'downloading', progress: 0, message: undefined });
      try { await updater.downloadUpdate(); }
      catch { fail('download'); }
      return snapshot();
    })();
    try { return await downloadPromise; }
    finally { downloadPromise = null; }
  }

  async function installUpdate() {
    if (!updater || disposed || state.status !== 'downloaded') throw new Error('La actualización todavía no está lista para instalar.');
    if (installPromise) return installPromise;
    if (installing) return;
    installPromise = (async () => {
      try {
        await prepareInstall();
        if (state.status !== 'downloaded') throw new Error('La actualización todavía no está lista para instalar.');
        installing = true;
        updater.quitAndInstall(true, true);
      } catch (error) {
        installing = false;
        cancelInstall();
        throw error;
      }
    })();
    try { await installPromise; }
    finally { installPromise = null; }
  }

  return Object.freeze({
    getState: snapshot,
    checkForUpdates,
    downloadUpdate,
    installUpdate,
    openReleasePage: () => openReleasePage(UPDATE_RELEASE_URL),
    start() {
      if (!updater || started || disposed) return;
      started = true;
      initialTimer = timers.setTimeout(() => { void checkForUpdates(); }, INITIAL_CHECK_DELAY_MS);
      intervalTimer = timers.setInterval(() => { void checkForUpdates(); }, CHECK_INTERVAL_MS);
      initialTimer?.unref?.();
      intervalTimer?.unref?.();
    },
    dispose() {
      disposed = true;
      if (initialTimer !== undefined) timers.clearTimeout(initialTimer);
      if (intervalTimer !== undefined) timers.clearInterval(intervalTimer);
      for (const [event, callback] of listeners) updater.off(event, callback);
    },
  });
}

export function createDesktopUpdateController({ app, isSmoke = false, platform = process.platform, environment = process.env, ...options }) {
  let updater;
  let unsupportedReason;
  if (isSmoke) unsupportedReason = 'Las actualizaciones están desactivadas durante las comprobaciones.';
  else if (!app.isPackaged) unsupportedReason = 'Las actualizaciones están disponibles en la aplicación instalada.';
  else if (platform !== 'win32') unsupportedReason = 'Las actualizaciones automáticas están disponibles en Windows.';
  else if (environment.PORTABLE_EXECUTABLE_FILE || environment.PORTABLE_EXECUTABLE_DIR) unsupportedReason = 'La versión portable se actualiza descargando una nueva versión. Instala la aplicación para actualizarla desde aquí.';
  else {
    try {
      const require = createRequire(import.meta.url);
      updater = require('electron-updater').autoUpdater;
      secureUpdateSession(updater.netSession);
    } catch {
      updater = undefined;
      unsupportedReason = 'No se ha podido iniciar el servicio de actualizaciones. Puedes descargar la última versión.';
    }
  }
  try { return createUpdateController({ ...options, currentVersion: app.getVersion(), updater, unsupportedReason }); }
  catch {
    return createUpdateController({ ...options, currentVersion: app.getVersion(), unsupportedReason: 'No se ha podido iniciar el servicio de actualizaciones. Puedes descargar la última versión.' });
  }
}
