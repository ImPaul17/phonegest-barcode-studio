import JsBarcode from 'jsbarcode';
import { escapeHtml, safeLogoDataUrl, validateCode } from './model.mjs';

export const MIN_MODULE_WIDTH_MM = 0.28;
export const QUIET_ZONE_MODULES = 12;

/** Obtain real Code 128 bars (including mandatory checksum and stop) without a DOM. */
export function encodeCode128(value) {
  const validation = validateCode(value);
  if (!validation.valid) throw new Error(validation.error);
  const target = {};
  JsBarcode(target, value, { format: 'CODE128', displayValue: false, margin: 0 });
  const data = target.encodings.map((encoding) => encoding.data).join('');
  if (!/^[01]+$/.test(data)) throw new Error('No se pudo generar el código de barras.');
  return data;
}

function positive(value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Size is physical millimetres. The viewBox uses modules so bars remain exact vectors. */
export function createBarcodeSvg(value, options = {}) {
  const data = encodeCode128(value);
  const maxWidthMm = positive(options.maxWidthMm ?? options.widthMm, 164);
  const preferredModuleWidth = Math.max(MIN_MODULE_WIDTH_MM, positive(options.moduleWidthMm, 0.38));
  const modules = data.length + QUIET_ZONE_MODULES * 2;
  const moduleWidthMm = Math.min(preferredModuleWidth, maxWidthMm / modules);
  if (moduleWidthMm < MIN_MODULE_WIDTH_MM) {
    throw new RangeError('El código es demasiado largo para este tamaño de etiqueta.');
  }
  const barHeightMm = positive(options.barHeightMm ?? options.heightMm, 22);
  const showText = options.showText === true;
  const textHeightMm = showText ? 7 : 0;
  const heightMm = barHeightMm + textHeightMm;
  const barHeight = barHeightMm / moduleWidthMm;
  const svgHeight = heightMm / moduleWidthMm;
  const widthMm = modules * moduleWidthMm;
  const bars = [];
  for (let index = 0; index < data.length;) {
    if (data[index] === '0') { index += 1; continue; }
    let end = index + 1;
    while (data[end] === '1') end += 1;
    bars.push(`<rect x="${index + QUIET_ZONE_MODULES}" y="0" width="${end - index}" height="${barHeight}"/>`);
    index = end;
  }
  const text = showText
    ? `<text x="${modules / 2}" y="${(barHeightMm + 5.2) / moduleWidthMm}" fill="#000" text-anchor="middle" font-family="Arial, sans-serif" font-size="${3.8 / moduleWidthMm}">${escapeHtml(value)}</text>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${widthMm}mm" height="${heightMm}mm" viewBox="0 0 ${modules} ${svgHeight}" role="img" aria-label="${escapeHtml(value)}" data-code128="true" data-module-width-mm="${moduleWidthMm}"><rect width="${modules}" height="${svgHeight}" fill="#fff"/><g fill="#000" shape-rendering="crispEdges">${bars.join('')}</g>${text}</svg>`;
}

/** Standalone label for lossless SVG export or local PNG rasterisation by Electron. */
export function createLabelSvg(value, options = {}) {
  const widthMm = positive(options.widthMm, 186);
  const heightMm = positive(options.heightMm, 44);
  const showNumbers = options.showNumbers !== false;
  const showCheckboxes = options.showCheckboxes !== false;
  const showText = options.showText !== false;
  const number = Number.isSafeInteger(Number(options.number)) && Number(options.number) >= 1 ? Number(options.number) : 1;
  const logo = safeLogoDataUrl(options.logoDataUrl);
  const headerHeightMm = logo ? 13 : 0;
  const leftSpace = showNumbers ? 15 : 4;
  const rightSpace = showCheckboxes ? 12 : 4;
  const barcodeArea = widthMm - leftSpace - rightSpace;
  const barHeightMm = Math.max(10, heightMm - headerHeightMm - (showText ? 13 : 6));
  const barcode = createBarcodeSvg(value, { maxWidthMm: barcodeArea, barHeightMm });
  const barcodeWidth = Number(barcode.match(/width="([\d.]+)mm"/)[1]);
  const x = leftSpace + (barcodeArea - barcodeWidth) / 2;
  const y = headerHeightMm + 3;
  const nestedSvg = barcode.replace('<svg ', `<svg x="${x}" y="${y}" `).replace(`width="${barcodeWidth}mm"`, `width="${barcodeWidth}"`).replace(/height="([\d.]+)mm"/, 'height="$1"');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${widthMm}mm" height="${heightMm}mm" viewBox="0 0 ${widthMm} ${heightMm}" role="img" aria-label="${escapeHtml(value)}"><rect width="${widthMm}" height="${heightMm}" fill="#fff"/>${logo ? `<image href="${logo}" x="${widthMm / 2 - 24}" y="1" width="48" height="10" preserveAspectRatio="xMidYMid meet"/>` : ''}${showNumbers ? `<text x="2" y="${headerHeightMm + barHeightMm / 2 + 4}" fill="#000" font-family="Arial, sans-serif" font-size="3.5">${number}.</text>` : ''}${nestedSvg}${showText ? `<text x="${leftSpace + barcodeArea / 2}" y="${headerHeightMm + barHeightMm + 9}" fill="#000" text-anchor="middle" font-family="Arial, sans-serif" font-size="3.8">${escapeHtml(value)}</text>` : ''}${showCheckboxes ? `<rect x="${widthMm - 8}" y="${headerHeightMm + barHeightMm / 2 + 0.5}" width="5" height="5" fill="#fff" stroke="#000" stroke-width="0.4"/>` : ''}</svg>`;
}
