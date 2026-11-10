/**
 * Validate the real Electron HTML -> printToPDF pipeline after a desktop smoke run:
 *   node tests/pdf-integration.mjs [build/smoke]
 * PDF.js and its native canvas are locked development dependencies.
 */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas } from '@napi-rs/canvas';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import zxing from '@zxing/library';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const smokeDirectory = path.resolve(process.argv[2] || path.join(ROOT, 'build', 'smoke'));
const outputDirectory = path.join(smokeDirectory, 'pdf-validation');
const { BitArray, Code128Reader } = zxing;
const DPI = 300;
const SCALE = DPI / 72;
const PIXELS_PER_MM = DPI / 25.4;
const A4_POINTS = { width: 595.2755905512, height: 841.8897637795 };
const SAMPLES = ['L3A5KA9806994060129590B', 'L3A5KA9806994140129590X', 'L3A5KA9807022320129590Q'];
const cases = [
  { file: 'PhoneGest-ejemplo.pdf', codes: SAMPLES },
  ...[1, 5, 8].map((count) => ({
    file: `PhoneGest-${count}-codigos.pdf`,
    codes: Array.from({ length: count }, (_, index) => SAMPLES[index % SAMPLES.length]),
  })),
];

function decodeScanline(image, width, height, yMm) {
  const center = Math.round(yMm * PIXELS_PER_MM);
  let lastError;
  // Nearby rows tolerate subpixel page rounding while remaining inside the bars.
  for (const offset of [0, -2, 2, -5, 5]) {
    const y = Math.min(height - 1, Math.max(0, center + offset));
    const row = new BitArray(width);
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      if ((image[index] + image[index + 1] + image[index + 2]) / 3 < 128) row.set(x);
    }
    try { return new Code128Reader().decodeRow(y, row).getText(); }
    catch (error) { lastError = error; }
  }
  throw new Error(`No se pudo leer el código a ${yMm.toFixed(2)} mm: ${lastError?.message || lastError}`);
}

await mkdir(outputDirectory, { recursive: true });
const results = [];
for (const entry of cases) {
  const filename = path.join(smokeDirectory, entry.file);
  try { await access(filename); }
  catch { throw new Error(`Falta ${filename}. Ejecuta primero electron . --smoke-test "${smokeDirectory}".`); }
  const task = getDocument({ data: new Uint8Array(await readFile(filename)), useSystemFonts: true, isEvalSupported: false });
  const pdf = await task.promise;
  const expectedPages = Math.ceil(entry.codes.length / 4);
  assert.equal(pdf.numPages, expectedPages, `${entry.file}: paginación A4`);
  const decoded = [];
  const pageDimensions = [];
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const physical = page.getViewport({ scale: 1 });
      assert.ok(Math.abs(physical.width - A4_POINTS.width) < 1, `${entry.file}: ancho A4`);
      assert.ok(Math.abs(physical.height - A4_POINTS.height) < 1, `${entry.file}: alto A4`);
      pageDimensions.push({ widthPt: physical.width, heightPt: physical.height });
      const viewport = page.getViewport({ scale: SCALE });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = canvas.getContext('2d');
      await page.render({ canvasContext: context, viewport, background: '#ffffff' }).promise;
      const image = context.getImageData(0, 0, canvas.width, canvas.height);
      const pageCodes = entry.codes.slice((pageNumber - 1) * 4, pageNumber * 4);
      const text = (await page.getTextContent()).items.map((item) => item.str || '').join(' ');
      for (let row = 0; row < pageCodes.length; row += 1) {
        const value = decodeScanline(image.data, image.width, image.height, 39 + row * 58.2 + 19.05 / 2);
        assert.equal(value, pageCodes[row], `${entry.file}: lector independiente, página ${pageNumber}, fila ${row + 1}`);
        assert.ok(text.includes(pageCodes[row]), `${entry.file}: identificador legible en texto PDF`);
        const number = (pageNumber - 1) * 4 + row + 1;
        assert.ok(text.includes(`${number}.`), `${entry.file}: numeración continua ${number}`);
        const date = ['10/11/2026', '', '09/11/2026'][(number - 1) % 3];
        if (date) assert.ok(text.includes(date), `${entry.file}: fecha individual legible en PDF`);
        decoded.push(value);
      }
      if (entry.file === 'PhoneGest-ejemplo.pdf') {
        await writeFile(path.join(outputDirectory, `ejemplo-pagina-${pageNumber}-300dpi.png`), canvas.toBuffer('image/png'));
      }
      canvas.width = 1;
      canvas.height = 1;
      page.cleanup();
    }
  } finally { await task.destroy(); }
  assert.deepEqual(decoded, entry.codes, `${entry.file}: conserva todos los identificadores en orden`);
  results.push({ file: entry.file, pages: expectedPages, labelsDecoded: decoded.length, pageDimensions, identifiers: decoded });
  console.log(`OK ${entry.file}: ${expectedPages} página(s) A4; ${decoded.length} código(s) leídos a ${DPI} dpi.`);
}
const report = { success: true, dpi: DPI, reader: 'ZXing Code128Reader', results };
await writeFile(path.join(outputDirectory, 'report.json'), JSON.stringify(report, null, 2));
console.log(`Validación PDF completa: ${results.reduce((sum, result) => sum + result.labelsDecoded, 0)} etiquetas leídas.`);
