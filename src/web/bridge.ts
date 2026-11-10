import logoDataUrl from '../../assets/phonegest-reference.png?inline';
import { createProject, MAX_FILE_BYTES, readProject, safeFilename, validatePayload, validateSession } from '../../electron/validation.mjs';
import { version } from '../../package.json';
import { renderDocument, resolveFilename } from '../../shared/index.mjs';
import type { DesktopApi, FileResult, ImageExportOptions, Project, Session } from '../types';
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

type DirectoryHandle = {
  getFileHandle(name: string, options: { create: true }): Promise<{
    createWritable(): Promise<ImageWritable>;
  }>;
};
type ImageWritable = { write(data: Blob): Promise<void>; close(): Promise<void>; abort?(): Promise<void> };

async function exportImages(value: Project, options: ImageExportOptions = { format: 'zip' }): Promise<FileResult> {
  const payload = validatePayload(value);
  const now = new Date();
  const { codes, dates, settings } = payload;
  if (options.format !== 'zip' && options.format !== 'folder') throw new Error('Elige ZIP o imágenes sueltas.');
  const filename = (code: string, index: number) => {
    const number = settings.startNumber + index;
    return `${String(number).padStart(3, '0')}_${safeFilename(code)}.png`;
  };
  if (options.format === 'folder') {
    const picker = (window as Window & { showDirectoryPicker?: (options: { mode: 'readwrite'; id: string }) => Promise<DirectoryHandle> }).showDirectoryPicker;
    let directory: DirectoryHandle | undefined;
    if (picker) {
      try {
        // Ask while this still belongs to the user's click, before rendering PNGs.
        directory = await picker.call(window, { mode: 'readwrite', id: 'phonegest-images' });
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return { canceled: true };
        throw new Error('El navegador no ha permitido elegir la carpeta. Autoriza el acceso o exporta las imágenes en ZIP.');
      }
    }
    let written = 0;
    for (const [index, code] of codes.entries()) {
      const png = await renderLabelPng(code, settings, settings.startNumber + index, logoDataUrl, dates[index]);
      if (directory) {
        let stream: ImageWritable | undefined;
        try {
          const handle = await directory.getFileHandle(filename(code, index), { create: true });
          stream = await handle.createWritable();
          await stream.write(png);
          await stream.close();
        } catch {
          await stream?.abort?.().catch(() => {});
          throw new Error(`No se pudo completar la escritura en la carpeta (${written} de ${codes.length} imágenes guardadas). Comprueba los permisos y el espacio disponible, o usa ZIP.`);
        }
        written += 1;
      } else {
        downloadFile(png, filename(code, index));
      }
    }
    return directory
      ? { canceled: false, count: written, message: `${written} ${written === 1 ? 'imagen guardada' : 'imágenes guardadas'} en la carpeta elegida.` }
      : { canceled: false, count: codes.length, message: `Se solicitaron ${codes.length} descargas PNG sueltas. Este navegador no permite elegir una carpeta: si no aparecen todas, permite las descargas múltiples o usa ZIP.` };
  }

  const { zipSync } = await import('fflate');
  const images: Record<string, Uint8Array<ArrayBuffer>> = {};
  for (const [index, code] of codes.entries()) {
    const png = await renderLabelPng(code, settings, settings.startNumber + index, logoDataUrl, dates[index]);
    images[filename(code, index)] = new Uint8Array(await png.arrayBuffer());
  }
  const name = resolveFilename(settings.filenameTemplate, { ...payload, now }, 'zip');
  // PNG already compresses its pixels, so store the images without recompressing.
  downloadFile(new Blob([zipSync(images, { level: 0 })], { type: 'application/zip' }), name);
  return { canceled: false, path: name, count: codes.length, message: `Se inició la descarga de un ZIP con ${codes.length} ${codes.length === 1 ? 'imagen PNG' : 'imágenes PNG'}.` };
}

export function createWebBridge(): DesktopApi {
  let printFrame: HTMLIFrameElement | undefined;
  let cleanupPrint: (() => void) | undefined;

  async function openPrintDialog(value: Project, asPdf = false): Promise<FileResult> {
    const payload = validatePayload(value);
    const now = new Date();
    const filename = resolveFilename(payload.settings.filenameTemplate, { ...payload, now }, 'pdf');
    cleanupPrint?.();
    const frame = document.createElement('iframe');
    printFrame = frame;
    frame.title = 'Documento A4 para imprimir';
    frame.setAttribute('aria-hidden', 'true');
    frame.setAttribute('sandbox', 'allow-same-origin allow-modals');
    frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:794px;height:1123px;border:0;';
    const loaded = new Promise<void>((resolve) => frame.addEventListener('load', () => resolve(), { once: true }));
    frame.srcdoc = renderDocument({ ...payload, logoDataUrl, now });
    document.body.append(frame);

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      frame.remove();
      if (printFrame === frame) printFrame = undefined;
      if (cleanupPrint === cleanup) cleanupPrint = undefined;
      if (document.title === filename) document.title = previousTitle;
    };
    const previousTitle = document.title;
    cleanupPrint = cleanup;
    try {
      await loaded;
      const documentWindow = frame.contentWindow;
      if (!documentWindow || !frame.contentDocument?.querySelector('.sheet')) {
        throw new Error('No se ha podido abrir el documento para imprimir.');
      }
      documentWindow.addEventListener('afterprint', cleanup, { once: true });
      // Browsers choose their PDF suggestion from either the top-level or the
      // printed frame's title. The system dialog still controls the final name.
      document.title = filename;
      documentWindow.document.title = filename;
      documentWindow.focus();
      documentWindow.print();
      return { canceled: false, count: payload.codes.length, message: asPdf
        ? `Se solicitó el diálogo de impresión. Elige «Guardar como PDF»; nombre sugerido: ${filename}. El navegador puede permitir cambiarlo.`
        : 'Se solicitó el diálogo de impresión del navegador. Confirma allí la impresora y las páginas.' };
    } catch (error) {
      cleanup();
      throw error;
    }
  }

  return {
    async getAppInfo() { return { version, platform: 'web', logoDataUrl, author: 'ImPaul' }; },
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
    exportPdf: project => openPrintDialog(project, true),
    print: project => openPrintDialog(project),
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
