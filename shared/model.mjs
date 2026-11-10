export const MAX_CODES = 1000;
export const MAX_CODE_LENGTH = 45;

/**
 * @typedef {Object} DocumentSettings
 * @property {'compact' | 'comfortable' | 'large'} layout
 * @property {number} startNumber
 * @property {boolean} showNumbers
 * @property {boolean} showCheckboxes
 * @property {boolean} showText
 * @property {string} documentTitle
 * @property {string} filenameTemplate
 */

export const LAYOUTS = Object.freeze({
  compact: Object.freeze({ rowsPerPage: 7, rowHeightMm: 31, barcodeHeightMm: 17 }),
  comfortable: Object.freeze({ rowsPerPage: 4, rowHeightMm: 58.2, barcodeHeightMm: 19.05 }),
  large: Object.freeze({ rowsPerPage: 2, rowHeightMm: 91.72, barcodeHeightMm: 24 }),
});

export const DEFAULT_SETTINGS = Object.freeze({
  layout: 'comfortable',
  startNumber: 1,
  showNumbers: true,
  showCheckboxes: true,
  showText: true,
  documentTitle: '',
  filenameTemplate: 'phonegest-barcodes-{total}-{fecha}',
});

/** Code 128 uses printable ASCII identifiers; controls/FNC escape values are rejected. */
export function validateCode(value) {
  if (typeof value !== 'string' || value.length === 0 || value.trim().length === 0) {
    return { valid: false, error: 'Introduce un identificador.' };
  }
  if (!/^[\x20-\x7e]+$/.test(value)) {
    return { valid: false, error: 'Usa letras sin tildes, números y símbolos ASCII. No se admiten saltos de línea ni caracteres de control.' };
  }
  if (value.length > MAX_CODE_LENGTH) {
    return { valid: false, error: `Máximo ${MAX_CODE_LENGTH} caracteres para mantener un tamaño legible en A4.` };
  }
  return { valid: true, error: null };
}

/** Trim surrounding pasted whitespace, preserving identifier case and interior spaces. */
export function parseCodes(text) {
  const codes = [];
  const invalidLines = [];
  const seen = new Map();
  let duplicateCount = 0;
  const lines = String(text ?? '').split(/\r\n|\n|\r/);
  for (let index = 0; index < lines.length; index += 1) {
    const value = lines[index].trim();
    if (!value) continue;
    const validation = validateCode(value);
    if (!validation.valid) {
      invalidLines.push({ line: index + 1, value, error: validation.error });
      continue;
    }
    if (codes.length >= MAX_CODES) {
      invalidLines.push({ line: index + 1, value, error: `Solo se admiten ${MAX_CODES} códigos por documento.` });
      continue;
    }
    if (seen.has(value)) duplicateCount += 1;
    seen.set(value, (seen.get(value) ?? 0) + 1);
    codes.push(value);
  }
  return {
    codes,
    invalidLines,
    duplicateCount,
    duplicates: [...seen.entries()].filter(([, count]) => count > 1).map(([code, count]) => ({ code, count })),
  };
}

/** @param {Partial<DocumentSettings> | null} [settings] @returns {DocumentSettings} */
export function normalizeSettings(settings = {}) {
  const source = settings && typeof settings === 'object' ? settings : {};
  const parsedStart = Number(source.startNumber);
  return {
    layout: Object.hasOwn(LAYOUTS, source.layout) ? source.layout : DEFAULT_SETTINGS.layout,
    startNumber: Number.isSafeInteger(parsedStart) && parsedStart >= 1 && parsedStart <= 999999
      ? parsedStart : DEFAULT_SETTINGS.startNumber,
    showNumbers: typeof source.showNumbers === 'boolean' ? source.showNumbers : DEFAULT_SETTINGS.showNumbers,
    showCheckboxes: typeof source.showCheckboxes === 'boolean' ? source.showCheckboxes : DEFAULT_SETTINGS.showCheckboxes,
    showText: typeof source.showText === 'boolean' ? source.showText : DEFAULT_SETTINGS.showText,
    documentTitle: typeof source.documentTitle === 'string' ? source.documentTitle.trim().slice(0, 240) : '',
    filenameTemplate: typeof source.filenameTemplate === 'string' && source.filenameTemplate.trim()
      ? source.filenameTemplate.trim().slice(0, 180) : DEFAULT_SETTINGS.filenameTemplate,
  };
}

/** @param {string[]} codes @param {Partial<DocumentSettings> | 'compact' | 'comfortable' | 'large'} [settings] @returns {string[][]} */
export function paginateCodes(codes, settings = {}) {
  if (!Array.isArray(codes)) throw new TypeError('La lista de códigos debe ser un array.');
  if (codes.length > MAX_CODES) throw new RangeError(`Máximo ${MAX_CODES} códigos por documento.`);
  const normalized = normalizeSettings(typeof settings === 'string' ? { layout: settings } : settings);
  const rowsPerPage = LAYOUTS[normalized.layout].rowsPerPage;
  const pages = [];
  for (let index = 0; index < codes.length; index += rowsPerPage) {
    pages.push(codes.slice(index, index + rowsPerPage));
  }
  return pages;
}

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]));
}

export function safeLogoDataUrl(value) {
  // Embedded raster logos keep documents self-contained and prevent remote fetches.
  return typeof value === 'string' && /^data:image\/(?:png|jpeg|webp);base64,[a-zA-Z0-9+/=\r\n]+$/.test(value)
    ? value.replace(/[\r\n]/g, '') : '';
}
