import { app, BrowserWindow, Menu, clipboard, dialog, ipcMain, session, shell } from 'electron';
import { readFile, writeFile, rename, mkdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { renderDocument, resolveFilename } from '../shared/index.mjs';
import { getDisplayVersion } from '../shared/version.mjs';
import { validatePayload, validateSession, createProject, readProject, MAX_FILE_BYTES } from './validation.mjs';
import { isAllowedResourceUrl } from './security.mjs';
import { writeLabelImages, writeLabelArchive, validateImageExportOptions } from './image-export.mjs';
import { createDesktopUpdateController } from './updater.mjs';
import { secureUpdateSession } from './updater-policy.mjs';
import { createInstallationManager } from './installation.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageInfo = createRequire(import.meta.url)('../package.json');
const appDisplayVersion = getDisplayVersion(app.getVersion(), packageInfo.displayVersion);
const INDEX_PATH = path.join(ROOT, 'dist', 'index.html');
const INDEX_URL = pathToFileURL(INDEX_PATH).href;
const smokeIndex = process.argv.indexOf('--smoke-test');
const isSmoke = smokeIndex !== -1;
const DEV_URL = !app.isPackaged && process.env.ELECTRON_RENDERER_URL === 'http://127.0.0.1:5173' ? process.env.ELECTRON_RENDERER_URL : null;
const rendererErrors = [];
let mainWindow;
let logoDataUrl = '';
let activeJob = false;
let sessionWrites = Promise.resolve();
let latestSessionWrite = Promise.resolve();
let installingUpdate = false;
let updateController;
let installationManager;

app.setName('PhoneGest Barcode Studio');
if (isSmoke) app.setPath('userData', path.join(app.getPath('temp'), `phonegest-smoke-${process.pid}`));
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

function secureWindow(window) {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== INDEX_URL && !(DEV_URL && url === `${DEV_URL}/`)) event.preventDefault();
  });
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.webContents.on('will-prevent-unload', (event) => event.preventDefault());
}

function setupSecurity() {
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    callback({ cancel: !isAllowedResourceUrl(details.url, { root: ROOT, developmentOrigin: DEV_URL }) });
  });
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.setDevicePermissionHandler(() => false);
}

async function loadLogo() {
  const bytes = await readFile(path.join(ROOT, 'assets', 'phonegest-reference.png'));
  logoDataUrl = `data:image/png;base64,${bytes.toString('base64')}`;
}

async function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 970,
    minWidth: 1040,
    minHeight: 720,
    show: false,
    title: 'PhoneGest Barcode Studio',
    backgroundColor: '#f5f7f9',
    icon: path.join(ROOT, 'assets', 'phonegest.ico'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(ROOT, 'electron', 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
      webviewTag: false,
      devTools: !app.isPackaged,
    },
  });
  secureWindow(mainWindow);
  mainWindow.on('closed', () => { mainWindow = undefined; });
  mainWindow.webContents.on('preload-error', (_event, _preloadPath, error) => rendererErrors.push(error.message));
  mainWindow.webContents.on('console-message', (details) => {
    if (details.level === 'error') rendererErrors.push(details.message);
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => rendererErrors.push(`Renderer: ${details.reason}`));
  if (DEV_URL) await mainWindow.loadURL(DEV_URL);
  else await mainWindow.loadFile(INDEX_PATH);
  if (!isSmoke) mainWindow.show();
  return mainWindow;
}

function assertTrustedSender(event) {
  const source = event.senderFrame;
  if (!mainWindow || event.sender !== mainWindow.webContents || !source || source !== event.sender.mainFrame) {
    throw new Error('Esta operación solo está disponible en la aplicación.');
  }
  if (source.url !== INDEX_URL && !(DEV_URL && source.url === `${DEV_URL}/`)) {
    throw new Error('El origen de la operación no es válido.');
  }
}

function handle(name, handler) {
  ipcMain.handle(`phonegest:${name}`, async (event, ...args) => {
    assertTrustedSender(event);
    try { return await handler(...args); }
    catch (error) {
      // Do not log identifier contents or document payloads.
      throw new Error(error instanceof Error ? error.message : 'No se ha podido completar la operación.');
    }
  });
}

async function runJob(job) {
  if (installingUpdate) throw new Error('La aplicación se está reiniciando para actualizarse.');
  if (activeJob) throw new Error('Espera a que termine la operación actual.');
  activeJob = true;
  try { return await job(); }
  finally { activeJob = false; }
}

async function atomicWrite(file, content) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, { flag: 'wx' });
    await rename(temporary, file);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

function filenameDate() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(new Date());
}

async function createDocumentWindow(payload) {
  const window = new BrowserWindow({
    show: false,
    width: 1000,
    height: 1000,
    webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true, webSecurity: true, spellcheck: false },
  });
  secureWindow(window);
  try {
    const html = renderDocument({ ...payload, logoDataUrl });
    // Avoid the browser's data-URL length limit for documents with hundreds of codes.
    await window.loadURL('about:blank');
    await window.webContents.executeJavaScript(`document.open(); document.write(${JSON.stringify(html)}); document.close();`);
    await window.webContents.executeJavaScript(`(async () => {
      await document.fonts.ready;
      await Promise.all(Array.from(document.images, image => image.complete ? Promise.resolve() : new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error('No se ha podido cargar el logo.')); })));
      return true;
    })()`);
    return window;
  } catch (error) {
    window.destroy();
    throw error;
  }
}

async function writePdf(payload, filePath) {
  const window = await createDocumentWindow(payload);
  try {
    const pdf = await window.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: false,
      margins: { top: 0, right: 0, bottom: 0, left: 0 },
    });
    await atomicWrite(filePath, pdf);
    return pdf.length;
  } finally { window.destroy(); }
}

async function writeImages(payload, directory) {
  return writeLabelImages(payload, directory, logoDataUrl);
}

function registerHandlers() {
  handle('getAppInfo', () => ({ version: app.getVersion(), displayVersion: appDisplayVersion, platform: process.platform, logoDataUrl, author: 'ImPaul' }));
  handle('getInstallationInfo', () => installationManager.getInfo());
  handle('changeInstallationLocation', () => installationManager.changeLocation());
  handle('getUpdateState', () => updateController.getState());
  handle('checkForUpdates', () => updateController.checkForUpdates());
  handle('downloadUpdate', () => updateController.downloadUpdate());
  handle('installUpdate', () => updateController.installUpdate());
  handle('openReleasePage', () => updateController.openReleasePage());
  handle('readClipboard', () => clipboard.readText().slice(0, 256000));
  handle('loadSession', async () => {
    try {
      const sessionFile = path.join(app.getPath('userData'), 'session.json');
      if ((await stat(sessionFile)).size > MAX_FILE_BYTES) return null;
      return validateSession(JSON.parse(await readFile(sessionFile, 'utf8')));
    } catch { return null; }
  });
  handle('saveSession', (value) => {
    if (installingUpdate) throw new Error('La aplicación se está reiniciando para actualizarse.');
    const clean = validateSession(value);
    const write = sessionWrites.then(() => atomicWrite(path.join(app.getPath('userData'), 'session.json'), JSON.stringify(clean)));
    latestSessionWrite = write;
    sessionWrites = write.catch(() => {});
    return write.then(() => true);
  });
  handle('exportPdf', (value) => runJob(async () => {
    const payload = { ...validatePayload(value), now: new Date() };
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Guardar PDF',
      defaultPath: path.join(app.getPath('documents'), resolveFilename(payload.settings.filenameTemplate, payload, 'pdf')),
      filters: [{ name: 'Documento PDF', extensions: ['pdf'] }],
      properties: ['showOverwriteConfirmation', 'createDirectory'],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    const filePath = /\.pdf$/i.test(result.filePath) ? result.filePath : `${result.filePath}.pdf`;
    await writePdf(payload, filePath);
    return { canceled: false, path: filePath, count: payload.codes.length };
  }));
  handle('print', (value) => runJob(async () => {
    const payload = validatePayload(value);
    const window = await createDocumentWindow(payload);
    try {
      return await new Promise((resolve, reject) => {
        window.webContents.print({ silent: false, printBackground: true, pageSize: 'A4', margins: { marginType: 'none' } }, (success, reason) => {
          if (success) resolve({ canceled: false, count: payload.codes.length });
          else if (/cancel/i.test(reason)) resolve({ canceled: true });
          else reject(new Error(reason || 'No se ha podido imprimir. Comprueba la impresora.'));
        });
      });
    } finally { window.destroy(); }
  }));
  handle('exportImages', (value, options) => runJob(async () => {
    const payload = validatePayload(value);
    const { format } = validateImageExportOptions(options);
    if (format === 'zip') {
      const result = await dialog.showSaveDialog(mainWindow, {
        title: 'Guardar imágenes en ZIP',
        defaultPath: path.join(app.getPath('pictures'), resolveFilename(payload.settings.filenameTemplate, payload, 'zip')),
        filters: [{ name: 'Archivo ZIP con imágenes PNG', extensions: ['zip'] }],
        properties: ['showOverwriteConfirmation', 'createDirectory'],
      });
      if (result.canceled || !result.filePath) return { canceled: true };
      const filePath = /\.zip$/i.test(result.filePath) ? result.filePath : `${result.filePath}.zip`;
      const temporary = `${filePath}.${randomUUID()}.tmp`;
      try {
        await writeLabelArchive(payload, temporary, logoDataUrl);
        await rename(temporary, filePath);
      } catch (error) { await unlink(temporary).catch(() => {}); throw error; }
      return { canceled: false, path: filePath, count: payload.codes.length };
    }
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Elegir carpeta para las imágenes PNG',
      defaultPath: app.getPath('pictures'),
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    await writeImages(payload, result.filePaths[0]);
    return { canceled: false, path: result.filePaths[0], count: payload.codes.length };
  }));
  handle('saveProject', (value) => runJob(async () => {
    const project = createProject(value);
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Guardar proyecto',
      defaultPath: path.join(app.getPath('documents'), `PhoneGest-${filenameDate()}.pgbs`),
      filters: [{ name: 'Proyecto PhoneGest Barcode Studio', extensions: ['pgbs'] }],
      properties: ['showOverwriteConfirmation', 'createDirectory'],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    const filePath = /\.pgbs$/i.test(result.filePath) ? result.filePath : `${result.filePath}.pgbs`;
    await atomicWrite(filePath, JSON.stringify(project, null, 2));
    return { canceled: false, path: filePath };
  }));
  handle('openProject', () => runJob(async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Abrir proyecto',
      filters: [{ name: 'Proyecto PhoneGest Barcode Studio', extensions: ['pgbs'] }],
      properties: ['openFile'],
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    const filePath = result.filePaths[0];
    if ((await stat(filePath)).size > MAX_FILE_BYTES) throw new Error('El archivo de proyecto es demasiado grande.');
    let json;
    try { json = JSON.parse(await readFile(filePath, 'utf8')); }
    catch { throw new Error('El archivo no contiene un proyecto válido.'); }
    return { canceled: false, path: filePath, project: readProject(json) };
  }));
}

async function runSmoke() {
  const argument = process.argv[smokeIndex + 1];
  const directory = path.resolve(argument && !argument.startsWith('--') ? argument : path.join(ROOT, 'build', 'smoke'));
  const payload = validatePayload({
    codes: ['L3A5KA9806994060129590B', 'L3A5KA9806994140129590X', 'L3A5KA9807022320129590Q'],
    dates: ['2026-11-10', '', '2026-11-09'],
    settings: { layout: 'comfortable', startNumber: 1, showNumbers: true, showCheckboxes: true, showText: true, documentTitle: '' },
  });
  await mkdir(directory, { recursive: true });
  const ready = await mainWindow.webContents.executeJavaScript(`(async () => {
    const started = Date.now();
    while (!document.querySelector('#root')?.children.length) {
      if (Date.now() - started > 10000) throw new Error('La interfaz no se ha iniciado.');
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    return { title: document.title, hasBridge: Boolean(window.phonegest) };
  })()`);
  if (!ready.hasBridge) throw new Error('El puente de escritorio no está disponible.');
  const pdf = path.join(directory, 'PhoneGest-ejemplo.pdf');
  const pdfBytes = await writePdf(payload, pdf);
  const paginationPdfs = [];
  for (const count of [1, 5, 8]) {
    const filePath = path.join(directory, `PhoneGest-${count}-codigos.pdf`);
    const codes = Array.from({ length: count }, (_, index) => payload.codes[index % payload.codes.length]);
    const bytes = await writePdf({ ...payload, codes, dates: codes.map((_, index) => payload.dates[index % payload.dates.length] ?? '') }, filePath);
    paginationPdfs.push({ count, path: filePath, bytes });
  }
  const images = await writeImages(payload, path.join(directory, 'imagenes'));
  const projectPath = path.join(directory, 'PhoneGest-ejemplo.pgbs');
  await atomicWrite(projectPath, JSON.stringify(createProject(payload), null, 2));
  const reopened = readProject(JSON.parse(await readFile(projectPath, 'utf8')));
  if (reopened.codes.join('\n') !== payload.codes.join('\n')) throw new Error('No se ha conservado el proyecto.');
  if (rendererErrors.length) throw new Error(`Errores de interfaz: ${rendererErrors.join('; ')}`);
  const result = { success: true, version: app.getVersion(), ui: ready, pdf, pdfBytes, paginationPdfs, images, project: projectPath, rendererErrors };
  await atomicWrite(path.join(directory, 'smoke-result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
}

if (gotLock) {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
  app.on('window-all-closed', () => app.quit());
  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    setupSecurity();
    await loadLogo();
    updateController = createDesktopUpdateController({
      app,
      isSmoke,
      currentDisplayVersion: appDisplayVersion,
      onState: (state) => {
        if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) mainWindow.webContents.send('phonegest:updateState', state);
      },
      prepareInstall: async () => {
        if (activeJob) throw new Error('Espera a que termine la exportación o impresión antes de reiniciar.');
        installingUpdate = true;
        try { await latestSessionWrite; await sessionWrites; }
        catch (error) { installingUpdate = false; throw error; }
      },
      cancelInstall: () => { installingUpdate = false; },
      openReleasePage: (url) => shell.openExternal(url),
    });
    const maintenanceSession = session.fromPartition('phonegest-maintenance', { cache: false });
    secureUpdateSession(maintenanceSession);
    const installedDirectory = path.dirname(process.execPath);
    const hasInstalledUninstaller = await stat(path.join(installedDirectory, 'Uninstall PhoneGest Barcode Studio.exe')).then((info) => info.isFile(), () => false);
    installationManager = createInstallationManager({
      version: app.getVersion(), directory: installedDirectory,
      userData: app.getPath('userData'), localAppData: process.env.LOCALAPPDATA || path.join(app.getPath('home'), 'AppData', 'Local'),
      installed: app.isPackaged && hasInstalledUninstaller && process.platform === 'win32' && !isSmoke && !process.env.PORTABLE_EXECUTABLE_FILE && !process.env.PORTABLE_EXECUTABLE_DIR,
      fetchText: async (url) => {
        const response = await maintenanceSession.fetch(url, {
          method: 'GET', credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(30000),
          headers: { Accept: 'text/plain', 'Cache-Control': 'no-cache' },
        });
        if (!response.ok || !response.body) throw new Error('No se ha podido verificar el instalador.');
        const reader = response.body.getReader();
        const chunks = [];
        let length = 0;
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            length += value.length;
            if (length > 65536) throw new Error('Los datos del instalador son demasiado grandes.');
            chunks.push(Buffer.from(value));
          }
        } finally { await reader.cancel().catch(() => {}); }
        return Buffer.concat(chunks).toString('utf8');
      },
      chooseInstaller: async (filename) => {
        const result = await dialog.showOpenDialog(mainWindow, {
          title: `Selecciona ${filename}`,
          defaultPath: path.join(app.getPath('downloads'), filename),
          filters: [{ name: 'Instalador PhoneGest de la versión actual', extensions: ['exe'] }], properties: ['openFile'],
        });
        return result.canceled ? undefined : result.filePaths[0];
      },
      prepareInstall: async () => {
        if (activeJob || ['available', 'downloading'].includes(updateController.getState().status)) {
          throw new Error('Espera a que terminen las exportaciones o la descarga de actualizaciones antes de cambiar la ubicación.');
        }
        if (installingUpdate) throw new Error('La aplicación ya está preparando el instalador.');
        installingUpdate = true;
        try { await latestSessionWrite; await sessionWrites; }
        catch (error) { installingUpdate = false; throw error; }
      },
      cancelInstall: () => { installingUpdate = false; },
      launchInstaller: (filename) => new Promise((resolve, reject) => {
        const child = spawn(filename, [], { detached: true, stdio: 'ignore', windowsHide: true, shell: false });
        child.once('error', reject);
        child.once('spawn', () => { child.unref(); resolve(); });
      }),
      quit: () => app.quit(),
    });
    registerHandlers();
    await createMainWindow();
    updateController.start();
    if (isSmoke) {
      await runSmoke();
      app.exit(0);
    }
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : 'No se ha podido iniciar la aplicación.');
    if (!isSmoke) dialog.showErrorBox('PhoneGest Barcode Studio', 'No se ha podido iniciar la aplicación. Vuelve a instalarla o contacta con el equipo de PhoneGest.');
    app.exit(1);
  });
  app.on('before-quit', () => updateController?.dispose());
}
