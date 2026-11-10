import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import sharp from 'sharp';
import { unzipSync } from 'fflate';
import { validatePayload } from '../electron/validation.mjs';
import { writeLabelImages, writeLabelArchive, validateImageExportOptions } from '../electron/image-export.mjs';

test('ZIP contains the same dated, numbered PNGs as folder export and preserves duplicate identifiers', async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'phonegest-images-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const payload = validatePayload({
    codes: ['ABC/123', 'ABC/123', 'L3A5KA9807022320129590Q'],
    dates: ['2026-11-10', '2026-11-11', ''], settings: { startNumber: 8 },
  });
  const folder = path.join(directory, 'imagenes');
  const files = await writeLabelImages(payload, folder);
  const zip = path.join(directory, 'codigos.zip');
  assert.equal(await writeLabelArchive(payload, zip), 3);
  const archive = await readFile(zip);
  assert.equal(archive.readUInt32LE(0), 0x04034b50, 'real ZIP local-file signature');
  const entries = unzipSync(archive);
  assert.deepEqual(Object.keys(entries), ['008_ABC-123.png', '009_ABC-123.png', '010_L3A5KA9807022320129590Q.png']);
  for (const file of files) {
    assert.deepEqual(Buffer.from(entries[path.basename(file)]), await readFile(file));
    const info = await sharp(entries[path.basename(file)]).metadata();
    assert.equal(info.format, 'png');
    assert.equal(info.density, 300);
  }
  // Different dates are retained in separate images, including repeated codes.
  assert.notDeepEqual(entries['008_ABC-123.png'], entries['009_ABC-123.png']);
  await writeFile(files[0], 'existing file');
  const repeated = await writeLabelImages(payload, folder);
  assert.equal(path.basename(repeated[0]), '008_ABC-123 (2).png');
  assert.equal(await readFile(files[0], 'utf8'), 'existing file', 'existing user images are never overwritten');
  assert.equal((await readdir(folder)).length, 6);
});

test('image export accepts only supported formats and ZIP creation does not overwrite existing files', async (context) => {
  assert.deepEqual(validateImageExportOptions(), { format: 'folder' });
  assert.deepEqual(validateImageExportOptions({ format: 'zip' }), { format: 'zip' });
  for (const invalid of [null, 'zip', { format: '../file' }, { format: 'exe' }]) assert.throws(() => validateImageExportOptions(invalid));
  const directory = await mkdtemp(path.join(os.tmpdir(), 'phonegest-images-existing-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const zip = path.join(directory, 'existing.zip');
  await writeFile(zip, 'keep');
  await assert.rejects(writeLabelArchive(validatePayload({ codes: ['ABC'], settings: {} }), zip), { code: 'EEXIST' });
  assert.equal(await readFile(zip, 'utf8'), 'keep');
});
