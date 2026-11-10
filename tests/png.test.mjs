import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import zxing from '@zxing/library';
import { createLabelPng, IMAGE_DPI, IMAGE_WIDTH_MM, IMAGE_HEIGHT_MM, IMAGE_WIDTH_PX, IMAGE_HEIGHT_PX } from '../electron/image-export.mjs';
import { MAX_CODE_LENGTH } from '../shared/index.mjs';

const { BitArray, Code128Reader } = zxing;
const samples = ['L3A5KA9806994060129590B', 'L3A5KA9806994140129590X', 'L3A5KA9807022320129590Q'];
const logoDataUrl = `data:image/png;base64,${(await readFile(new URL('../assets/phonegest-reference.png', import.meta.url))).toString('base64')}`;

async function scanPng(bytes) {
  const { data, info } = await sharp(bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const y = Math.round(info.height * 0.5);
  const row = new BitArray(info.width);
  for (let x = 0; x < info.width; x += 1) {
    const index = (y * info.width + x) * info.channels;
    if ((data[index] + data[index + 1] + data[index + 2]) / 3 < 128) row.set(x);
  }
  return new Code128Reader().decodeRow(y, row).getText();
}

test('real PNG exporter records exact 186 × 44 mm label pixels at 300 dpi', async () => {
  const bytes = await createLabelPng(samples[0], { number: 1, logoDataUrl });
  const image = await sharp(bytes).metadata();
  assert.equal(image.format, 'png');
  assert.equal(image.width, IMAGE_WIDTH_PX);
  assert.equal(image.height, IMAGE_HEIGHT_PX);
  assert.equal(image.width, Math.round(IMAGE_WIDTH_MM * IMAGE_DPI / 25.4));
  assert.equal(image.height, Math.round(IMAGE_HEIGHT_MM * IMAGE_DPI / 25.4));
  assert.equal(image.width, 2197);
  assert.equal(image.height, 520);
  assert.equal(image.density, 300);
  assert.ok(Math.abs(image.width / image.density * 25.4 - IMAGE_WIDTH_MM) < 0.05);
  assert.ok(Math.abs(image.height / image.density * 25.4 - IMAGE_HEIGHT_MM) < 0.05);
  assert.equal(await scanPng(bytes), samples[0]);
});

test('exported branded PNGs independently decode all supplied identifiers at their real output size', async () => {
  for (let index = 0; index < samples.length; index += 1) {
    const png = await createLabelPng(samples[index], { number: index + 1, logoDataUrl });
    assert.equal(await scanPng(png), samples[index]);
  }
});

test('maximum-length ASCII PNG labels remain scannable with logo, large numbering and toggles', async () => {
  for (const code of ['W'.repeat(MAX_CODE_LENGTH), 'abCD12_-'.repeat(6).slice(0, MAX_CODE_LENGTH), '1234567890'.repeat(5).slice(0, MAX_CODE_LENGTH)]) {
    const png = await createLabelPng(code, { number: 999999, logoDataUrl });
    assert.equal(await scanPng(png), code);
    const withoutText = await createLabelPng(code, { showNumbers: false, showText: false, showCheckboxes: false, logoDataUrl });
    assert.equal(await scanPng(withoutText), code);
  }
});

test('individual dates do not narrow bars or impair maximum-length PNG scanning', async () => {
  for (const code of [samples[0], 'W'.repeat(MAX_CODE_LENGTH), '1234567890'.repeat(5).slice(0, MAX_CODE_LENGTH)]) {
    const png = await createLabelPng(code, { number: 999999, date: '2026-11-10', logoDataUrl });
    assert.equal(await scanPng(png), code);
  }
  await assert.rejects(() => createLabelPng('OK', { date: '2026-02-30' }), /fecha/);
});
