import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const fixture = await mkdtemp(path.join(os.tmpdir(), 'phonegest-updater-ui-'));
const initial = { status: 'idle', currentVersion: '1.0.1', canAutoUpdate: true, releaseUrl: 'https://github.com/ImPaul17/phonegest-barcode-studio/releases/latest' };
const preload = `const {contextBridge, ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('phonegest', {
  getAppInfo: () => ipcRenderer.invoke('fixture:info'),
  loadSession: () => ipcRenderer.invoke('fixture:load'),
  saveSession: value => ipcRenderer.invoke('fixture:save', value),
  readClipboard: async () => '',
  getUpdateState: () => ipcRenderer.invoke('fixture:state'),
  checkForUpdates: () => ipcRenderer.invoke('fixture:check'),
  downloadUpdate: () => ipcRenderer.invoke('fixture:download'),
  installUpdate: () => ipcRenderer.invoke('fixture:install'),
  openReleasePage: () => ipcRenderer.invoke('fixture:releases'),
  onUpdateState: callback => { const handler = (_event, state) => callback(state); ipcRenderer.on('fixture:changed', handler); return () => ipcRenderer.removeListener('fixture:changed', handler); }
});`;
const main = `const {app, BrowserWindow, ipcMain} = require('electron');
app.setPath('userData', ${JSON.stringify(path.join(fixture, 'user-data'))});
let window;
const fixture = { state: ${JSON.stringify(initial)}, calls: [], releaseOpens: 0, failSave: false, offline: false,
  setState(value) { this.state = {...this.state, ...value}; window.webContents.send('fixture:changed', this.state); }
};
globalThis.phonegestFixture = fixture;
ipcMain.handle('fixture:info', () => ({version:'1.0.1', platform:'win32', logoDataUrl:''}));
ipcMain.handle('fixture:load', () => null);
ipcMain.handle('fixture:save', (_event, session) => { fixture.calls.push({method:'save', session}); return !fixture.failSave; });
ipcMain.handle('fixture:state', () => fixture.state);
ipcMain.handle('fixture:check', () => { fixture.setState(fixture.offline ? {status:'error', message:'No hay conexión. Puedes seguir trabajando.'} : {status:'up-to-date', lastCheckedAt:new Date().toISOString()}); return fixture.state; });
ipcMain.handle('fixture:download', () => { fixture.setState({status:'downloading', progress:25}); return fixture.state; });
ipcMain.handle('fixture:install', () => { fixture.calls.push({method:'install'}); });
ipcMain.handle('fixture:releases', () => { fixture.releaseOpens++; });
app.whenReady().then(async () => {
  window = new BrowserWindow({show:false, width:1440, height:970, webPreferences:{preload:${JSON.stringify(path.join(fixture, 'preload.cjs'))}, contextIsolation:true, sandbox:true, nodeIntegration:false}});
  await window.loadFile(${JSON.stringify(path.join(root, 'dist', 'index.html'))}); window.show();
});
app.on('window-all-closed', () => app.quit());`;
await writeFile(path.join(fixture, 'preload.cjs'), preload);
await writeFile(path.join(fixture, 'main.cjs'), main);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
let application;
try {
  application = await electron.launch({ executablePath: require('electron'), args: [path.join(fixture, 'main.cjs')], env, timeout: 45000 });
  const page = await application.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const setState = state => application.evaluate((_electron, next) => globalThis.phonegestFixture.setState(next), state);
  const settings = page.getByRole('region', { name: 'Actualizaciones', exact: true });
  await page.getByText('Procesamiento local', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Actualizaciones', exact: true }).click();
  await settings.getByText('v1.0.1', { exact: true }).waitFor();
  await page.waitForFunction(() => document.activeElement?.classList.contains('updates-section'));
  await settings.getByRole('button', { name: 'Buscar actualizaciones', exact: true }).click();
  await settings.getByText('Tienes la última versión', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Cerrar configuración', exact: true }).click();

  await setState({ status: 'available', availableVersion: '1.0.2' });
  const banner = page.getByRole('status').filter({ hasText: 'Versión 1.0.2 disponible' });
  await banner.getByRole('button', { name: 'Descargar actualización', exact: true }).click();
  await page.getByText('Descargando versión 1.0.2 · 25 %', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Ver progreso', exact: true }).click();
  assert.equal(await settings.getByRole('progressbar', { name: 'Descarga de la actualización' }).getAttribute('value'), '25');
  await page.getByRole('button', { name: 'Cerrar configuración', exact: true }).click();

  await page.getByRole('button', { name: 'Probar con un ejemplo' }).click();
  await page.getByRole('button', { name: 'Añadir códigos' }).click();
  const input = page.getByRole('textbox', { name: 'Códigos separados por saltos de línea' });
  await input.fill('BORRADOR-PENDIENTE');
  await setState({ status: 'downloaded', progress: 100 });
  await page.getByRole('button', { name: 'Reiniciar e instalar', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.update-banner button:disabled'));
  let calls = await application.evaluate(() => globalThis.phonegestFixture.calls);
  const installIndex = calls.findIndex(call => call.method === 'install');
  assert.ok(installIndex > 0);
  assert.equal(calls[installIndex - 1].method, 'save');
  assert.equal(calls[installIndex - 1].session.input, 'BORRADOR-PENDIENTE');
  assert.equal(calls[installIndex - 1].session.codes.length, 3);

  await application.evaluate(() => { globalThis.phonegestFixture.failSave = true; });
  await page.getByRole('button', { name: 'Reiniciar e instalar', exact: true }).click();
  await page.getByRole('alert').getByText('No se pudo guardar la sesión. Guarda el proyecto antes de reiniciar.', { exact: true }).waitFor();
  calls = await application.evaluate(() => globalThis.phonegestFixture.calls);
  assert.equal(calls.filter(call => call.method === 'install').length, 1, 'A failed session save must prevent installation');
  await application.evaluate(() => { globalThis.phonegestFixture.failSave = false; globalThis.phonegestFixture.offline = true; });
  await page.getByRole('button', { name: 'Cerrar notificación', exact: true }).click();

  await setState({ status: 'idle', availableVersion: undefined });
  await page.getByRole('button', { name: 'Actualizaciones', exact: true }).click();
  await settings.getByRole('button', { name: 'Buscar actualizaciones', exact: true }).click();
  await settings.getByText('No hay conexión. Puedes seguir trabajando.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Cerrar configuración', exact: true }).click();
  await page.getByRole('button', { name: 'Añadir códigos' }).click();
  assert.equal(await page.locator('.code-row').count(), 4, 'Offline update failure must not block barcode work');

  await setState({ status: 'unsupported', canAutoUpdate: false, message: 'La edición portable se actualiza mediante descarga manual.' });
  await page.getByRole('button', { name: 'Actualizaciones', exact: true }).click();
  await settings.getByRole('button', { name: 'Abrir descargas', exact: true }).click();
  assert.equal(await application.evaluate(() => globalThis.phonegestFixture.releaseOpens), 1);
  assert.equal(await settings.getByRole('button', { name: 'Reiniciar e instalar', exact: true }).count(), 0);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ success: true, checks: ['header local processing', 'updates focus and current version', 'manual check', 'version available banner', 'download progress', 'session saved before restart', 'failed save prevents restart', 'offline update failure permits barcode work', 'portable manual downloads', 'no renderer errors'] }, null, 2));
} finally {
  if (application) await application.close();
  const cleanupPath = path.resolve(fixture);
  if (path.dirname(cleanupPath) !== path.resolve(os.tmpdir()) || !path.basename(cleanupPath).startsWith('phonegest-updater-ui-')) throw new Error('Unexpected fixture cleanup path');
  await rm(cleanupPath, { recursive: true, force: true, maxRetries: 4, retryDelay: 200 });
}
