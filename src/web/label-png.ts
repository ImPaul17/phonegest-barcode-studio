import { createLabelSvg } from '../../shared/index.mjs';
import type { Settings } from '../types';

const DPI = 300;
const WIDTH_MM = 186;
const HEIGHT_MM = 44;
const WIDTH_PX = Math.round(WIDTH_MM * DPI / 25.4);
const HEIGHT_PX = Math.round(HEIGHT_MM * DPI / 25.4);

function crc32(bytes: Uint8Array) {
  let checksum = 0xffffffff;
  for (const byte of bytes) {
    checksum ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      checksum = (checksum >>> 1) ^ (checksum & 1 ? 0xedb88320 : 0);
    }
  }
  return (checksum ^ 0xffffffff) >>> 0;
}

async function addPrintDensity(png: Blob): Promise<Blob> {
  // Canvas writes its own default density. Replace it with an explicit PNG pHYs
  // chunk so the pixels also represent the same 186 × 44 mm as on Windows.
  const buffer = await png.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const source = new DataView(buffer);
  const chunk = new Uint8Array(21);
  const view = new DataView(chunk.buffer);
  const pixelsPerMetre = Math.round(DPI / 0.0254);
  view.setUint32(0, 9);
  view.setUint32(4, 0x70485973); // pHYs
  view.setUint32(8, pixelsPerMetre);
  view.setUint32(12, pixelsPerMetre);
  chunk[16] = 1;
  view.setUint32(17, crc32(chunk.subarray(4, 17)));

  const parts: BlobPart[] = [bytes.subarray(0, 8)];
  for (let offset = 8; offset < bytes.length;) {
    const end = offset + 12 + source.getUint32(offset);
    const type = source.getUint32(offset + 4);
    if (type !== 0x70485973) parts.push(bytes.subarray(offset, end));
    if (type === 0x49484452) parts.push(chunk); // after IHDR, before IDAT
    offset = end;
  }
  return new Blob(parts, { type: 'image/png' });
}

export async function renderLabelPng(code: string, settings: Settings, number: number, logoDataUrl: string) {
  const svg = createLabelSvg(code, { ...settings, number, logoDataUrl, widthMm: WIDTH_MM, heightMm: HEIGHT_MM });
  const pixels = svg.replace(/^<svg\b[^>]*>/, (root: string) => root
    .replace(/\bwidth="[^"]*"/, `width="${WIDTH_PX}"`)
    .replace(/\bheight="[^"]*"/, `height="${HEIGHT_PX}"`));
  const canvas = document.createElement('canvas');
  const url = URL.createObjectURL(new Blob([pixels], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    canvas.width = WIDTH_PX;
    canvas.height = HEIGHT_PX;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('El navegador no puede generar imágenes PNG.');
    context.drawImage(image, 0, 0, WIDTH_PX, HEIGHT_PX);
    const png = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('No se ha podido generar la etiqueta PNG.'));
      }, 'image/png');
    });
    return await addPrintDensity(png);
  } finally {
    canvas.width = 0;
    URL.revokeObjectURL(url);
  }
}
