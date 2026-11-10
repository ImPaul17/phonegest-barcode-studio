export const UPDATE_OWNER = 'ImPaul17';
export const UPDATE_REPOSITORY = 'phonegest-barcode-studio';
export const UPDATE_RELEASE_URL = `https://github.com/${UPDATE_OWNER}/${UPDATE_REPOSITORY}/releases/latest`;
export const UPDATE_FEED = Object.freeze({ provider: 'github', owner: UPDATE_OWNER, repo: UPDATE_REPOSITORY, private: false });
const RELEASE_PATH = `/${UPDATE_OWNER}/${UPDATE_REPOSITORY}/releases`.toLowerCase();
const API_PATH = `/repos${RELEASE_PATH}`;
const CDN_HOSTS = new Set(['release-assets.githubusercontent.com', 'objects.githubusercontent.com', 'github-releases.githubusercontent.com']);

export function isAllowedUpdateUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || url.hash) return false;
    const pathname = url.pathname.toLowerCase();
    if (url.hostname === 'github.com') {
      if (pathname === `${RELEASE_PATH}.atom` || pathname === `${RELEASE_PATH}/latest`) return true;
      // GitHub resolves /releases/latest to its stable tag even with JSON Accept.
      if (pathname.startsWith(`${RELEASE_PATH}/tag/`)) {
        return /^v?(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)[a-z]?$/.test(url.pathname.slice(`${RELEASE_PATH}/tag/`.length));
      }
      if (!pathname.startsWith(`${RELEASE_PATH}/download/`)) return false;
      const [tag, filename, extra] = url.pathname.slice(`${RELEASE_PATH}/download/`.length).split('/');
      return !extra && /^v?(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)[a-z]?$/.test(tag)
        && /^(?:latest\.yml|PhoneGest-Barcode-Studio-\d[0-9A-Za-z.+-]*-Instalador\.exe(?:\.blockmap)?)$/i.test(filename);
    }
    if (url.hostname === 'api.github.com') return pathname === `${API_PATH}/latest`;
    return CDN_HOSTS.has(url.hostname) && /^\/github-production-release-asset(?:-[a-z0-9]+)?\//i.test(url.pathname);
  } catch { return false; }
}

export function sanitizeUpdateHeaders(headers = {}) {
  const allowed = /^(?:accept|accept-encoding|cache-control|range|host|connection|if-none-match|if-modified-since)$/i;
  return {
    ...Object.fromEntries(Object.entries(headers).filter(([name]) => allowed.test(name))),
    'User-Agent': 'PhoneGest-Barcode-Studio-Updater',
  };
}

export function secureUpdateSession(updateSession) {
  updateSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    callback({ cancel: !['GET', 'HEAD'].includes(details.method) || !isAllowedUpdateUrl(details.url) });
  });
  updateSession.webRequest.onBeforeSendHeaders({ urls: ['<all_urls>'] }, (details, callback) => {
    callback({ requestHeaders: sanitizeUpdateHeaders(details.requestHeaders) });
  });
  updateSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  updateSession.setPermissionCheckHandler(() => false);
  updateSession.setDevicePermissionHandler(() => false);
}
