import sharp from 'sharp';
import path from 'node:path';
import { mkdir, open, access, unlink } from 'node:fs/promises';
import { Zip, ZipPassThrough } from 'fflate';
import { createLabelSvg } from '../shared/index.mjs';
import { safeFilename } from './validation.mjs';

export const IMAGE_WIDTH_MM = 186;
export const IMAGE_HEIGHT_MM = 44;
export const IMAGE_DPI = 300;
export const IMAGE_WIDTH_PX = Math.round(IMAGE_WIDTH_MM * IMAGE_DPI / 25.4);
export const IMAGE_HEIGHT_PX = Math.round(IMAGE_HEIGHT_MM * IMAGE_DPI / 25.4);

export async function createLabelPng(code, options = {}) {
  const svg = createLabelSvg(code, { ...options, widthMm: IMAGE_WIDTH_MM, heightMm: IMAGE_HEIGHT_MM });
  // SVG physical units and librsvg density can compound in some versions. Give the
  // outer canvas exact pixel dimensions and record the intended print density.
  const pixels = svg.replace(/^<svg\b[^>]*>/, (root) => root
    .replace(/\bwidth="[^"]*"/, `width="${IMAGE_WIDTH_PX}"`)
    .replace(/\bheight="[^"]*"/, `height="${IMAGE_HEIGHT_PX}"`));
  return sharp(Buffer.from(pixels), { density: 72 })
    .resize({ width: IMAGE_WIDTH_PX, height: IMAGE_HEIGHT_PX, fit: 'fill' })
    .flatten({ background: '#ffffff' })
    .withMetadata({ density: IMAGE_DPI })
    .png()
    .toBuffer();
}

export function validateImageExportOptions(value = {}) {
  if (!value || typeof value !== 'object' || !['folder', 'zip'].includes(value.format ?? 'folder')) {
    throw new TypeError('Elige exportar las imágenes en ZIP o en una carpeta.');
  }
  return { format: value.format ?? 'folder' };
}

/** Numbering makes repeated identifiers distinct, while sanitizing every filename. */
export async function* createLabelImageEntries(payload, logoDataUrl = '') {
  for (const [index, code] of payload.codes.entries()) {
    const number = payload.settings.startNumber + index;
    yield {
      name: `${String(number).padStart(3, '0')}_${safeFilename(code)}.png`,
      bytes: await createLabelPng(code, { ...payload.settings, number, date: payload.dates?.[index] ?? '', logoDataUrl }),
    };
  }
}

async function uniqueFile(directory, name) {
  const extension = path.extname(name);
  const basename = name.slice(0, -extension.length);
  for (let index = 0; ; index += 1) {
    const target = path.join(directory, `${basename}${index ? ` (${index + 1})` : ''}${extension}`);
    try { await access(target); }
    catch (error) {
      if (error.code === 'ENOENT') return target;
      throw error;
    }
  }
}

export async function writeLabelImages(payload, directory, logoDataUrl = '') {
  await mkdir(directory, { recursive: true });
  const files = [];
  for await (const entry of createLabelImageEntries(payload, logoDataUrl)) {
    const destination = await uniqueFile(directory, entry.name);
    const file = await open(destination, 'wx');
    try { await file.writeFile(entry.bytes); }
    finally { await file.close(); }
    files.push(destination);
  }
  return files;
}

/** Stream already-compressed PNG entries one at a time, rather than retaining 1000 images in memory. */
export async function writeLabelArchive(payload, destination, logoDataUrl = '') {
  const output = await open(destination, 'wx');
  let writes = Promise.resolve();
  let zipError;
  const archive = new Zip((error, data) => {
    if (error) { zipError = error; return; }
    writes = writes.then(() => output.writeFile(data));
    // Consume early write failures until the entry's awaited flush below.
    void writes.catch(() => {});
  });
  try {
    for await (const entry of createLabelImageEntries(payload, logoDataUrl)) {
      const image = new ZipPassThrough(entry.name);
      archive.add(image);
      image.push(entry.bytes, true);
      await writes;
      if (zipError) throw zipError;
    }
    archive.end();
    await writes;
    if (zipError) throw zipError;
    await output.close();
    return payload.codes.length;
  } catch (error) {
    archive.terminate();
    await writes.catch(() => {});
    await output.close().catch(() => {});
    await unlink(destination).catch(() => {});
    throw error;
  }
}
