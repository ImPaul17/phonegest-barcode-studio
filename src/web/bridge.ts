import logoDataUrl from '../../assets/phonegest-reference.png?inline';
import { createProject, MAX_FILE_BYTES, readProject, safeFilename, validatePayload, validateSession } from '../../electron/validation.mjs';
import { version } from '../../package.json';
import { renderDocument } from '../../shared/index.mjs';
import type { DesktopApi, FileResult, Project, Session } from '../types';
import { renderLabelPng } from './label-png';

const SESSION_KEY = 'phonegest-barcode-studio/session';
const RELEASE_URL = 'https://github.com/ImPaul17/phonegest-barcode-studio/releases/latest';

function filenameDate() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(new Date());
}

function downloadFile(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    // The browser may consume the blob asynchronously after the click.
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
}

function selectProjectFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pgbs';
    input.hidden = true;
    const finish = (file: File | null) => {
      input.remove();
      resolve(file);
    };
    input.addEventListener('change', () => finish(input.files?.[0] ?? null), { once: true });
    input.addEventListener('cancel', () => finish(null), { once: true });
    document.body.append(input);
    input.click();
  });
}

async function openProject(): Promise<FileResult> {
  const file = await selectProjectFile();
  if (!file) return { canceled: true };
  if (file.size > MAX_FILE_BYTES) throw new Error('El archivo de proyecto es demasiado grande.');
  let json: unknown;
  try {
    json = JSON.parse(await file.text());
  } catch {
    throw new Error('El archivo no contiene un proyecto válido.');
  }
  return { canceled: false, path: file.name, project: readProject(json) };
}

async function exportImages(value: Project): Promise<FileResult> {
  const { codes, settings } = validatePayload(value);
  const filename = (code: string, index: number) => {
    const number = settings.startNumber + index;
    return `${String(number).padStart(3, '0')}_${safeFilename(code)}.png`;
  };
  if (codes.length === 1) {
    const name = filename(codes[0], 0);
    downloadFile(await renderLabelPng(codes[0], settings, settings.startNumber, logoDataUrl), name);
    return { canceled: false, path: name, count: 1 };
  }

  const { zipSync } = await import('fflate');
  const images: Record<string, Uint8Array<ArrayBuffer>> = {};
  for (const [index, code] of codes.entries()) {
    const png = await renderLabelPng(code, settings, settings.startNumber + index, logoDataUrl);
    images[filename(code, index)] = new Uint8Array(await png.arrayBuffer());
  }
  const name = `PhoneGest-etiquetas-${filenameDate()}.zip`;
  // PNG already compresses its pixels, so store the images without recompressing.
  downloadFile(new Blob([zipSync(images, { level: 0 })], { type: 'application/zip' }), name);
  return { canceled: false, path: name, count: codes.length };
}

export function createWebBridge(): DesktopApi {
  let printFrame: HTMLIFrameElement | undefined;

  async function openPrintDialog(value: Project): Promise<FileResult> {
    const payload = validatePayload(value);
    printFrame?.remove();
    const frame = document.createElement('iframe');
    printFrame = frame;
    frame.title = 'Documento A4 para imprimir';
    frame.setAttribute('aria-hidden', 'true');
    frame.setAttribute('sandbox', 'allow-same-origin allow-modals');
    frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:794px;height:1123px;border:0;';
    const loaded = new Promise<void>((resolve) => frame.addEventListener('load', () => resolve(), { once: true }));
    frame.srcdoc = renderDocument({ ...payload, logoDataUrl });
    document.body.append(frame);

    const cleanup = () => {
      frame.remove();
      if (printFrame === frame) printFrame = undefined;
    };
    try {
      await loaded;
      const documentWindow = frame.contentWindow;
      if (!documentWindow || !frame.contentDocument?.querySelector('.sheet')) {
        throw new Error('No se ha podido abrir el documento para imprimir.');
      }
      documentWindow.addEventListener('afterprint', cleanup, { once: true });
      documentWindow.focus();
      documentWindow.print();
      return { canceled: false, count: payload.codes.length };
    } catch (error) {
      cleanup();
      throw error;
    }
  }

  return {
    async getAppInfo() { return { version, platform: 'web', logoDataUrl }; },
    async loadSession() {
      try {
        const saved = localStorage.getItem(SESSION_KEY);
        if (!saved || saved.length > MAX_FILE_BYTES) return null;
        return validateSession(JSON.parse(saved)) as Session;
      } catch {
        return null;
      }
    },
    async saveSession(session) {
      try {
        localStorage.setItem(SESSION_KEY, JSON.stringify(validateSession(session)));
        return true;
      } catch {
        return false;
      }
    },
    async saveProject(project) {
      const name = `PhoneGest-${filenameDate()}.pgbs`;
      const bytes = JSON.stringify(createProject(project), null, 2);
      downloadFile(new Blob([bytes], { type: 'application/json' }), name);
      return { canceled: false, path: name };
    },
    openProject,
    exportImages,
    exportPdf: openPrintDialog,
    print: openPrintDialog,
    async readClipboard() {
      try {
        return (await navigator.clipboard.readText()).slice(0, 256000);
      } catch {
        throw new Error('El navegador no permite leer el portapapeles. Pega los códigos directamente en el campo.');
      }
    },
    async getUpdateState() {
      return { status: 'unsupported', currentVersion: version, canAutoUpdate: false, releaseUrl: RELEASE_URL };
    },
    async openReleasePage() { window.open(RELEASE_URL, '_blank', 'noopener,noreferrer'); },
  };
}
