import { LAYOUTS, normalizeSettings } from './model.mjs';

/** Accept an ISO storage date or the Spanish display form, without timezone conversion. */
export function parseDate(value) {
  if (typeof value !== 'string') return null;
  const input = value.trim();
  if (!input) return '';
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input);
  const spanish = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(input);
  if (!iso && !spanish) return null;
  const year = Number(iso ? iso[1] : spanish[3]);
  const month = Number(iso ? iso[2] : spanish[2]);
  const day = Number(iso ? iso[3] : spanish[1]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function formatDate(value) {
  const iso = parseDate(value);
  return iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '';
}

/** Dates follow rows, including repeated identifiers. Legacy projects have no dates. */
export function normalizeDates(dates, count) {
  if (dates === undefined || (Array.isArray(dates) && dates.length === 0)) return Array(count).fill('');
  if (!Array.isArray(dates) || dates.length !== count) throw new Error('Debe haber una fecha por código; deja vacías las fechas que no necesites.');
  return Array.from({ length: count }, (_, index) => {
    const date = dates[index];
    const parsed = parseDate(date);
    if (parsed === null) throw new Error(`La fecha del código ${index + 1} no es válida. Usa DD/MM/AAAA.`);
    return parsed;
  });
}

export const TEMPLATE_VARIABLES = Object.freeze([
  { key: 'total', label: 'Total de códigos', example: '12' },
  { key: 'fecha', label: 'Fecha (DD-MM-AA)', example: '10-11-26' },
  { key: 'fecha_iso', label: 'Fecha (AAAA-MM-DD)', example: '2026-11-10' },
  { key: 'hora', label: 'Hora (HH-mm)', example: '14-30' },
  { key: 'paginas', label: 'Total de páginas', example: '3' },
  { key: 'inicio', label: 'Primer número', example: '1' },
  { key: 'final', label: 'Último número', example: '12' },
  { key: 'primero', label: 'Primer identificador', example: 'CODIGO001' },
  { key: 'ultimo', label: 'Último identificador', example: 'CODIGO012' },
].map((variable) => Object.freeze(variable)));

/** Resolve once per export by passing the same `now` to filename and document. */
export function resolveTemplate(template, context = {}) {
  if (typeof template !== 'string') throw new Error('La plantilla debe ser un texto.');
  const settings = normalizeSettings(context.settings);
  const codes = Array.isArray(context.codes) ? context.codes : [];
  const total = Number.isSafeInteger(context.total) && context.total >= 0 ? context.total : codes.length;
  const now = context.now === undefined ? new Date() : new Date(context.now);
  if (Number.isNaN(now.getTime())) throw new Error('La fecha del documento no es válida.');
  const pad = (part) => String(part).padStart(2, '0');
  const year = String(now.getFullYear()).padStart(4, '0');
  const month = pad(now.getMonth() + 1);
  const day = pad(now.getDate());
  const values = {
    total: String(total), fecha: `${day}-${month}-${year.slice(-2)}`, fecha_iso: `${year}-${month}-${day}`,
    hora: `${pad(now.getHours())}-${pad(now.getMinutes())}`,
    paginas: String(Number.isSafeInteger(context.pageCount) && context.pageCount > 0 ? context.pageCount : Math.max(1, Math.ceil(total / LAYOUTS[settings.layout].rowsPerPage))),
    inicio: String(settings.startNumber), final: String(settings.startNumber + Math.max(0, total - 1)),
    primero: codes[0] ?? '', ultimo: codes.at(-1) ?? '',
  };
  const resolved = template.replace(/\{([^{}]*)\}/g, (_, key) => {
    if (!Object.hasOwn(values, key)) throw new Error(`Variable desconocida: {${key.slice(0, 60)}}.`);
    return values[key];
  });
  // A literal brace cannot be a valid identifier in our template syntax. Check the
  // template rather than the result because an identifier may itself contain braces.
  if (/[{}]/.test(template.replace(/\{[^{}]*\}/g, ''))) throw new Error('Completa las variables con llaves, por ejemplo {total}.');
  return resolved;
}

/** Safe on Windows and web downloads, with exactly one requested extension. */
export function resolveFilename(template, context = {}, extension = 'pdf') {
  const suffix = String(extension).replace(/^\./, '').toLowerCase();
  if (!/^[a-z0-9]{1,8}$/.test(suffix)) throw new Error('La extensión del archivo no es válida.');
  const resolved = resolveTemplate(template || 'phonegest-barcodes-{total}-{fecha}', context);
  let stem = resolved.trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '-')
    .replace(/^[. ]+|[. ]+$/g, '').replace(/(?:\.(?:pdf|zip|png))+$/i, '')
    .slice(0, 180).replace(/[. ]+$/g, '');
  if (!stem || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem)) stem = 'phonegest-barcodes';
  return `${stem}.${suffix}`;
}
