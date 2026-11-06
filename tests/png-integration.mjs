/** Validate the real PNG files exported by a desktop/packaged smoke run. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import sharp from 'sharp';
import zxing from '@zxing/library';

const { BitArray, Code128Reader } = zxing;
const directory = path.resolve(process.argv[2] || 'build/smoke');
const smoke = JSON.parse(await readFile(path.join(directory, 'smoke-result.json'), 'utf8'));
const expected = ['L3A5KA9806994060129590B', 'L3A5KA9806994140129590X', 'L3A5KA9807022320129590Q'];
assert.equal(smoke.images.length, expected.length);
const results = [];
for (let index = 0; index < smoke.images.length; index += 1) {
  const file = smoke.images[index];
  const bytes = await readFile(file);
  const metadata = await sharp(bytes).metadata();
  assert.equal(metadata.density, 300, `${path.basename(file)}: resolución física 300 dpi`);
  const { data, info } = await sharp(bytes).flatten({ background: '#fff' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let decoded;
  for (const relativeY of [0.5, 0.45, 0.55, 0.6]) {
    const y = Math.floor(info.height * relativeY);
    const row = new BitArray(info.width);
    for (let x = 0; x < info.width; x += 1) {
      const offset = (y * info.width + x) * info.channels;
      if ((data[offset] + data[offset + 1] + data[offset + 2]) / 3 < 128) row.set(x);
    }
    try { decoded = new Code128Reader().decodeRow(y, row).getText(); break; }
    catch { /* Other rows are tried to tolerate barcode/header geometry. */ }
  }
  assert.equal(decoded, expected[index], `${path.basename(file)}: lectura independiente del PNG real`);
  let logoPixels = 0;
  // The logo is the only printed content within the top 13 mm (of a 44 mm label).
  for (let pixel = 0; pixel < info.width * Math.floor(info.height * 13 / 44); pixel += 1) {
    const offset = pixel * info.channels;
    if ((data[offset] + data[offset + 1] + data[offset + 2]) / 3 < 128) logoPixels += 1;
  }
  assert.ok(logoPixels > 1000, `${path.basename(file)}: incluye el logo negro PhoneGest`);
  assert.equal(info.width, Math.round(186 * 300 / 25.4), 'Ancho físico de 186 mm a 300 dpi');
  assert.equal(info.height, Math.round(44 * 300 / 25.4), 'Alto físico de 44 mm a 300 dpi');
  results.push({ file: path.basename(file), identifier: decoded, width: info.width, height: info.height, density: metadata.density, logoPixels, sha256: createHash('sha256').update(bytes).digest('hex') });
  console.log(`OK ${path.basename(file)}: ${decoded}; ${info.width}×${info.height}; logo presente.`);
}
await writeFile(path.join(directory, 'png-validation-report.json'), JSON.stringify({ success: true, reader: 'ZXing Code128Reader', results }, null, 2));
