/** Rebuild the source-controlled NSIS 24-bit bitmap from its editable SVG. */
import sharp from 'sharp';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const { data, info } = await sharp(fileURLToPath(new URL('./sidebar.svg', import.meta.url)))
  .flatten({ background: '#182126' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const stride = Math.ceil(info.width * 3 / 4) * 4;
const bitmap = Buffer.alloc(54 + stride * info.height);
bitmap.write('BM');
bitmap.writeUInt32LE(bitmap.length, 2);
bitmap.writeUInt32LE(54, 10);
bitmap.writeUInt32LE(40, 14);
bitmap.writeInt32LE(info.width, 18);
bitmap.writeInt32LE(info.height, 22);
bitmap.writeUInt16LE(1, 26);
bitmap.writeUInt16LE(24, 28);
bitmap.writeUInt32LE(stride * info.height, 34);
for (let y = 0; y < info.height; y += 1) {
  for (let x = 0; x < info.width; x += 1) {
    const source = (y * info.width + x) * info.channels;
    const target = 54 + (info.height - y - 1) * stride + x * 3;
    bitmap[target] = data[source + 2];
    bitmap[target + 1] = data[source + 1];
    bitmap[target + 2] = data[source];
  }
}
await writeFile(new URL('./sidebar.bmp', import.meta.url), bitmap);
