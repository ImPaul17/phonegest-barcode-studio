const VERSION_LABEL = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:[a-z][a-z0-9]{0,15})?(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const RELEASE_TITLE_PREFIX = 'PhoneGest Barcode Studio ';

/** Display labels are presentation only; updater comparisons always use package.version. */
export function getDisplayVersion(internalVersion, displayVersion) {
  if (typeof displayVersion !== 'string' || displayVersion.length > 100) return internalVersion;
  let label = displayVersion.trim();
  if (label.startsWith(RELEASE_TITLE_PREFIX)) label = label.slice(RELEASE_TITLE_PREFIX.length);
  if (label.startsWith('v')) label = label.slice(1);
  return VERSION_LABEL.test(label) ? label : internalVersion;
}
