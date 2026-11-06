import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import zxing from '@zxing/library';
import {
  createBarcodeSvg, createLabelSvg, DEFAULT_SETTINGS, encodeCode128, LAYOUTS,
  MAX_CODES, MAX_CODE_LENGTH, MIN_MODULE_WIDTH_MM, normalizeSettings,
  paginateCodes, parseCodes, QUIET_ZONE_MODULES, renderDocument, validateCode,
} from '../shared/index.mjs';

const { BitArray, Code128Reader } = zxing;
const EXAMPLES = ['L3A5KA9806994060129590B', 'L3A5KA9806994140129590X', 'L3A5KA9807022320129590Q'];

function decodeBits(data) {
  const row = new BitArray(data.length);
  for (let index = 0; index < data.length; index += 1) if (data[index] === '1') row.set(index);
  return new Code128Reader().decodeRow(0, row).getText();
}

async function decodeSvg(svg, relativeRow = 0.35) {
  const widthMm = Number(svg.match(/width="([\d.]+)mm"/)[1]);
  // Explicit target width also covers librsvg versions that apply density twice to mm dimensions.
  const { data, info } = await sharp(Buffer.from(svg), { density: 300 }).resize({ width: Math.round(widthMm * 300 / 25.4) }).flatten({ background: '#ffffff' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const scanY = Math.floor(info.height * relativeRow);
  const row = new BitArray(info.width);
  for (let x = 0; x < info.width; x += 1) {
    const offset = (scanY * info.width + x) * info.channels;
    if ((data[offset] + data[offset + 1] + data[offset + 2]) / 3 < 128) row.set(x);
  }
  return new Code128Reader().decodeRow(scanY, row).getText();
}

test('all supplied PhoneGest identifiers survive independent raster scanning at 300 dpi', async () => {
  for (const value of EXAMPLES) {
    assert.equal(await decodeSvg(createBarcodeSvg(value)), value);
    assert.equal(await decodeSvg(createLabelSvg(value, { number: 7 })), value);
  }
});

test('mixed case, long numeric sequences and printable ASCII preserve exact text', async () => {
  for (const value of ['abCD12345678901234567890z', '123456789012345678901234567890123456789012345', 'A & B <C> "D" /+_-', 'x'.repeat(MAX_CODE_LENGTH)]) {
    assert.equal(await decodeSvg(createBarcodeSvg(value, { maxWidthMm: 157, showText: true })), value);
    assert.equal(await decodeSvg(createLabelSvg(value)), value);
  }
});

test('real Code 128 includes a checksum that an independent reader rejects when corrupted', () => {
  const a = encodeCode128('ABC123');
  const b = encodeCode128('ABC124');
  const padded = '0'.repeat(QUIET_ZONE_MODULES) + a + '0'.repeat(QUIET_ZONE_MODULES);
  assert.equal(decodeBits(padded), 'ABC123');
  const corrupted = a.slice(0, -24) + b.slice(-24, -13) + a.slice(-13);
  assert.throws(() => decodeBits('0'.repeat(12) + corrupted + '0'.repeat(12)), /checksum/i);
});

test('validation rejects empty, unsupported Unicode, controls and oversized identifiers', () => {
  for (const value of ['', '   ', 'á123', 'CODE\n123', 'AB\t12', '\u00f112', '\x0012', 'A'.repeat(MAX_CODE_LENGTH + 1)]) {
    assert.equal(validateCode(value).valid, false, JSON.stringify(value));
    assert.throws(() => createBarcodeSvg(value));
  }
  assert.equal(validateCode('aB-12_3').valid, true);
});

test('pasted input ignores blank lines, retains case, reports source lines and permits duplicate labels', () => {
  const result = parseCodes('  Ab123  \r\n\r\nAb123\nAB123\rInválido\rZ9');
  assert.deepEqual(result.codes, ['Ab123', 'Ab123', 'AB123', 'Z9']);
  assert.equal(result.duplicateCount, 1);
  assert.deepEqual(result.duplicates, [{ code: 'Ab123', count: 2 }]);
  assert.equal(result.invalidLines.length, 1);
  assert.equal(result.invalidLines[0].line, 5);
});

test('batch limit reports remaining input instead of silently accepting unlimited codes', () => {
  const result = parseCodes(Array.from({ length: MAX_CODES + 2 }, (_, index) => `CODE${index}`).join('\n'));
  assert.equal(result.codes.length, MAX_CODES);
  assert.equal(result.invalidLines.length, 2);
  assert.throws(() => paginateCodes(Array(MAX_CODES + 1).fill('A')), /1000/);
});

test('settings normalize untrusted persisted values and keep explicit toggles', () => {
  assert.deepEqual(normalizeSettings({ layout: 'unknown', startNumber: -2, showText: 'false' }), DEFAULT_SETTINGS);
  assert.equal(normalizeSettings({ startNumber: '12', showText: false }).startNumber, 12);
  assert.equal(normalizeSettings({ showText: false }).showText, false);
  assert.equal(normalizeSettings({ documentTitle: 'x'.repeat(150) }).documentTitle.length, 120);
  assert.deepEqual(normalizeSettings(null), DEFAULT_SETTINGS);
});

test('four-label PhoneGest format paginates continuously; other layouts expose capacity', () => {
  const codes = Array.from({ length: 9 }, (_, index) => `PG${index}`);
  assert.deepEqual(paginateCodes(codes).map((page) => page.length), [4, 4, 1]);
  assert.deepEqual(paginateCodes(codes, { layout: 'compact' }).map((page) => page.length), [7, 2]);
  assert.deepEqual(paginateCodes(codes, { layout: 'large' }).map((page) => page.length), [2, 2, 2, 2, 1]);
  assert.equal(LAYOUTS.comfortable.rowsPerPage, 4);
});

test('barcodes have quiet zones, positive module sizes and reject shrinking below printable dimensions', () => {
  const svg = createBarcodeSvg('A'.repeat(MAX_CODE_LENGTH), { maxWidthMm: 157 });
  const moduleWidth = Number(svg.match(/data-module-width-mm="([\d.]+)"/)[1]);
  assert.ok(moduleWidth >= MIN_MODULE_WIDTH_MM);
  assert.match(svg, new RegExp(`<rect x="${QUIET_ZONE_MODULES}"`));
  assert.throws(() => createBarcodeSvg('LONG-CODE-12345', { maxWidthMm: 8 }), /demasiado largo/);
});

test('document embeds vector labels, continuous numbering, checkboxes and only local logo data', () => {
  const logo = 'data:image/png;base64,aGVsbG8=';
  const html = renderDocument({ codes: [...EXAMPLES, 'FOUR', 'FIVE'], settings: { startNumber: 8, documentTitle: '<PhoneGest & test>' }, logoDataUrl: logo });
  assert.equal((html.match(/class="page sheet"/g) ?? []).length, 2);
  assert.equal((html.match(/data-code128="true"/g) ?? []).length, 5);
  assert.equal((html.match(/class="checkbox"/g) ?? []).length, 5);
  assert.match(html, />8\. L3A5KA9806994060129590B</);
  assert.match(html, />12\. FIVE</);
  assert.match(html, /&lt;PhoneGest &amp; test&gt;/);
  assert.match(html, /width: 210mm; height: 297mm/);
  assert.ok(html.includes(logo));
  assert.ok(!html.includes('<script'));
  assert.ok(!renderDocument({ codes: ['OK'], logoDataUrl: 'https://example.com/logo.png' }).includes('https://example.com'));
});

test('print options remove text, numbers and checkboxes while keeping scanner payload', async () => {
  const html = renderDocument({ codes: [EXAMPLES[0]], settings: { showNumbers: false, showCheckboxes: false, showText: false } });
  assert.ok(!html.includes('class="identifier"'));
  assert.ok(!html.includes('class="checkbox"'));
  assert.equal(await decodeSvg(createLabelSvg(EXAMPLES[0], { showNumbers: false, showCheckboxes: false, showText: false })), EXAMPLES[0]);
});

test('empty preview is one branded A4 sheet and invalid document identifiers fail clearly', () => {
  assert.equal((renderDocument().match(/class="page sheet"/g) ?? []).length, 1);
  assert.throws(() => renderDocument({ codes: ['error\n123'] }), /ASCII/);
});
