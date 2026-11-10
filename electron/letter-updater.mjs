import { createRequire } from 'node:module';
import { compareAppVersions, isAppVersion, parseAppVersion } from '../shared/version.mjs';

const require = createRequire(import.meta.url);

/** Keep Electron Updater's NSIS download, checksum, cache and installation machinery.
 * Only its SemVer-only constructor and availability comparison need adaptation.
 * The constructor receives a numeric base momentarily; the app adapter, current
 * version, update metadata and all emitted events retain the canonical label.
 */
export function createLetterNsisUpdater(appAdapter) {
  const canonicalVersion = appAdapter.version;
  const parsed = parseAppVersion(canonicalVersion);
  if (!parsed) throw new TypeError('La aplicación no tiene una versión válida.');
  const { NsisUpdater } = require('electron-updater');
  const bootstrapAdapter = new Proxy(appAdapter, {
    get(target, property) {
      if (property === 'version') return `${parsed.major}.${parsed.minor}.${parsed.patch}`;
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  class LetterNsisUpdater extends NsisUpdater {
    async isUpdateAvailable(info) {
      if (!isAppVersion(info?.version)) throw new TypeError('La actualización no tiene una versión válida.');
      if (info.tag !== undefined && info.tag !== `v${info.version}`) throw new TypeError('La tag no coincide con la versión anunciada.');
      // The old 1.0.5 build was revision B. A cached GitHub response must not reinstall it over C.
      if (info.version === '1.0.5' && info.releaseName === '1.0.4b') return false;
      if (info.releaseName !== info.version) throw new TypeError('El nombre de la versión no coincide con la actualización.');
      if (compareAppVersions(info.version, canonicalVersion) <= 0) return false;
      if (!await this.isUpdateSupported(info)) return false;
      return Boolean(await this.isUserWithinRollout(info));
    }
  }
  const updater = new LetterNsisUpdater(null, bootstrapAdapter);
  updater.app = appAdapter;
  // The inherited stable GitHub path only calls format() for diagnostics. It
  // never parses this value as SemVer: comparison is owned by the override above.
  updater.currentVersion = Object.freeze({ ...parsed, raw: canonicalVersion, format: () => canonicalVersion, toString: () => canonicalVersion });
  updater.allowPrerelease = false;
  updater.allowDowngrade = false;
  return updater;
}

export function createDesktopLetterUpdater(app) {
  const { ElectronAppAdapter } = require('electron-updater/out/ElectronAppAdapter.js');
  const { ElectronHttpExecutor } = require('electron-updater/out/electronHttpExecutor.js');
  const updater = createLetterNsisUpdater(new ElectronAppAdapter(app));
  updater.httpExecutor = new ElectronHttpExecutor((authInfo, callback) => updater.emit('login', authInfo, callback));
  return updater;
}
