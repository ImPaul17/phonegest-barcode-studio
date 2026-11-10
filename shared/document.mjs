import { createBarcodeSvg } from './barcode.mjs';
import { escapeHtml, LAYOUTS, normalizeSettings, paginateCodes, safeLogoDataUrl } from './model.mjs';
import { formatDate, normalizeDates, resolveTemplate } from './metadata.mjs';

/**
 * One shared, script-free document for preview, PDF and native Windows printing.
 * @param {{codes?: string[], dates?: string[], settings?: Partial<import('./model.mjs').DocumentSettings>, logoDataUrl?: string, now?: Date | string | number}} [options]
 * @returns {string}
 */
export function renderDocument({ codes = [], dates = [], settings = {}, logoDataUrl = '', now } = {}) {
  const normalized = normalizeSettings(settings);
  const normalizedDates = normalizeDates(dates, codes.length);
  const layout = LAYOUTS[normalized.layout];
  const pages = paginateCodes(codes, normalized);
  const logo = safeLogoDataUrl(logoDataUrl);
  const documentTitle = resolveTemplate(normalized.documentTitle, { codes, settings: normalized, now });
  const renderedPages = (pages.length ? pages : [[]]).map((page, pageIndex) => {
    const rows = page.map((code, rowIndex) => {
      const number = normalized.startNumber + pageIndex * layout.rowsPerPage + rowIndex;
      const date = formatDate(normalizedDates[pageIndex * layout.rowsPerPage + rowIndex]);
      const text = `${normalized.showNumbers ? `${number}.` : ''}${normalized.showText ? `${normalized.showNumbers ? ' ' : ''}${escapeHtml(code)}` : ''}`;
      const textLength = (normalized.showNumbers ? String(number).length + 2 : 0) + (normalized.showText ? code.length : 0);
      const fontSize = Math.min(3.88, (date ? 139 : 167.68) / Math.max(1, textLength) / 0.95);
      const details = text || date ? `<div class="label-details${date ? ' has-date' : ''}">${date ? `<time class="label-date" datetime="${normalizedDates[pageIndex * layout.rowsPerPage + rowIndex]}">${date}</time>` : ''}${text ? `<div class="identifier" style="font-size:${fontSize}mm">${text}</div>` : ''}</div>` : '';
      return `<article class="label"><div class="barcode-area">${createBarcodeSvg(code, { maxWidthMm: 157, moduleWidthMm: normalized.layout === 'compact' ? 0.30 : 0.34, barHeightMm: layout.barcodeHeightMm })}${details}</div>${normalized.showCheckboxes ? '<span class="checkbox" aria-label="Marcar paquete"></span>' : ''}</article>`;
    }).join('');
    return `<section class="page sheet" data-page="${pageIndex + 1}" aria-label="Página ${pageIndex + 1}"><header class="document-header">${logo ? `<img class="logo" src="${logo}" alt="PhoneGest"/>` : '<div class="wordmark">PhoneGest</div>'}${documentTitle ? `<div class="document-title">${escapeHtml(documentTitle)}</div>` : ''}</header><main class="labels">${rows}</main><footer class="document-footer"><span>${codes.length ? `${codes.length} ${codes.length === 1 ? 'código' : 'códigos'}` : ''}</span><span>${pageIndex + 1} / ${Math.max(1, pages.length)}</span></footer></section>`;
  }).join('');
  return `<!doctype html><html lang="es"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"/><title>${escapeHtml(documentTitle || 'PhoneGest · Códigos de barras')}</title><style>
  @page { size: A4 portrait; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #000; font-family: Arial, Helvetica, sans-serif; }
  body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
  .sheet { width: 210mm; height: 297mm; padding: 14.8mm 17.64mm 12mm; display: flex; flex-direction: column; overflow: hidden; background: #fff; break-after: page; page-break-after: always; }
  .sheet:last-child { break-after: auto; page-break-after: auto; }
  .document-header { flex: 0 0 24.2mm; text-align: center; }
  .logo { width: 51.15mm; height: 9.26mm; object-fit: contain; }
  .wordmark { height: 9.26mm; font-size: 9mm; font-weight: 700; line-height: 9.26mm; letter-spacing: -0.5mm; }
  .document-title { font-size: 3.5mm; margin-top: 2mm; max-height: 9mm; overflow: hidden; overflow-wrap: anywhere; }
  .labels { display: grid; grid-auto-rows: ${layout.rowHeightMm}mm; align-content: start; flex: 1 1 auto; }
  .label { position: relative; break-inside: avoid; page-break-inside: avoid; }
  .label::after { content: ''; display: block; position: absolute; top: ${normalized.layout === 'comfortable' ? 34 : layout.rowHeightMm - 5}mm; left: 0; right: 0; border-top: 0.21mm solid #777; }
  .barcode-area { width: 167.68mm; text-align: center; min-width: 0; line-height: 0; }
  .barcode-area svg { display: inline-block; vertical-align: middle; }
  .label-details { display: flex; align-items: baseline; width: 167.68mm; gap: 3mm; margin-top: 1.5mm; line-height: 5mm; }
  .label-date { flex: 0 0 25mm; font-size: 3.2mm; text-align: left; white-space: nowrap; }
  .identifier { flex: 1; min-width: 0; font-size: 3.88mm; line-height: 5mm; white-space: nowrap; }
  .checkbox { position: absolute; top: ${Math.max(1, (layout.barcodeHeightMm - 4.94) / 2)}mm; left: 166.96mm; display: inline-block; width: 4.94mm; height: 4.94mm; border: 0.35mm solid #000; }
  .document-footer { flex: 0 0 7mm; display: flex; align-items: end; justify-content: space-between; font-size: 2.7mm; }
  @media screen { body { background: #e8ecf0; } .sheet { margin: 0 auto 5mm; box-shadow: 0 2mm 5mm #00000012; } }
  @media print { .sheet { margin: 0; box-shadow: none; } }
  </style></head><body>${renderedPages}</body></html>`;
}
