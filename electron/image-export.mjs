import sharp from 'sharp';
import { createLabelSvg } from '../shared/index.mjs';

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
