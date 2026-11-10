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
  page.setDefaultTimeout(15000);
  await page.addInitScript(() => {
    if (window !== window.top) return;
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

  await input.fill(draft);
  await page.waitForFunction(value => Object.values(localStorage).some(text => text.includes(value)), draft);
  await page.reload();
  await summary.waitFor();
  assert.equal(await input.inputValue(), draft, 'The browser restores the draft and generated codes');

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
  await chooser.setFiles({ name: project.name, mimeType: 'application/json', buffer: project.bytes });
  await summary.waitFor();
  await document.locator('.identifier').last().waitFor();
  assert.deepEqual(await document.locator('.identifier').allTextContents(), codes.map((code, index) => `${index + 1}. ${code}`));

  const exportImages = page.getByRole('button', { name: 'Exportar imágenes', exact: true });
  const images = await downloadFrom(page, exportImages);
  assert.match(images.name, /\.zip$/i);
  const files = Object.entries(unzipSync(images.bytes)).sort(([left], [right]) => left.localeCompare(right)).map(([name, bytes]) => ({ name, bytes }));
  assert.equal(files.length, codes.length);
  for (const [index, file] of files.entries()) await checkPng(file, codes[index]);
  for (const name of ['Guardar como PDF', 'Imprimir']) {
    await page.getByRole('button', { name, exact: true }).click();
    const expectedCount = name === 'Imprimir' ? 2 : 1;
    await page.waitForFunction(count => window.testPrintedDocuments.length === count, expectedCount);
    const printed = await page.evaluate(() => window.testPrintedDocuments.at(-1));
    assert.match(printed.styles, /@page\s*\{\s*size:\s*A4 portrait/);
    assert.deepEqual(printed.identifiers, codes.map((code, index) => `${index + 1}. ${code}`));
  }
  await page.locator('.code-row').last().hover();
  await page.getByRole('button', { name: 'Eliminar código 2', exact: true }).click();
  await page.getByText('1 código listo para exportar', { exact: true }).waitFor();
  const single = await downloadFrom(page, exportImages);
  assert.match(single.name, /\.png$/i);
  await checkPng(single, codes[0]);

  assert.deepEqual(unexpectedRequests, [], 'The application only reads its own assets and never transmits entered codes');
  assert.deepEqual(errors, [], 'The browser reports no page or resource errors');
  console.log(JSON.stringify({ success: true, url, version: packageInfo.version, pngs: files.map(file => file.name), checks: ['browser edition and Windows downloads link', 'A4 Code 128 preview', 'local draft and session restore', 'project download and import', 'single PNG and ZIP downloads independently decoded at 300 dpi', 'A4 document sent to the browser print dialog', 'no cross-origin requests or browser errors'] }, null, 2));
} finally {
  await browser?.close();
  await server?.close();
}
