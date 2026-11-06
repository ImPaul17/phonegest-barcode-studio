import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'artifacts');
await mkdir(output, { recursive: true });
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
const fixture = { state: ${JSON.stringify(initial)}, info: {version:'1.0.1',platform:'win32',logoDataUrl:''}, calls: [], releaseOpens: 0, failSave: false, offline: false,
  setState(value) { this.state = {...this.state, ...value}; window.webContents.send('fixture:changed', this.state); }
};
globalThis.phonegestFixture = fixture;
ipcMain.handle('fixture:info', () => fixture.info);
ipcMain.handle('fixture:load', () => null);
ipcMain.handle('fixture:save', (_event, session) => { fixture.calls.push({method:'save', session}); return !fixture.failSave; });
ipcMain.handle('fixture:state', () => fixture.state);
ipcMain.handle('fixture:check', () => { fixture.setState(fixture.offline ? {status:'error', message:'No hay conexión. Puedes seguir trabajando.'} : {status:'up-to-date', lastCheckedAt:new Date().toISOString()}); return fixture.state; });
ipcMain.handle('fixture:download', () => { fixture.calls.push({method:'download'}); fixture.setState({status:'downloading', progress:25}); return fixture.state; });
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
  const setState = async state => {
    await application.evaluate((_electron, next) => globalThis.phonegestFixture.setState(next), state);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  };
  const header = page.locator('.app-header');
  const updatesButton = header.getByRole('button', { name: 'Actualizaciones', exact: true });
  const updatesDialog = page.getByRole('dialog', { name: 'Actualizaciones', exact: true });
  const updateStatus = updatesDialog.getByRole('region', { name: 'Estado de actualización', exact: true });
  const banner = page.locator('.update-banner');
  const closeUpdates = () => updatesDialog.getByRole('button', { name: 'Cerrar actualizaciones', exact: true }).click();
  const openUpdates = async () => {
    await updatesButton.click();
    await updatesDialog.waitFor({ state: 'visible' });
    assert.equal(await page.getByRole('dialog').count(), 1, 'Only one dialog is open');
    await page.waitForFunction(() => document.querySelector('[role="dialog"][aria-labelledby]')?.contains(document.activeElement));
  };
  const assertHeaderIndicator = async () => {
    assert.ok(await updatesButton.locator('.update-indicator').isVisible(), 'The header keeps the update indicator after hiding the banner');
    const description = await updatesButton.evaluate(element => element.getAttribute('aria-description') || (element.getAttribute('aria-describedby') || '').split(/\s+/).map(id => document.getElementById(id)?.textContent || '').join(' '));
    assert.ok(description.trim(), 'The persistent indicator has an accessible status description');
  };
  const capture = async name => {
    await page.evaluate(async () => {
      await document.fonts.ready;
      const finite = document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity);
      await Promise.all(finite.map(animation => animation.finished.catch(() => {})));
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    return page.screenshot({ path: path.join(output, `phonegest-updates-${name}.png`), animations: 'disabled' });
  };
  await page.getByText('Procesamiento local', { exact: true }).waitFor();
  assert.match(await updatesButton.textContent(), /Actualizaciones/, 'The header has a visible updates label');
  await page.getByRole('button', { name: 'Configuración', exact: true }).click();
  const settingsDialog = page.getByRole('dialog', { name: 'Hazlo a tu medida', exact: true });
  await settingsDialog.waitFor({ state: 'visible' });
  assert.equal(await settingsDialog.getByRole('heading', { name: 'Actualizaciones', exact: true }).count(), 0, 'Updates are separate from document settings');
  assert.equal(await settingsDialog.getByRole('button', { name: 'Buscar actualizaciones', exact: true }).count(), 0);
  await page.keyboard.press('Escape');
  await settingsDialog.waitFor({ state: 'hidden' });
  await openUpdates();
  await updatesDialog.getByText('v1.0.1', { exact: true }).waitFor();
  const focusable = updatesDialog.locator('button:visible:not([disabled]), a[href]:visible, input:visible:not([disabled])');
  await focusable.first().focus();
  await page.keyboard.press('Shift+Tab');
  assert.equal(await focusable.last().evaluate(element => document.activeElement === element), true, 'Shift+Tab wraps to the last dialog control');
  await page.keyboard.press('Tab');
  assert.equal(await focusable.first().evaluate(element => document.activeElement === element), true, 'Tab wraps to the first dialog control');
  await updateStatus.getByRole('button', { name: 'Buscar actualizaciones', exact: true }).click();
  await updateStatus.getByText('Tienes la última versión', { exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await updatesDialog.waitFor({ state: 'hidden' });
  assert.equal(await updatesButton.evaluate(element => document.activeElement === element), true, 'Escape restores focus to the updates opener');
  await openUpdates();
  await closeUpdates();
  assert.equal(await updatesButton.evaluate(element => document.activeElement === element), true, 'The close button restores focus');
  await openUpdates();
  await page.locator('.modal-overlay').click({ position: { x: 5, y: 5 } });
  await updatesDialog.waitFor({ state: 'hidden' });
  assert.equal(await updatesButton.evaluate(element => document.activeElement === element), true, 'Outside close restores focus');

  await setState({ status: 'available', availableVersion: '1.0.2' });
  await banner.getByText('Versión 1.0.2 disponible', { exact: true }).waitFor();
  const placement = await banner.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return { insideMain: Boolean(element.closest('main')), top: rect.top, bottom: rect.bottom, headerBottom: document.querySelector('.app-header').getBoundingClientRect().bottom, mainTop: document.querySelector('main.workspace').getBoundingClientRect().top };
  });
  assert.equal(placement.insideMain, false, 'The update banner is global, outside the workspace');
  assert.ok(placement.top >= placement.headerBottom - 1 && placement.bottom <= placement.mainTop + 1, 'The banner appears below the app header and above the workspace');
  await assertHeaderIndicator();
  await capture('banner-light');
  await banner.getByRole('button', { name: 'Ver detalles', exact: true }).click();
  await updatesDialog.waitFor({ state: 'visible' });
  await capture('menu-light');
  await closeUpdates();
  await page.getByRole('button', { name: 'Cambiar a modo oscuro', exact: true }).click();
  await capture('banner-dark');
  await banner.getByRole('button', { name: 'Ver detalles', exact: true }).click();
  await updatesDialog.waitFor({ state: 'visible' });
  await capture('menu-dark');
  await updateStatus.getByRole('button', { name: 'Descargar actualización', exact: true }).click();
  await banner.getByText('Descargando versión 1.0.2 · 25 %', { exact: true }).waitFor();
  assert.equal(await updateStatus.getByRole('progressbar', { name: 'Descarga de la actualización' }).getAttribute('value'), '25');
  await closeUpdates();
  await setState({ status: 'error', message: 'La descarga se ha interrumpido. Puedes reintentar.' });
  await banner.waitFor({ state: 'visible' });
  assert.ok((await banner.textContent()).includes('1.0.2'), 'A known-version error keeps the update notice');
  await assertHeaderIndicator();
  assert.equal(await banner.getByRole('button', { name: 'Reiniciar e instalar', exact: true }).count(), 0, 'A failed download is never ready to install');
  await banner.getByRole('button', { name: 'Ver detalles', exact: true }).click();
  await updateStatus.getByRole('button', { name: 'Reintentar descarga', exact: true }).click();
  await banner.getByText('Descargando versión 1.0.2 · 25 %', { exact: true }).waitFor();
  const retryCalls = await application.evaluate(() => globalThis.phonegestFixture.calls);
  assert.equal(retryCalls.filter(call => call.method === 'download').length, 2, 'Retry invokes downloadUpdate again');
  assert.equal(retryCalls.filter(call => call.method === 'install').length, 0, 'Retry never invokes installation');
  await closeUpdates();
  await banner.getByRole('button', { name: 'Ocultar aviso de actualización', exact: true }).click();
  await banner.waitFor({ state: 'hidden' });
  await assertHeaderIndicator();
  await setState({ status: 'downloading', progress: 45 });
  assert.equal(await banner.count(), 0, 'Progress alone does not reshow a dismissed notification');
  await setState({ status: 'downloaded', progress: 100 });
  await banner.getByText('Versión 1.0.2 lista para instalar', { exact: true }).waitFor();
  await capture('ready-dark');
  await banner.getByRole('button', { name: 'Ocultar aviso de actualización', exact: true }).click();
  await banner.waitFor({ state: 'hidden' });
  await assertHeaderIndicator();
  await setState({ status: 'downloaded', progress: 100 });
  assert.equal(await banner.count(), 0, 'Repeated ready state remains dismissed');
  await setState({ status: 'available', availableVersion: '1.0.3', progress: 0 });
  await banner.getByText('Versión 1.0.3 disponible', { exact: true }).waitFor();
  await banner.getByRole('button', { name: 'Ocultar aviso de actualización', exact: true }).click();
  await banner.waitFor({ state: 'hidden' });
  await setState({ status: 'available', availableVersion: '1.0.3' });
  assert.equal(await banner.count(), 0, 'Repeated available state remains dismissed');
  await setState({ status: 'downloading', progress: 10 });
  await banner.getByText('Descargando versión 1.0.3 · 10 %', { exact: true }).waitFor();
  await banner.getByRole('button', { name: 'Ver progreso', exact: true }).click();
  assert.equal(await updateStatus.getByRole('progressbar', { name: 'Descarga de la actualización' }).getAttribute('value'), '10');
  await closeUpdates();

  await page.getByRole('button', { name: 'Probar con un ejemplo' }).click();
  await page.getByRole('button', { name: 'Añadir códigos' }).click();
  const input = page.getByRole('textbox', { name: 'Códigos separados por saltos de línea' });
  await input.fill('BORRADOR-PENDIENTE');
  await setState({ status: 'downloaded', progress: 100 });
  await banner.getByRole('button', { name: 'Reiniciar e instalar', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.update-banner button:disabled'));
  let calls = await application.evaluate(() => globalThis.phonegestFixture.calls);
  const installIndex = calls.findIndex(call => call.method === 'install');
  assert.ok(installIndex > 0);
  assert.equal(calls[installIndex - 1].method, 'save');
  assert.equal(calls[installIndex - 1].session.input, 'BORRADOR-PENDIENTE');
  assert.equal(calls[installIndex - 1].session.codes.length, 3);

  await application.evaluate(() => { globalThis.phonegestFixture.failSave = true; });
  await banner.getByRole('button', { name: 'Reiniciar e instalar', exact: true }).click();
  await page.getByRole('alert').getByText('No se pudo guardar la sesión. Guarda el proyecto antes de reiniciar.', { exact: true }).waitFor();
  calls = await application.evaluate(() => globalThis.phonegestFixture.calls);
  assert.equal(calls.filter(call => call.method === 'install').length, 1, 'A failed session save must prevent installation');
  await application.evaluate(() => { globalThis.phonegestFixture.failSave = false; globalThis.phonegestFixture.offline = true; });
  await page.getByRole('button', { name: 'Cerrar notificación', exact: true }).click();

  await setState({ status: 'idle', availableVersion: undefined, progress: undefined });
  await openUpdates();
  await updateStatus.getByRole('button', { name: 'Buscar actualizaciones', exact: true }).click();
  await updateStatus.getByText('No hay conexión. Puedes seguir trabajando.', { exact: true }).waitFor();
  assert.equal(await banner.count(), 0, 'An offline check with no known version does not announce an update');
  assert.equal(await updatesButton.locator('.update-indicator').count(), 0);
  await closeUpdates();
  await page.getByRole('button', { name: 'Añadir códigos' }).click();
  assert.equal(await page.locator('.code-row').count(), 4, 'Offline update failure must not block barcode work');

  await setState({ status: 'unsupported', canAutoUpdate: false, availableVersion: undefined, message: 'La edición portable se actualiza mediante descarga manual.' });
  await openUpdates();
  await updateStatus.getByRole('button', { name: 'Abrir descargas', exact: true }).click();
  assert.equal(await application.evaluate(() => globalThis.phonegestFixture.releaseOpens), 1);
  assert.equal(await updateStatus.getByRole('button', { name: 'Reiniciar e instalar', exact: true }).count(), 0);
  await page.keyboard.press('Escape');
  await updatesDialog.waitFor({ state: 'hidden' });
  assert.equal(await updatesButton.evaluate(element => document.activeElement === element), true);

  // Keep the legacy fixture above unchanged, then exercise display names separately.
  await application.evaluate(() => {
    globalThis.phonegestFixture.info = { version: '1.0.5', displayVersion: '1.0.4b', platform: 'win32', logoDataUrl: '' };
    globalThis.phonegestFixture.state = { status: 'idle', currentVersion: '1.0.5', canAutoUpdate: true, releaseUrl: 'https://github.com/ImPaul17/phonegest-barcode-studio/releases/latest' };
  });
  await page.reload();
  await page.locator('.bottom-meta').getByText('v1.0.4b', { exact: true }).waitFor();
  await openUpdates();
  await updateStatus.getByText('v1.0.4b', { exact: true }).waitFor();
  assert.equal(await updateStatus.getByText('v1.0.5', { exact: true }).count(), 0, 'The current display name is used when an older update state omits it');
  await closeUpdates();
  await setState({ status: 'available', currentDisplayVersion: '1.0.4b', availableVersion: '1.0.6', availableDisplayVersion: '1.0.4c' });
  await banner.getByText('Versión 1.0.4c disponible', { exact: true }).waitFor();
  const description = await updatesButton.evaluate(element => document.getElementById(element.getAttribute('aria-describedby'))?.textContent || '');
  assert.ok(description.includes('1.0.4c'), 'The accessible notice uses the available display version');
  assert.ok(!description.includes('1.0.6'), 'Internal numeric versions are not announced as display names');
  await capture('display-version-banner');
  await banner.getByRole('button', { name: 'Ver detalles', exact: true }).click();
  await updateStatus.getByText('v1.0.4b', { exact: true }).waitFor();
  await updateStatus.getByText('v1.0.4c', { exact: true }).waitFor();
  await capture('display-version-menu');
  await updateStatus.getByRole('button', { name: 'Descargar actualización', exact: true }).click();
  await banner.getByText('Descargando versión 1.0.4c · 25 %', { exact: true }).waitFor();
  await closeUpdates();
  await setState({ status: 'downloaded', progress: 100 });
  await banner.getByText('Versión 1.0.4c lista para instalar', { exact: true }).waitFor();
  const numericState = await page.evaluate(() => window.phonegest.getUpdateState());
  assert.equal(numericState.currentVersion, '1.0.5');
  assert.equal(numericState.availableVersion, '1.0.6');
  assert.deepEqual(errors, []);
  const report = { success: true, checks: ['explicit updates header button', 'updates separated from document settings', 'dedicated dialog and single modal', 'Tab trap and Escape/button/outside focus restoration', 'manual check and current version', 'global banner above workspace', 'light and dark banner/menu', 'download progress', 'known-version error retains indicator and retries download', 'dismissed notice keeps accessible header indicator', 'new state/version resurfaces notice', 'repeated state/progress stays dismissed', 'session saved before restart', 'failed save prevents restart', 'offline update failure permits barcode work without false update notice', 'portable manual downloads', 'legacy numeric version fallback', 'display versions in footer/menu/notices with numeric updater versions', 'no renderer errors'], screenshots: output };
  await writeFile(path.join(output, 'phonegest-updates-ui-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (application) await application.close();
  const cleanupPath = path.resolve(fixture);
  if (path.dirname(cleanupPath) !== path.resolve(os.tmpdir()) || !path.basename(cleanupPath).startsWith('phonegest-updater-ui-')) throw new Error('Unexpected fixture cleanup path');
  await rm(cleanupPath, { recursive: true, force: true, maxRetries: 4, retryDelay: 200 });
}
