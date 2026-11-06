import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = await readFile(path.join(root, 'assets', 'phonegest.svg'), 'utf8');
const sourcePaths = [...source.matchAll(/<path\b[\s\S]*?\/>/g)].map((match) => match[0]);
// The original vector logo draws the outer emblem first and its inner G fifth.
const emblemPaths = [sourcePaths[0], sourcePaths[4]];
if (!emblemPaths[0]?.includes('33.94 130.97') || !emblemPaths[1]?.includes('90.40 65.44')) {
  throw new Error('The PhoneGest source logo changed; inspect the emblem paths before regenerating the icon.');
}

const mark = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 137 176">${emblemPaths.join('')}</svg>\n`;
await writeFile(path.join(root, 'assets', 'phonegest-mark.svg'), mark);

const whitePaths = emblemPaths.map((entry) => entry.replaceAll('#000000', '#ffffff')).join('');
const icon = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <rect width="256" height="256" rx="48" fill="#006596"/>
  <g transform="translate(57.5 37.5) scale(1.03)">${whitePaths}</g>
</svg>`);
const sizes = [16, 32, 48, 64, 128, 256];
const images = await Promise.all(sizes.map((size) => sharp(icon, { density: 384 }).resize(size, size).png().toBuffer()));

// ICO header + directory entries; each image payload is a complete RGBA PNG.
const directory = Buffer.alloc(6 + sizes.length * 16);
directory.writeUInt16LE(1, 2);
directory.writeUInt16LE(sizes.length, 4);
let offset = directory.length;
for (let index = 0; index < sizes.length; index++) {
  const size = sizes[index];
  const entry = 6 + index * 16;
  directory.writeUInt8(size === 256 ? 0 : size, entry);
  directory.writeUInt8(size === 256 ? 0 : size, entry + 1);
  directory.writeUInt16LE(1, entry + 4);
  directory.writeUInt16LE(32, entry + 6);
  directory.writeUInt32LE(images[index].length, entry + 8);
  directory.writeUInt32LE(offset, entry + 12);
  offset += images[index].length;
}
await writeFile(path.join(root, 'assets', 'phonegest.ico'), Buffer.concat([directory, ...images]));
await writeFile(path.join(root, 'assets', 'phonegest-icon.png'), images.at(-1));
console.log(`Created assets/phonegest.ico with ${sizes.join(', ')} px images.`);
