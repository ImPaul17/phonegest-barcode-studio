const VERSION_LABEL = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:[a-z][a-z0-9]{0,15})?(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const RELEASE_TITLE_PREFIX = 'PhoneGest Barcode Studio ';
const APP_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)([a-z])?$/;

/** Stable revisions sort after their numeric base: 1.0.4 < 1.0.4b < 1.0.4c < 1.0.5. */
export function parseAppVersion(value) {
  if (typeof value !== 'string' || value.length > 100) return null;
  const match = APP_VERSION.exec(value);
  if (!match || match[0] !== value) return null;
  const [major, minor, patch] = match.slice(1, 4).map(Number);
  if (![major, minor, patch].every(Number.isSafeInteger)) return null;
  return { version: value, major, minor, patch, revision: match[4] ? match[4].charCodeAt(0) - 96 : 0 };
}

export function isAppVersion(value) {
  return parseAppVersion(value) !== null;
}

export function compareAppVersions(left, right) {
  const a = parseAppVersion(left);
  const b = parseAppVersion(right);
  if (!a || !b) throw new TypeError('La versión debe ser x.y.z seguida opcionalmente de una letra minúscula.');
  for (const part of ['major', 'minor', 'patch', 'revision']) {
    if (a[part] !== b[part]) return a[part] < b[part] ? -1 : 1;
  }
  return 0;
}

/** Retain historical display labels when reading older update state. New builds use one canonical version. */
export function getDisplayVersion(internalVersion, displayVersion) {
  if (typeof displayVersion !== 'string' || displayVersion.length > 100) return internalVersion;
  let label = displayVersion.trim();
  if (label.startsWith(RELEASE_TITLE_PREFIX)) label = label.slice(RELEASE_TITLE_PREFIX.length);
  if (label.startsWith('v')) label = label.slice(1);
  return VERSION_LABEL.test(label) ? label : internalVersion;
}
