import { normalizeSettings, validateCode } from '../shared/index.mjs';

export const PROJECT_APPLICATION = 'phonegest-barcode-studio';
export const PROJECT_VERSION = 1;
export const MAX_CODES = 1000;
export const MAX_FILE_BYTES = 2 * 1024 * 1024;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function validatePayload(value, { allowEmpty = false } = {}) {
  if (!isRecord(value) || !Array.isArray(value.codes)) {
    throw new Error('El documento no tiene un formato válido.');
  }
  if ((!allowEmpty && value.codes.length === 0) || value.codes.length > MAX_CODES) {
    throw new Error(`Introduce entre 1 y ${MAX_CODES} códigos.`);
  }
  const codes = value.codes.map((code, index) => {
    if (typeof code !== 'string') throw new Error(`El código ${index + 1} no es válido.`);
    const checked = validateCode(code);
    if (!checked.valid) throw new Error(`Código ${index + 1}: ${checked.error || 'identificador no válido'}`);
    return code;
  });
  const inputSettings = isRecord(value.settings) ? value.settings : {};
  if (inputSettings.layout !== undefined && !['compact', 'comfortable', 'large'].includes(inputSettings.layout)) {
    throw new Error('La distribución del documento no es válida.');
  }
  if (inputSettings.startNumber !== undefined && (!Number.isInteger(inputSettings.startNumber) || inputSettings.startNumber < 1 || inputSettings.startNumber > 999999)) {
    throw new Error('La numeración debe empezar entre 1 y 999999.');
  }
  for (const key of ['showNumbers', 'showCheckboxes', 'showText']) {
    if (inputSettings[key] !== undefined && typeof inputSettings[key] !== 'boolean') {
      throw new Error('La configuración del documento no es válida.');
    }
  }
  if (inputSettings.documentTitle !== undefined && (typeof inputSettings.documentTitle !== 'string' || inputSettings.documentTitle.length > 120 || /[\u0000-\u001f\u007f]/.test(inputSettings.documentTitle))) {
    throw new Error('El título debe tener un máximo de 120 caracteres y una sola línea.');
  }
  return { codes, settings: normalizeSettings(inputSettings) };
}

export function validateSession(value) {
  const payload = validatePayload(value, { allowEmpty: true });
  const theme = ['light', 'dark', 'system'].includes(value.theme) ? value.theme : 'light';
  const input = typeof value.input === 'string' && value.input.length <= 256000 ? value.input : '';
  return { ...payload, theme, input };
}

export function createProject(payload) {
  return {
    application: PROJECT_APPLICATION,
    version: PROJECT_VERSION,
    savedAt: new Date().toISOString(),
    ...validatePayload(payload, { allowEmpty: true }),
  };
}

export function readProject(value) {
  if (!isRecord(value) || value.application !== PROJECT_APPLICATION || value.version !== PROJECT_VERSION) {
    throw new Error('Selecciona un proyecto de PhoneGest Barcode Studio compatible (.pgbs).');
  }
  return validatePayload(value, { allowEmpty: true });
}

export function safeFilename(value, fallback = 'codigo') {
  const safe = String(value).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/[. ]+$/g, '').slice(0, 90);
  if (!safe || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(safe)) return fallback;
  return safe;
}
