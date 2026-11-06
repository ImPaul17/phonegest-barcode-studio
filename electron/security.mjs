import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** This policy intentionally has no production HTTP(S) or WebSocket exception. */
export function isAllowedResourceUrl(rawUrl, { root, developmentOrigin = null }) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol === 'data:' || url.protocol === 'blob:' || url.href === 'about:blank' || url.href === 'about:srcdoc') return true;
    if (url.protocol === 'file:') {
      const requested = path.resolve(fileURLToPath(url));
      const relative = path.relative(root, requested);
      return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
    }
    return Boolean(developmentOrigin && (url.origin === developmentOrigin || url.origin === developmentOrigin.replace(/^http:/, 'ws:')));
  } catch { return false; }
}
