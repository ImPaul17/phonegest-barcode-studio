import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { unzipSync } from 'fflate';
import { chromium } from 'playwright';
import sharp from 'sharp';
import zxing from '@zxing/library';
import { preview } from 'vite';

const codes = ['PG-ENVIO-001', 'PG-ENVIO-002'];
const draft = 'PG-BORRADOR-003';
const packageInfo = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const urlIndex = process.argv.indexOf('--url');
const externalUrl = urlIndex === -1 ? null : process.argv[urlIndex + 1];
if (urlIndex !== -1 && !externalUrl) throw new Error('Indica la URL que se debe probar después de --url.');

async function checkPng({ name, bytes }, code) {
  const metadata = await sharp(bytes).metadata();
  assert.equal(metadata.format, 'png', name);
  assert.equal(metadata.width, 2197, name);
  assert.equal(metadata.height, 520, name);
  assert.equal(metadata.density, 300, name);
  const { data, info } = await sharp(bytes).flatten({ background: '#fff' }).greyscale().raw().toBuffer({ resolveWithObject: true });
  let decoded;
  for (const fraction of [0.5, 0.45, 0.55, 0.6]) {
    const y = Math.floor(info.height * fraction);
    const row = new zxing.BitArray(info.width);
    for (let x = 0; x < info.width; x += 1) {
      if (data[(y * info.width + x) * info.channels] < 128) row.set(x);
    }
    try { decoded = new zxing.Code128Reader().decodeRow(y, row).getText(); break; }
    catch { /* Try another row through the bars. */ }
  }
  assert.equal(decoded, code, `${name}: independently decoded Code 128`);
}

async function downloadFrom(page, button) {
  const [download] = await Promise.all([page.waitForEvent('download'), button.click()]);
  assert.equal(await download.failure(), null);
  return { name: download.suggestedFilename(), bytes: await readFile(await download.path()) };
}

async function chooseAppearance(page, name, theme) {
  await page.getByRole('button', { name: 'Configuración', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Hazlo a tu medida' });
  await settings.getByRole('button', { name, exact: true }).click();
  await settings.getByRole('button', { name, exact: true, pressed: true }).waitFor();
  await page.locator(`html[data-theme="${theme}"]`).waitFor({ state: 'attached' });
  await settings.getByRole('button', { name: 'Listo', exact: true }).click();
  await settings.waitFor({ state: 'hidden' });
}

let server;
let browser;
try {
  if (!externalUrl) server = await preview({ mode: 'web', preview: { host: '127.0.0.1', port: 0 } });
  const url = externalUrl || `http://127.0.0.1:${server.httpServer.address().port}/phonegest-barcode-studio/`;
  const origin = new URL(url).origin;
  const useEdge = process.platform === 'win32' && !existsSync(chromium.executablePath());
  browser = await chromium.launch(useEdge ? { channel: 'msedge' } : {});
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const unexpectedRequests = [];
  await context.route('**/*', route => {
    const request = route.request();
    const target = new URL(request.url());
    if (!['https:', 'http:'].includes(target.protocol)) return route.continue();
    const sendsFixture = [...codes, draft].some(value => target.href.includes(value) || request.postData()?.includes(value));
    if (target.origin === origin && ['GET', 'HEAD'].includes(request.method()) && !sendsFixture) return route.continue();
    unexpectedRequests.push(`${request.method()} ${target.origin}${target.pathname}`);
    return route.abort();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.setDefaultTimeout(15000);
  await page.addInitScript(() => {
    if (window !== window.top) return;
    // Exercise the real, broadly supported browser fallback with actual downloads.
    Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: undefined });
    window.testPrintedDocuments = [];
    // Headless Chromium cannot show the system dialog. Capture the document
    // sent to print, then let the app exercise its normal cleanup handler.
    document.addEventListener('load', (event) => {
      const frame = event.target;
      if (!(frame instanceof HTMLIFrameElement) || frame.title !== 'Documento A4 para imprimir') return;
      const printWindow = frame.contentWindow;
      printWindow.print = () => {
        const printed = printWindow.document;
        window.testPrintedDocuments.push({
          identifiers: Array.from(printed.querySelectorAll('.identifier'), element => element.textContent),
          styles: printed.querySelector('style').textContent,
          dates: Array.from(printed.querySelectorAll('.label-date'), element => element.textContent),
          title: printed.title,
          topTitle: window.document.title,
        });
        printWindow.dispatchEvent(new printWindow.Event('afterprint'));
      };
    }, true);
  });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const response = await page.goto(url);
  assert.ok(response?.ok(), 'The web build is served at its public URL');
  await page.getByRole('main', { name: 'Espacio de trabajo', exact: true }).waitFor();
  await page.getByText('WEB', { exact: true }).waitFor();
  assert.equal(await page.getByText('PG', { exact: true }).count(), 0, 'The PG avatar is removed');
  await page.locator('.bottom-meta').getByText(`v${packageInfo.version}`, { exact: true }).waitFor();
  const downloads = page.getByRole('link', { name: 'Descargar para Windows', exact: true });
  assert.equal(await downloads.getAttribute('href'), 'https://github.com/ImPaul17/phonegest-barcode-studio/releases/latest');
  const input = page.getByRole('textbox', { name: 'Códigos separados por saltos de línea', exact: true });
  const summary = page.getByText('2 códigos listos para exportar', { exact: true });
  const document = page.frameLocator('iframe[title*="documento A4"]');
  await input.fill(codes.join('\n'));
  await page.getByRole('button', { name: /^Añadir códigos/ }).click();
  await summary.waitFor();
  await document.locator('section.page').waitFor();
  assert.deepEqual(await document.locator('.identifier').allTextContents(), codes.map((code, index) => `${index + 1}. ${code}`));
  assert.equal(await document.locator('.label svg').count(), codes.length);

  const a4Frame = page.locator('iframe[title*="documento A4"]');
  const a4BeforeTheme = await a4Frame.getAttribute('srcdoc');
  await chooseAppearance(page, 'Oscuro', 'dark');
  assert.equal(await a4Frame.getAttribute('srcdoc'), a4BeforeTheme, 'The theme must not change the vector A4 document');
  assert.equal(await document.locator('section.page').evaluate(paper => getComputedStyle(paper).backgroundColor), 'rgb(255, 255, 255)');
  await input.fill(draft);
  await page.waitForFunction(value => {
    const saved = JSON.parse(localStorage.getItem('phonegest-barcode-studio/session') || 'null');
    return saved?.input === value && saved.theme === 'dark';
  }, draft);
  await page.reload();
  await summary.waitFor();
  assert.equal(await input.inputValue(), draft, 'The browser restores the draft and generated codes');
  await page.locator('html[data-theme="dark"]').waitFor({ state: 'attached' });

  const project = await downloadFrom(page, page.getByRole('button', { name: 'Guardar proyecto', exact: true }));
  assert.match(project.name, /\.pgbs$/i);
  const parsed = JSON.parse(project.bytes.toString('utf8'));
  assert.equal(parsed.application, 'phonegest-barcode-studio');
  assert.equal(parsed.version, 1);
  assert.deepEqual(parsed.codes, codes);
  await page.getByRole('button', { name: 'Vaciar', exact: true }).click();
  await page.getByRole('button', { name: 'Vaciar documento', exact: true }).click();
  await summary.waitFor({ state: 'hidden' });
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: 'Abrir proyecto', exact: true }).click(),
  ]);
  const fixture = {
    ...parsed,
    dates: ['2026-11-10', '2026-12-31'],
    settings: { ...parsed.settings, startNumber: 17, documentTitle: 'Envío de {total} paquetes', filenameTemplate: 'phonegest-{total}-{inicio}-{final}-{primero}.pdf' },
  };
  await chooser.setFiles({ name: project.name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)) });
  await summary.waitFor();
  await document.locator('.identifier').last().waitFor();
  assert.deepEqual(await document.locator('.identifier').allTextContents(), codes.map((code, index) => `${index + 17}. ${code}`));
  assert.deepEqual(await document.locator('.label-date').allTextContents(), ['10/11/2026', '31/12/2026']);
  assert.equal(await document.locator('.document-title').textContent(), 'Envío de 2 paquetes');

  const restored = await downloadFrom(page, page.getByRole('button', { name: 'Guardar proyecto', exact: true }));
  const restoredProject = JSON.parse(restored.bytes.toString('utf8'));
  assert.deepEqual(restoredProject.dates, fixture.dates, 'Individual dates survive project round trips');
  assert.equal(restoredProject.settings.filenameTemplate, fixture.settings.filenameTemplate);

  const exportImages = page.getByRole('button', { name: 'Exportar imágenes', exact: true });
  const exportChoice = async label => {
    await exportImages.click();
    return page.getByRole('menuitem', { name: label, exact: false });
  };
  const images = await downloadFrom(page, await exportChoice('Guardar imágenes en ZIP'));
  assert.equal(images.name, 'phonegest-2-17-18-PG-ENVIO-001.zip');
  const files = Object.entries(unzipSync(images.bytes)).sort(([left], [right]) => left.localeCompare(right)).map(([name, bytes]) => ({ name, bytes }));
  assert.equal(files.length, codes.length);
  for (const [index, file] of files.entries()) await checkPng(file, codes[index]);
  const individualDownloads = [];
  let finishDownloads;
  const allDownloads = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('The browser did not start both separate PNG downloads')), 15000);
    finishDownloads = () => { clearTimeout(timeout); resolve(); };
  });
  const onDownload = download => { individualDownloads.push(download); if (individualDownloads.length === 2) finishDownloads(); };
  page.on('download', onDownload);
  await (await exportChoice('Guardar imágenes sueltas')).click();
  await page.getByRole('status').getByText(/Se solicitaron 2 descargas PNG sueltas/).waitFor();
  await allDownloads;
  await page.waitForFunction(() => !document.querySelector('.export-actions button:disabled'));
  page.off('download', onDownload);
  assert.equal(individualDownloads.length, 2, 'Folder fallback requests real separate downloads');
  for (const [index, download] of individualDownloads.entries()) {
    assert.equal(await download.failure(), null);
    await checkPng({ name: download.suggestedFilename(), bytes: await readFile(await download.path()) }, codes[index]);
  }
  const previousTitle = await page.title();
  for (const name of ['Guardar como PDF', 'Imprimir']) {
    await page.getByRole('button', { name, exact: true }).click();
    const expectedCount = name === 'Imprimir' ? 2 : 1;
    await page.waitForFunction(count => window.testPrintedDocuments.length === count, expectedCount);
    const printed = await page.evaluate(() => window.testPrintedDocuments.at(-1));
    assert.match(printed.styles, /@page\s*\{\s*size:\s*A4 portrait/);
    assert.deepEqual(printed.identifiers, codes.map((code, index) => `${index + 17}. ${code}`));
    assert.deepEqual(printed.dates, ['10/11/2026', '31/12/2026']);
    assert.equal(printed.title, 'phonegest-2-17-18-PG-ENVIO-001.pdf', 'The printed frame provides the requested PDF filename');
    assert.equal(printed.topTitle, printed.title, 'The top document also provides the suggested filename');
    assert.equal(await page.title(), previousTitle, 'The normal page title is restored after printing');
  }

  // Use a browser file-system adapter only for the native chooser, then verify
  // the production renderer and each actual PNG byte written through it.
  await page.evaluate(() => {
    window.testWrittenImages = [];
    Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: async options => {
      window.testDirectoryOptions = options;
      return { getFileHandle: async name => ({ createWritable: async () => ({
        write: async blob => window.testWrittenImages.push({ name, bytes: Array.from(new Uint8Array(await blob.arrayBuffer())) }),
        close: async () => {},
      }) }) };
    } });
  });
  await (await exportChoice('Guardar imágenes sueltas')).click();
  await page.getByRole('status').getByText('2 imágenes guardadas en la carpeta elegida.', { exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.testDirectoryOptions), { mode: 'readwrite', id: 'phonegest-images' });
  const written = await page.evaluate(() => window.testWrittenImages);
  assert.equal(written.length, 2);
  for (const [index, file] of written.entries()) await checkPng({ ...file, bytes: Buffer.from(file.bytes) }, codes[index]);
  await page.evaluate(() => Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: async () => { throw new DOMException('Denied', 'NotAllowedError'); } }));
  await (await exportChoice('Guardar imágenes sueltas')).click();
  await page.getByRole('alert').getByText(/El navegador no ha permitido elegir la carpeta/).waitFor();
  await page.getByRole('button', { name: 'Cerrar notificación', exact: true }).click();
  await page.locator('.code-row').last().hover();
  await page.getByRole('button', { name: 'Eliminar código 2', exact: true }).click();
  await page.getByText('1 código listo para exportar', { exact: true }).waitFor();
  const single = await downloadFrom(page, await exportChoice('Guardar imágenes en ZIP'));
  assert.equal(single.name, 'phonegest-1-17-17-PG-ENVIO-001.zip', 'An explicit ZIP export stays ZIP for a single code');
  const singleFiles = Object.entries(unzipSync(single.bytes));
  assert.equal(singleFiles.length, 1);
  await checkPng({ name: singleFiles[0][0], bytes: singleFiles[0][1] }, codes[0]);
  await chooseAppearance(page, 'Claro', 'light');

  assert.deepEqual(unexpectedRequests, [], 'The application only reads its own assets and never transmits entered codes');
  assert.deepEqual(errors, [], 'The browser reports no page or resource errors');
  console.log(JSON.stringify({ success: true, url, version: packageInfo.version, pngs: files.map(file => file.name), checks: ['browser edition and Windows downloads link', 'A4 Code 128 preview', 'light/dark themes preserve white A4 preview and restore after reload', 'local draft and session restore', 'project date and filename-variable round trip', 'ZIP for one or multiple codes independently decoded at 300 dpi', 'separate PNG downloads with clear browser fallback notice', 'folder picker writes real PNG bytes and reports permission errors', 'individual dates in preview and printed A4 document', 'resolved PDF filename suggested and normal page title restored', 'no cross-origin requests or browser errors'] }, null, 2));
} finally {
  await browser?.close();
  await server?.close();
}
