import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpRight, Barcode, CalendarDays, Check, CheckCheck, CheckCircle2, ChevronLeft, ChevronRight, ClipboardPaste, Download, FileDown, FilePlus2, FileText, FolderOpen, GripVertical, ListOrdered, LoaderCircle, Minus, Moon, Pencil, Plus, Printer, RefreshCw, RotateCcw, Save, ScanLine, Settings2, ShieldCheck, Sun, Trash2, X } from 'lucide-react';
import { parseCodes, renderDocument, validateCode, normalizeSettings, parseDate, formatDate, resolveFilename, resolveTemplate, TEMPLATE_VARIABLES } from '../shared/index.mjs';
import type { ImageExportOptions, InstallationInfo, Project, Session, Settings, Theme, UpdateState } from './types';
import Select from './components/Select';
import ExportImagesMenu from './components/ExportImagesMenu';

const INITIAL_SETTINGS: Settings = { layout: 'comfortable', startNumber: 1, showNumbers: true, showCheckboxes: true, showText: true, documentTitle: '', filenameTemplate: 'phonegest-barcodes-{total}-{fecha}' };
const EXAMPLES = ['L3A5KA9806994060129590B', 'L3A5KA9806994140129590X', 'L3A5KA9807022320129590Q'];
const ROWS = { comfortable: 4, compact: 7, large: 2 };
const MAX_CODES = 1000;
const WINDOWS_DOWNLOADS = 'https://github.com/ImPaul17/phonegest-barcode-studio/releases/latest';
const layoutNames = { comfortable: '4 por página', compact: '7 por página', large: '2 por página' };
const layoutOptions = [
  { value: 'large', label: layoutNames.large }, { value: 'comfortable', label: layoutNames.comfortable }, { value: 'compact', label: layoutNames.compact },
  { value: 'columns', label: 'Por columnas · Próximamente', disabled: true },
];
const THEME_OPTIONS = [
  { value: 'light', label: 'Claro', Icon: Sun },
  { value: 'dark', label: 'Oscuro', Icon: Moon },
  { value: 'system', label: 'Sistema', Icon: Settings2 },
] as const;

export default function App() {
  const api = window.phonegest;
  const [codes, setCodes] = useState<string[]>([]);
  const [dates, setDates] = useState<string[]>([]);
  const [settings, setSettings] = useState<Settings>(INITIAL_SETTINGS);
  const [theme, setTheme] = useState<Theme>('light');
  const [systemDark, setSystemDark] = useState(matchMedia('(prefers-color-scheme: dark)').matches);
  const [input, setInput] = useState('');
  const [logo, setLogo] = useState('');
  const [version, setVersion] = useState('1.0.0');
  const [displayVersion, setDisplayVersion] = useState('');
  const [isWeb, setIsWeb] = useState(false);
  const [ready, setReady] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState<{text: string; error?: boolean} | null>(null);
  const [inputError, setInputError] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [updatesOpen, setUpdatesOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editError, setEditError] = useState('');
  const [undo, setUndo] = useState<{codes: string[]; dates: string[]}[]>([]);
  const [startNumberInput, setStartNumberInput] = useState('1');
  const [installation, setInstallation] = useState<InstallationInfo | null>(null);
  const [maintenanceBusy, setMaintenanceBusy] = useState(false);
  const [page, setPage] = useState(0);
  const [zoom, setZoom] = useState(0.61);
  const [autoFit, setAutoFit] = useState(true);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [draggingPage, setDraggingPage] = useState(false);
  const panGesture = useRef<{ pointer: number; x: number; y: number; panX: number; panY: number } | null>(null);
  const viewTransform = useRef({ zoom, pan });
  viewTransform.current = { zoom, pan };
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [updateState, setUpdateState] = useState<UpdateState | null>(null);
  const [updateAction, setUpdateAction] = useState<'check' | 'download' | 'install' | 'releases' | null>(null);
  const [updateError, setUpdateError] = useState('');
  const [dismissedUpdate, setDismissedUpdate] = useState('');
  const previewRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const dragIndex = useRef<number | null>(null);
  const updatesButtonRef = useRef<HTMLButtonElement>(null);
  const updatesDialogRef = useRef<HTMLElement>(null);
  const appliedTheme = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;
  const dark = appliedTheme === 'dark';
  const pageCount = Math.max(1, Math.ceil(codes.length / ROWS[settings.layout]));
  const duplicates = codes.length - new Set(codes).size;
  const project: Project = useMemo(() => ({codes, dates, settings}), [codes, dates, settings]);
  const filePreview = useMemo(() => {
    try { resolveTemplate(settings.documentTitle, project); return { name: resolveFilename(settings.filenameTemplate, project, 'pdf'), error: '' }; }
    catch (error) { return { name: '', error: errorMessage(error) }; }
  }, [project, settings.documentTitle, settings.filenameTemplate]);
  const parsed = useMemo(() => parseCodes(input), [input]);
  const updates: UpdateState = updateState ?? { status: 'unsupported', currentVersion: version, currentDisplayVersion: displayVersion, canAutoUpdate: false, releaseUrl: '', message: 'Las actualizaciones están disponibles en la aplicación de Windows.' };
  const currentDisplayVersion = updates.currentDisplayVersion || displayVersion || updates.currentVersion || version;
  const availableDisplayVersion = updates.availableDisplayVersion || updates.availableVersion || '';
  const updateInProgress = updates.status === 'checking' || updates.status === 'downloading';
  const updateReady = updates.status === 'downloaded';
  const updateFailed = updates.status === 'error' && !!updates.availableVersion;
  const hasUpdate = ['available', 'downloading', 'downloaded'].includes(updates.status) || updateFailed;
  const updateNotificationKey = `${updates.availableVersion ?? ''}:${updates.status}`;
  const updateProgress = typeof updates.progress === 'number' ? Math.min(100, Math.max(0, Math.round(updates.progress))) : undefined;
  const updateStatusText = updateStatus(updates);
  const openUpdates = () => { setSettingsOpen(false); setEditing(null); setConfirmClear(false); setUpdatesOpen(true); };

  useEffect(() => {
    let active = true;
    const media = matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    media.addEventListener('change', onChange);
    (async () => {
      try {
        if (api) {
          const [info, saved] = await Promise.all([api.getAppInfo(), api.loadSession()]);
          if (!active) return;
          setLogo(info.logoDataUrl); setVersion(info.version); setDisplayVersion(info.displayVersion || ''); setIsWeb(info.platform === 'web');
          if (saved) { setCodes(saved.codes); setDates(saved.dates ?? saved.codes.map(() => '')); setSettings({...INITIAL_SETTINGS, ...normalizeSettings(saved.settings)} as Settings); setTheme(['light', 'dark', 'system'].includes(saved.theme) ? saved.theme : 'dark'); setInput(saved.input || ''); }
        }
      } catch (error) { if (active) setNotice({text: `No se pudo recuperar la sesión: ${errorMessage(error)}`, error: true}); }
      finally { if (active) setReady(true); }
    })();
    return () => { active = false; media.removeEventListener('change', onChange); };
  }, [api]);

  useEffect(() => {
    if (!api?.getUpdateState) return;
    let active = true;
    const receive = (state: UpdateState) => { if (active) { setUpdateState(state); setUpdateError(''); } };
    const unsubscribe = api.onUpdateState?.(receive);
    void api.getUpdateState().then(receive).catch(() => {
      if (active) setUpdateError('No se pudo consultar el estado de las actualizaciones. Puedes seguir trabajando.');
    });
    return () => { active = false; unsubscribe?.(); };
  }, [api]);

  useEffect(() => { document.documentElement.dataset.theme = appliedTheme; }, [appliedTheme]);
  useEffect(() => {
    if (!ready || !api) return;
    let active = true;
    const timer = setTimeout(() => api.saveSession({codes, dates, settings, theme, input} as Session).then(ok => {if(active) setSaveError(!ok);}).catch(() => {if(active) setSaveError(true);}), 450);
    return () => {active = false; clearTimeout(timer);};
  }, [api, codes, dates, settings, theme, input, ready]);
  useEffect(() => setStartNumberInput(String(settings.startNumber)), [settings.startNumber]);
  useEffect(() => {
    if (!settingsOpen || !api?.getInstallationInfo) return;
    let active = true;
    void api.getInstallationInfo().then(value => { if (active) setInstallation(value); }).catch(() => { if (active) setInstallation(null); });
    return () => { active = false; };
  }, [settingsOpen, api]);
  useEffect(() => { setPage(p => Math.min(p, pageCount - 1)); }, [pageCount]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(null), notice.error ? 9000 : 5000); return () => clearTimeout(timer); }, [notice]);
  useEffect(() => {
    if (!autoFit || !previewRef.current) return;
    const observer = new ResizeObserver(([entry]) => { setZoom(Math.min(2.5, Math.max(0.1, Math.min((entry.contentRect.width - 24) / 794, (entry.contentRect.height - 10) / 1123)))); setPan({ x: 0, y: 0 }); });
    observer.observe(previewRef.current);
    return () => observer.disconnect();
  }, [autoFit]);
  useEffect(() => {
    const canvas = previewRef.current;
    if (!canvas) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const bounds = canvas.getBoundingClientRect();
      const current = viewTransform.current;
      const nextZoom = Math.min(2.5, Math.max(0.1, current.zoom * Math.exp(-event.deltaY * 0.002)));
      const ratio = nextZoom / current.zoom;
      const point = { x: event.clientX - bounds.left - bounds.width / 2, y: event.clientY - bounds.top - bounds.height / 2 };
      const nextPan = { x: point.x - (point.x - current.pan.x) * ratio, y: point.y - (point.y - current.pan.y) * ratio };
      viewTransform.current = { zoom: nextZoom, pan: nextPan };
      setAutoFit(false); setZoom(nextZoom); setPan(nextPan);
    };
    canvas.addEventListener('wheel', wheel, { passive: false });
    return () => canvas.removeEventListener('wheel', wheel);
  }, []);

  const updateCodes = useCallback((next: string[], nextDates: string[] = next.map(() => '')) => {
    setUndo(previous => [...previous.slice(-19), { codes, dates }]);
    setCodes(next);
    setDates(nextDates);
  }, [codes, dates]);
  const undoLast = useCallback(() => {
    if (!undo.length) return;
    setCodes(undo[undo.length - 1].codes); setDates(undo[undo.length - 1].dates); setUndo(previous => previous.slice(0, -1)); setNotice({text: 'Se ha deshecho el último cambio.'});
  }, [undo]);
  const changeSetting = <K extends keyof Settings>(key: K, value: Settings[K]) => setSettings(previous => ({...previous, [key]: key === 'startNumber' ? Math.trunc(Number(value)) : value}));

  const addCodes = useCallback(() => {
    const batch = parseCodes(input);
    if (batch.invalidLines.length) {
      setInputError(batch.invalidLines.slice(0, 3).map(line => `Línea ${line.line}: ${line.error}`).join(' · ')); return;
    }
    if (!batch.codes.length) { inputRef.current?.focus(); return; }
    if (codes.length + batch.codes.length > MAX_CODES) { setInputError(`El máximo es de ${MAX_CODES} códigos por documento.`); return; }
    const repeatCount = batch.codes.filter((code: string, index: number) => codes.includes(code) || batch.codes.indexOf(code) < index).length;
    updateCodes([...codes, ...batch.codes], [...dates, ...batch.codes.map(() => '')]); setInput(''); setInputError('');
    setPage(Math.floor(codes.length / ROWS[settings.layout]));
    setNotice({text: `${batch.codes.length} ${batch.codes.length === 1 ? 'código añadido' : 'códigos añadidos'}${repeatCount ? `. Se mantienen ${repeatCount} repetidos.` : '.'}`});
  }, [input, codes, dates, settings.layout, updateCodes]);

  const runAction = useCallback(async (action: 'exportPdf' | 'print' | 'exportImages' | 'saveProject' | 'openProject', imageOptions?: ImageExportOptions) => {
    if (busy) return;
    if (action !== 'openProject' && !codes.length) {setNotice({text:'Añade al menos un código para continuar.',error:true}); return;}
    if (!api) {setNotice({text:'Esta acción está disponible en la aplicación de Windows.',error:true}); return;}
    setBusy(action);
    try {
      const result = action === 'openProject' ? await api.openProject() : action === 'exportImages' ? await api.exportImages(project, imageOptions) : await api[action](project);
      if (result.canceled) return;
      if (action === 'openProject' && result.project) {
        updateCodes(result.project.codes, result.project.dates ?? result.project.codes.map(() => '')); setSettings({...INITIAL_SETTINGS,...normalizeSettings(result.project.settings)} as Settings); setPage(0); setInput(''); setInputError('');
      }
      const imageCount = result.count ?? codes.length;
      const messages = {
        exportPdf: isWeb ? 'Elige «Guardar como PDF» en el diálogo de impresión.' : 'PDF guardado correctamente.',
        print: isWeb ? 'Se abrió el diálogo de impresión del navegador.' : 'Documento enviado a la impresora.',
        exportImages: isWeb ? imageCount === 1 ? 'Se inició la descarga de la imagen PNG.' : `Se inició la descarga de un ZIP con ${imageCount} imágenes PNG.` : `${imageCount} imágenes guardadas.`,
        saveProject: isWeb ? 'Se inició la descarga del archivo de proyecto.' : 'Proyecto guardado. Podrás continuar más tarde.',
        openProject: 'Proyecto abierto correctamente.',
      };
      setNotice({text:result.message || messages[action]});
    } catch(error) {setNotice({text:errorMessage(error),error:true});}
    finally {setBusy('');}
  }, [api, busy, codes.length, isWeb, project, updateCodes]);

  const runUpdateAction = async (action: 'check' | 'download' | 'install' | 'releases') => {
    if (updateAction) return;
    setUpdateAction(action);
    setUpdateError('');
    try {
      if (action === 'check' && api?.checkForUpdates) {
        setUpdateState(await api.checkForUpdates());
      } else if (action === 'download' && api?.downloadUpdate) {
        setUpdateState(await api.downloadUpdate());
      } else if (action === 'releases' && api?.openReleasePage) {
        await api.openReleasePage();
      } else if (action === 'install' && api?.installUpdate) {
        const saved = await api.saveSession({ codes, dates, settings, theme, input });
        if (!saved) throw new Error('No se pudo guardar la sesión. Guarda el proyecto antes de reiniciar.');
        await api.installUpdate();
      } else {
        throw new Error('Esta acción está disponible en la aplicación de Windows.');
      }
    } catch (error) {
      const message = errorMessage(error);
      setUpdateError(message);
      setNotice({ text: message, error: true });
    } finally {
      setUpdateAction(null);
    }
  };

  const changeInstallationLocation = async () => {
    if (maintenanceBusy || busy || !api?.changeInstallationLocation) return;
    setMaintenanceBusy(true);
    try {
      const saved = await api.saveSession({ codes, dates, settings, theme, input });
      if (!saved) throw new Error('No se pudo guardar la sesión. Guarda el proyecto antes de cambiar la ubicación.');
      await api.changeInstallationLocation();
    } catch (error) { setNotice({ text: errorMessage(error), error: true }); }
    finally { setMaintenanceBusy(false); }
  };

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === 's') {event.preventDefault(); void runAction('saveProject');}
      if (key === 'o') {event.preventDefault(); void runAction('openProject');}
      if (key === 'p') {event.preventDefault(); void runAction('print');}
      if (key === 'e' && event.shiftKey) {event.preventDefault(); void runAction('exportPdf');}
      if (key === 'z' && !(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)) {event.preventDefault();undoLast();}
    };
    addEventListener('keydown', handler); return () => removeEventListener('keydown', handler);
  }, [runAction, undoLast]);

  useLayoutEffect(() => {
    if (!(settingsOpen || updatesOpen || editing !== null || confirmClear)) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>('.modal[role="dialog"]');
    const focusable = () => [...(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]') ?? [])];
    (dialog?.querySelector<HTMLElement>('[data-initial-focus]') ?? focusable()[0])?.focus();
    const handleModal = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === 'Escape') {event.preventDefault();setSettingsOpen(false);setUpdatesOpen(false);setEditing(null);setConfirmClear(false);}
      if (event.key !== 'Tab') return;
      const elements = focusable();
      const first = elements[0], last = elements[elements.length - 1];
      if (!dialog?.contains(document.activeElement)) {event.preventDefault();(event.shiftKey ? last : first)?.focus();return;}
      if (event.shiftKey && document.activeElement === first) {event.preventDefault();last?.focus();}
      else if (!event.shiftKey && document.activeElement === last) {event.preventDefault();first?.focus();}
    };
    addEventListener('keydown',handleModal);
    return () => {removeEventListener('keydown',handleModal);(previous?.isConnected ? previous : updatesOpen ? updatesButtonRef.current : inputRef.current)?.focus({preventScroll:true});};
  }, [settingsOpen, updatesOpen, editing, confirmClear]);

  useLayoutEffect(() => {
    const dialog = updatesDialogRef.current;
    if (updatesOpen && dialog && !dialog.contains(document.activeElement)) dialog.querySelector<HTMLButtonElement>('[data-initial-focus]')?.focus();
  }, [updatesOpen, updates.status, updateAction]);

  const previewHtml = useMemo(() => {
    if (!codes.length) return '';
    try {
      const html = renderDocument({codes, dates, settings, logoDataUrl: logo});
      return html.replace('</head>', `<style>@media screen{html,body{margin:0!important;padding:0!important;background:#fff!important}section.page{display:none!important;margin:0!important;box-shadow:none!important;border:0!important}section.page:nth-of-type(${page+1}){display:flex!important}}</style></head>`);
    } catch {return '';}
  }, [codes, dates, settings, logo, page]);

  const moveCode = (from: number, to: number) => {
    if (from === to || to < 0 || to >= codes.length) return;
    const next = [...codes], nextDates = [...dates];
    const [item] = next.splice(from,1), [date] = nextDates.splice(from,1);
    next.splice(to,0,item); nextDates.splice(to,0,date); updateCodes(next,nextDates);
  };
  const saveEdit = () => {
    const value = editValue.trim(); const validation = validateCode(value);
    if (!validation.valid) {setEditError(validation.error || 'Código no válido.');return;}
    const date = parseDate(editDate);
    if (date === null) {setEditError('Introduce una fecha válida en formato DD/MM/AAAA o deja el campo vacío.');return;}
    if (editing !== null) {updateCodes(codes.map((code,index) => index === editing ? value : code), dates.map((entry,index) => index === editing ? date : entry));setEditing(null);}
  };
  const paste = async () => {
    try {const value = api ? await api.readClipboard() : await navigator.clipboard.readText();setInput(previous => previous ? `${previous.trimEnd()}\n${value}` : value);setInputError('');inputRef.current?.focus();}
    catch {setNotice({text:'No se pudo leer el portapapeles. Usa Ctrl + V en el campo de códigos.',error:true});}
  };
  const updatePrimaryAction = updateReady ? 'install' : updates.canAutoUpdate ? 'download' : 'releases';
  const updatePrimaryLabel = updateReady ? 'Reiniciar e instalar' : updates.canAutoUpdate ? updateFailed ? 'Reintentar descarga' : 'Descargar actualización' : 'Abrir descargas';
  const updatePrimaryDisabled = !!updateAction || !!busy || (updatePrimaryAction === 'releases' ? !api?.openReleasePage : updatePrimaryAction === 'install' ? !api?.installUpdate : !api?.downloadUpdate);
  const updatePanel = <section className="updates-section" aria-label="Estado de actualización">
    <div className="update-version-summary"><div><span>Versión actual</span><strong>v{currentDisplayVersion}</strong></div>{hasUpdate && updates.availableVersion && <div><span>{updateReady ? 'Lista para instalar' : 'Versión disponible'}</span><strong>v{availableDisplayVersion}</strong></div>}</div>
    <div className={`update-status ${updates.status === 'error' || updateError ? 'update-status-error' : ''}`} role="status" aria-live="polite">
      {updateInProgress ? <LoaderCircle size={17} className="spin"/> : updateReady || updates.status === 'up-to-date' ? <CheckCircle2 size={17}/> : <Download size={17}/>}
      <div><strong>{updateStatusText}</strong>{updates.availableVersion && hasUpdate && <span>PhoneGest Barcode Studio {availableDisplayVersion}</span>}{['unsupported', 'error', 'downloaded'].includes(updates.status) && updates.message && <p>{updates.message}</p>}</div>
    </div>
    {updates.status === 'downloading' && <div className="update-download-progress"><progress aria-label="Descarga de la actualización" value={updateProgress} max={100}/><span>{updateProgress === undefined ? 'Descargando…' : `${updateProgress} %`}</span></div>}
    {updateError && <p className="update-inline-error" role="alert">{updateError}</p>}
    <div className="updates-actions">
      <button className="button button-secondary" onClick={() => void runUpdateAction('check')} disabled={!api?.checkForUpdates || updateInProgress || !!updateAction}>{updates.status === 'checking' ? <LoaderCircle size={14} className="spin"/> : <RefreshCw size={14}/>}Buscar actualizaciones</button>
      {((updates.canAutoUpdate && (updates.status === 'available' || updates.status === 'downloaded' || (updates.status === 'error' && updates.availableVersion))) || !updates.canAutoUpdate) && <button className="button button-primary" onClick={() => void runUpdateAction(updatePrimaryAction)} disabled={updatePrimaryDisabled}>{updateAction === updatePrimaryAction ? <LoaderCircle size={14} className="spin"/> : updatePrimaryAction === 'install' ? <RefreshCw size={14}/> : updatePrimaryAction === 'releases' ? <ArrowUpRight size={14}/> : <Download size={14}/>} {updatePrimaryLabel}</button>}
    </div>
    {formatLastChecked(updates.lastCheckedAt) && <p className="update-last-checked">Última comprobación: {formatLastChecked(updates.lastCheckedAt)}</p>}
    <p className="update-help">{updates.canAutoUpdate ? 'La aplicación busca y descarga nuevas versiones automáticamente. Tú decides cuándo reiniciar para instalarlas.' : 'En esta edición, las nuevas versiones se descargan desde la página de PhoneGest en GitHub.'}</p>
    <p className="update-privacy"><ShieldCheck size={13}/><span>Solo las actualizaciones usan conexión a Internet. Tus códigos se procesan siempre en este equipo.</span></p>
  </section>;
  const updateBanner = hasUpdate && dismissedUpdate !== updateNotificationKey && <aside className="update-banner" aria-label="Nueva versión de PhoneGest" role="status">
    <span className="update-banner-icon">{updates.status === 'downloading' ? <LoaderCircle size={19} className="spin"/> : updateReady ? <CheckCircle2 size={19}/> : <Download size={19}/>}</span>
    <div><strong>{updateReady ? `Versión ${availableDisplayVersion} lista para instalar` : updates.status === 'downloading' ? `Descargando versión ${availableDisplayVersion}${updateProgress === undefined ? '' : ` · ${updateProgress} %`}` : `Versión ${availableDisplayVersion} disponible`}</strong><p>{updateFailed ? updates.message || 'No se pudo descargar la actualización. Puedes volver a intentarlo.' : updateReady ? 'Reinicia cuando te venga bien. Se conservará tu sesión.' : 'Puedes seguir generando códigos mientras se prepara la actualización.'}</p></div>
    <button className="button button-secondary" onClick={openUpdates}>{updates.status === 'downloading' ? 'Ver progreso' : 'Ver detalles'}</button>
    {(updateReady || updateFailed) && <button className="button button-primary" onClick={() => void runUpdateAction(updatePrimaryAction)} disabled={updatePrimaryDisabled}>{updateAction === updatePrimaryAction ? <LoaderCircle size={14} className="spin"/> : updateReady ? <RefreshCw size={14}/> : <Download size={14}/>} {updatePrimaryLabel}</button>}
    <button className="icon-button small" onClick={() => setDismissedUpdate(updateNotificationKey)} aria-label="Ocultar aviso de actualización"><X size={15}/></button>
  </aside>;
  const disabled = !codes.length || !!busy || !ready || !!filePreview.error || maintenanceBusy;
  const chooseLayout = (value: string) => { if (value === 'large' || value === 'comfortable' || value === 'compact') changeSetting('layout', value); };
  const changeZoom = (value: number) => { setAutoFit(false); setZoom(Math.min(2.5, Math.max(0.1, value))); };
  const endPan = () => { panGesture.current = null; setDraggingPage(false); };

  return <div className={isWeb ? 'app-shell web-app' : 'app-shell'}>
    <header className="app-header">
      <div className="brand">{logo ? <img src={logo} alt="PhoneGest" className="brand-logo"/> : <span className="brand-text">PhoneGest</span>}<span className="brand-divider"/><div className="brand-product"><span>Barcode Studio</span><span className="internal-tag">{isWeb ? 'WEB' : 'INTERNO'}</span></div></div>
      <div className="header-tools">
        <span className="local-processing-badge"><span className="status-dot"/>Procesamiento local</span><span className="header-divider"/>
        {isWeb ? <a className="button button-secondary web-download-link" href={WINDOWS_DOWNLOADS} target="_blank" rel="noopener noreferrer" title="Descargar para Windows" aria-label="Descargar para Windows"><Download size={16}/><span>Windows</span></a> : <>
          <button ref={updatesButtonRef} className={`button update-header-button ${hasUpdate ? 'has-update' : ''}`} onClick={openUpdates} title={updateReady ? 'Actualización lista para instalar' : hasUpdate ? 'Hay una actualización de PhoneGest' : 'Actualizaciones'} aria-label="Actualizaciones" aria-haspopup="dialog" aria-expanded={updatesOpen} aria-controls={updatesOpen ? 'updates-dialog' : undefined} aria-describedby={hasUpdate ? 'update-header-status' : undefined}>{updateInProgress ? <LoaderCircle size={16} className="spin"/> : <RefreshCw size={16}/>}<span>Actualizaciones</span>{hasUpdate && <span className="update-indicator" aria-hidden="true"/>}</button>
          <span id="update-header-status" className="sr-only">{updateStatusText}{updates.availableVersion ? ` · Versión ${availableDisplayVersion}` : ''}</span>
        </>}
        <button className="icon-button" onClick={() => setTheme(dark ? 'light' : 'dark')} title={dark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'} aria-label={dark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}>{dark ? <Sun size={19}/> : <Moon size={19}/>}</button><button className="icon-button" onClick={() => setSettingsOpen(true)} title="Configuración" aria-label="Configuración"><Settings2 size={19}/></button>
      </div>
    </header>
    {updateBanner}

    <main className="workspace" aria-label="Espacio de trabajo">
      <div className="workspace-toolbar"><div className="project-actions" role="group" aria-label="Acciones del proyecto"><button className="button button-secondary" onClick={() => void runAction('openProject')} disabled={!!busy}><FolderOpen size={16}/>Abrir proyecto</button><button className="button button-secondary" onClick={() => void runAction('saveProject')} disabled={disabled}><Save size={16}/>Guardar proyecto</button></div></div>

      <div className="studio-grid">
        <aside className="codes-column">
          <section className="panel input-panel" aria-labelledby="input-heading"><div className="panel-heading"><div className="heading-icon blue"><ScanLine size={19}/></div><div><h2 id="input-heading">Añade tus códigos</h2><p>Un identificador por línea</p></div><span className="format-badge">CODE 128</span></div>
            <div className="textarea-wrap"><textarea ref={inputRef} value={input} onChange={event => {setInput(event.target.value);setInputError('');}} onKeyDown={event => {if(event.ctrlKey && event.key === 'Enter') {event.preventDefault();addCodes();}}} placeholder={'L3A5KA9807022320129590Q\nL3A5KA9806994060129590B\n…'} aria-label="Códigos separados por saltos de línea" spellCheck={false} maxLength={150000}/><div className="input-tools"><button className="text-button" onClick={() => void paste()}><ClipboardPaste size={14}/>Pegar</button><button className="text-button muted" onClick={() => {setInput('');setInputError('');inputRef.current?.focus();}} disabled={!input}><X size={14}/>Limpiar</button><span>{input.trim() ? `${parsed.codes.length} detectados` : 'Ctrl + V para pegar'}</span></div></div>
            {inputError && <p role="alert" className="field-error">{inputError}</p>}
            <button className="button button-primary add-button" onClick={addCodes} disabled={!input.trim() || !ready}><Plus size={18}/>Añadir códigos<span className="shortcut">Ctrl ↵</span></button>
            <p className="input-hint"><ShieldCheck size={13}/>Tus identificadores se quedan en este equipo.</p>
          </section>

          <section className="panel list-panel" aria-labelledby="list-heading"><div className="list-heading"><div><h2 id="list-heading">Códigos del documento <span className="count-badge">{codes.length}</span></h2><p>{codes.length ? 'Arrastra para cambiar el orden' : 'Tu próximo envío empieza aquí'}</p></div><button className="icon-button small" onClick={undoLast} disabled={!undo.length} title="Deshacer último cambio (Ctrl+Z)" aria-label="Deshacer último cambio"><RotateCcw size={16}/></button></div>
            <div className={`code-list ${!codes.length ? 'is-empty' : ''}`}>
              {!codes.length ? <div className="empty-list"><div className="empty-list-icon"><Barcode size={31} strokeWidth={1.4}/></div><p>Todavía no hay códigos</p><span>Añade uno o varios identificadores<br/>para ver el documento al instante.</span><button className="text-button example-button" onClick={() => {setInput(EXAMPLES.join('\n'));inputRef.current?.focus();}}>Probar con un ejemplo<ArrowUpRight size={14}/></button></div> : codes.map((code,index) => <div className={`code-row ${dropIndex === index ? 'drop-target' : ''}`} key={`${index}-${code}`} draggable onDragStart={event => {dragIndex.current=index;event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',String(index));}} onDragOver={event => {event.preventDefault();setDropIndex(index);}} onDragLeave={() => setDropIndex(null)} onDrop={event => {event.preventDefault();if(dragIndex.current!==null)moveCode(dragIndex.current,index);dragIndex.current=null;setDropIndex(null);}} onDragEnd={() => {dragIndex.current=null;setDropIndex(null);}}>
                <GripVertical className="drag-handle" size={14}/><span className="row-number">{String(settings.startNumber + index).padStart(2,'0')}</span><div className="row-code"><span title={code}>{code}</span><span className="row-valid">{dates[index] ? <><CalendarDays size={10}/>{formatDate(dates[index])}</> : <><Check size={10}/>Code 128 válido</>}</span></div><div className="row-actions"><button className="icon-button tiny" aria-label={`Subir código ${index+1}`} title="Subir" disabled={index===0} onClick={() => moveCode(index,index-1)}><ArrowUp size={13}/></button><button className="icon-button tiny" aria-label={`Bajar código ${index+1}`} title="Bajar" disabled={index===codes.length-1} onClick={() => moveCode(index,index+1)}><ArrowDown size={13}/></button><button className="icon-button tiny" aria-label={`Editar código ${index+1}`} title="Editar código y fecha" onClick={() => {setEditing(index);setEditValue(code);setEditDate(formatDate(dates[index] || ''));setEditError('');}}><Pencil size={13}/></button><button className="icon-button tiny danger-hover" aria-label={`Eliminar código ${index+1}`} title="Eliminar" onClick={() => updateCodes(codes.filter((_,i) => i!==index),dates.filter((_,i) => i!==index))}><Trash2 size={13}/></button></div>
              </div>)}
            </div>
            {codes.length > 0 && <div className="list-footer"><span><CheckCircle2 size={14}/>{duplicates ? `${duplicates} ${duplicates === 1 ? 'repetido conservado' : 'repetidos conservados'}` : 'Todos los códigos son válidos'}</span><button className="text-button muted" onClick={() => setConfirmClear(true)} title="Eliminar todos los códigos"><Trash2 size={13}/>Vaciar</button></div>}
          </section>
        </aside>

        <section className="panel preview-panel" aria-labelledby="preview-heading"><div className="preview-heading"><div><span className="preview-title-icon"><FileText size={18}/></span><h2 id="preview-heading">Vista previa</h2><span className="live-badge"><span/>EN DIRECTO</span></div><span className="paper-type">A4 <span>210 × 297 mm</span></span></div>
          <div className="preview-toolbar"><div className="layout-select"><ListOrdered size={15}/><Select value={settings.layout} options={layoutOptions} onChange={chooseLayout} ariaLabel="Formato del documento" variant="toolbar"/></div><span className="toolbar-divider"/><label className="toolbar-check"><input type="checkbox" checked={settings.showNumbers} onChange={event => changeSetting('showNumbers',event.target.checked)}/>Numeración</label><label className="toolbar-check"><input type="checkbox" checked={settings.showCheckboxes} onChange={event => changeSetting('showCheckboxes',event.target.checked)}/>Casillas</label><button className="icon-button small format-settings" title="Más opciones de formato" aria-label="Más opciones de formato" onClick={() => setSettingsOpen(true)}><Settings2 size={16}/></button></div>
          <div className={`preview-canvas ${draggingPage ? 'is-panning' : ''}`} ref={previewRef} tabIndex={0} aria-label="Área del documento. Usa la rueda para ampliar y arrastra para desplazar." onPointerDown={event => {
            if (event.button !== 0) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            panGesture.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
            setAutoFit(false); setDraggingPage(true);
          }} onPointerMove={event => {
            const gesture = panGesture.current;
            if (!gesture || gesture.pointer !== event.pointerId) return;
            const next = { x: gesture.panX + event.clientX - gesture.x, y: gesture.panY + event.clientY - gesture.y };
            viewTransform.current = { zoom, pan: next }; setPan(next);
          }} onPointerUp={endPan} onPointerCancel={endPan} onLostPointerCapture={endPan} onKeyDown={event => {
            if (event.key === '+' || event.key === '=') { event.preventDefault(); changeZoom(zoom + 0.1); }
            if (event.key === '-') { event.preventDefault(); changeZoom(zoom - 0.1); }
            if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); setAutoFit(false); setPan(p => ({ x: p.x + (event.key === 'ArrowLeft' ? 30 : event.key === 'ArrowRight' ? -30 : 0), y: p.y + (event.key === 'ArrowUp' ? 30 : event.key === 'ArrowDown' ? -30 : 0) })); }
          }}><div className="page-wrapper" style={{width:794*zoom,height:1123*zoom,transform:`translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px))`}}><div className="paper-sheet" style={{width:794,height:1123,transform:`scale(${zoom})`}}>
            {codes.length && previewHtml ? <iframe title={`Página ${page+1} del documento A4`} sandbox="" srcDoc={previewHtml} width="794" height="1123" scrolling="no"/> : <div className="empty-paper">{logo && <img src={logo} alt="PhoneGest"/>}<div className="empty-paper-content"><div className="empty-paper-barcode"><Barcode size={88} strokeWidth={1}/><span/><span/></div><h3>Tu documento empieza aquí</h3><p>Añade códigos para generar<br/>tu primera hoja de etiquetas.</p><span className="empty-paper-tag">FORMATO PHONEGEST · A4</span></div><div className="empty-paper-footer">PhoneGest Barcode Studio</div></div>}
          </div></div></div>
          <div className="preview-footer"><div className="pagination"><button className="icon-button small" aria-label="Página anterior" disabled={page===0} onClick={() => setPage(p=>p-1)}><ChevronLeft size={16}/></button><span>Página <strong>{page+1}</strong> de <strong>{pageCount}</strong></span><button className="icon-button small" aria-label="Página siguiente" disabled={page>=pageCount-1} onClick={() => setPage(p=>p+1)}><ChevronRight size={16}/></button></div><div className="zoom-controls"><button className="text-button fit-button" onClick={() => {setPan({x:0,y:0});setAutoFit(true);}} title="Ajustar a la ventana">Ajustar</button><span className="toolbar-divider"/><button className="icon-button small" aria-label="Reducir zoom" disabled={zoom<=0.1} onClick={() => changeZoom(zoom-0.1)}><Minus size={14}/></button><span>{Math.round(zoom*100)}%</span><button className="icon-button small" aria-label="Ampliar zoom" disabled={zoom>=2.5} onClick={() => changeZoom(zoom+0.1)}><Plus size={14}/></button></div></div>
        </section>
      </div>

      <footer className="action-bar"><div className="document-summary"><span className="summary-icon"><CheckCheck size={20}/></span><div><strong>{filePreview.error ? 'Revisa las variables en Configuración' : codes.length ? `${codes.length} ${codes.length===1?'código listo':'códigos listos'} para exportar` : 'Todo listo para empezar'}</strong><span>{codes.length ? `${pageCount} ${pageCount===1?'página':'páginas'} A4` : 'Añade tus primeros códigos'}<span className="summary-dot">·</span>{saveError ? 'No se pudo guardar la sesión' : isWeb ? 'Guardado en este navegador' : 'Guardado automático local'}</span></div></div><div className="export-actions"><ExportImagesMenu disabled={disabled} busy={busy==='exportImages'} onExport={options => void runAction('exportImages',options)}/><button className="button button-secondary print-button" onClick={() => void runAction('print')} disabled={disabled}>{busy==='print'?<LoaderCircle className="spin" size={17}/>:<Printer size={17}/>}Imprimir</button><button className="button button-primary export-button" onClick={() => void runAction('exportPdf')} disabled={disabled}>{busy==='exportPdf'?<LoaderCircle className="spin" size={18}/>:<FileDown size={18}/>}<span>{isWeb ? 'Guardar como PDF' : 'Generar PDF'}</span><Download size={15}/></button></div></footer>
      <div className="bottom-meta"><span>PHONEGEST BARCODE STUDIO <span>v{currentDisplayVersion}</span></span><span><ShieldCheck size={12}/>Tus códigos se procesan siempre en este equipo.</span></div>
    </main>

    {notice && <div className={`toast ${notice.error?'toast-error':''}`} role={notice.error?'alert':'status'}>{notice.error?<X size={18}/>:<CheckCircle2 size={18}/>}<span>{notice.text}</span><button className="icon-button small" onClick={() => setNotice(null)} aria-label="Cerrar notificación"><X size={15}/></button></div>}

    {!isWeb && updatesOpen && <div className="modal-overlay" onMouseDown={event => {if (event.target === event.currentTarget) {event.preventDefault();setUpdatesOpen(false);}}}>
      <section id="updates-dialog" ref={updatesDialogRef} className="modal updates-modal" role="dialog" aria-modal="true" aria-labelledby="updates-dialog-title" aria-describedby="updates-dialog-description">
        <div className="modal-heading"><div className="heading-icon blue"><RefreshCw size={20}/></div><div><h2 id="updates-dialog-title">Actualizaciones</h2><p id="updates-dialog-description">Consulta e instala nuevas versiones de la aplicación.</p></div><button className="icon-button" data-initial-focus onClick={() => setUpdatesOpen(false)} aria-label="Cerrar actualizaciones"><X size={20}/></button></div>
        <div className="modal-content">{updatePanel}</div>
        <div className="modal-footer"><span><ShieldCheck size={13}/>Tus códigos permanecen en este equipo</span><button className="button button-secondary" onClick={() => setUpdatesOpen(false)}>Cerrar</button></div>
      </section>
    </div>}

    {settingsOpen && <div className="modal-overlay" onMouseDown={event=>{if(event.target===event.currentTarget){event.preventDefault();setSettingsOpen(false);}}}><section className="modal settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <div className="modal-heading"><div className="heading-icon blue"><Settings2 size={20}/></div><div><h2 id="settings-title">Hazlo a tu medida</h2><p>Los cambios se aplican al instante.</p></div><button className="icon-button" onClick={()=>setSettingsOpen(false)} aria-label="Cerrar configuración"><X size={20}/></button></div>
      <div className="modal-content">
        <label className="form-label">Título del documento <span>Opcional · admite variables</span><input data-initial-focus value={settings.documentTitle} maxLength={240} placeholder="Ej. Envío de {total} paquetes · {fecha}" onChange={event=>changeSetting('documentTitle',event.target.value)}/></label>
        <label className="form-label">Nombre del archivo<input value={settings.filenameTemplate} maxLength={180} placeholder="phonegest-barcodes-{total}-{fecha}" onChange={event=>changeSetting('filenameTemplate',event.target.value)} aria-describedby="filename-preview"/></label>
        <div className="filename-preview" id="filename-preview">{filePreview.error ? <p className="field-error" role="alert">{filePreview.error}</p> : <><FileText size={14}/><span>{filePreview.name}</span></>}</div>
        <details className="template-help"><summary>Variables para el título y el archivo</summary><p>Escríbelas entre llaves. Se sustituyen al exportar.</p><dl>{TEMPLATE_VARIABLES.map((variable: {key: string; label: string; example: string}) => <div key={variable.key}><dt>{`{${variable.key}}`}</dt><dd>{variable.label}<span>{variable.example}</span></dd></div>)}</dl></details>
        <div className="form-label"><label htmlFor="settings-layout">Distribución</label><Select id="settings-layout" value={settings.layout} options={layoutOptions} onChange={chooseLayout} ariaLabel="Distribución"/></div>
        <div className="setting-row"><div><strong>Numerar los códigos</strong><p>Numeración continua en todo el documento.</p></div><input className="switch" type="checkbox" aria-label="Numerar los códigos" checked={settings.showNumbers} onChange={event=>changeSetting('showNumbers',event.target.checked)}/></div>
        <label className="form-label inline-label">Empezar por el número<input type="number" inputMode="numeric" min={1} max={999999} value={startNumberInput} onChange={event=>{
          const draft = event.target.value;
          if (!/^\d*$/.test(draft)) return;
          setStartNumberInput(draft);
          if (Number(draft) >= 1 && Number(draft) <= 999999) changeSetting('startNumber',Number(draft));
        }} onBlur={()=>setStartNumberInput(String(settings.startNumber))}/></label>
        <div className="setting-row"><div><strong>Casillas para paquetes</strong><p>Una casilla junto a cada código.</p></div><input className="switch" type="checkbox" aria-label="Casillas para paquetes" checked={settings.showCheckboxes} onChange={event=>changeSetting('showCheckboxes',event.target.checked)}/></div>
        <div className="setting-row"><div><strong>Mostrar identificadores</strong><p>Texto legible debajo del código de barras.</p></div><input className="switch" type="checkbox" aria-label="Mostrar identificadores" checked={settings.showText} onChange={event=>changeSetting('showText',event.target.checked)}/></div>
        <div className="theme-setting">
      <span className="form-label" id="theme-label">Apariencia</span>
      <div className="theme-options" role="group" aria-labelledby="theme-label">
        {THEME_OPTIONS.map(({ value, label, Icon }) => (
          <button key={value} type="button" className={theme === value ? 'selected' : ''} aria-pressed={theme === value} onClick={() => setTheme(value)}>
            <Icon size={16} aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>
        </div>
        {!isWeb && api?.getInstallationInfo && <section className="installation-setting" aria-labelledby="installation-title"><strong id="installation-title">Ubicación de la aplicación</strong>{installation ? <><p className="installation-path">{installation.path}</p><p>{installation.reason || 'Se guardará la sesión y se abrirá el asistente para elegir otra carpeta o disco. La aplicación se cerrará al abrirlo.'}</p><button className="button button-secondary" disabled={!installation.canChangeLocation || maintenanceBusy || !!busy} onClick={()=>void changeInstallationLocation()}>{maintenanceBusy ? <LoaderCircle className="spin" size={15}/> : <FolderOpen size={15}/>}Cambiar ubicación</button></> : <p>Consultando la instalación…</p>}</section>}
        <div className="creator-setting"><span className="creator-mark"><Barcode size={21}/></span><div><strong>PhoneGest Barcode Studio <span>v{currentDisplayVersion}</span></strong><p>Creado por <a href="https://github.com/ImPaul17" target="_blank" rel="noopener noreferrer">ImPaul</a> para PhoneGest.</p></div></div>
      </div><div className="modal-footer"><span><ShieldCheck size={13}/>Se guarda en este equipo</span><button className="button button-primary" onClick={()=>setSettingsOpen(false)}><Check size={16}/>Listo</button></div></section></div>}

    {editing!==null && <div className="modal-overlay"><section className="modal edit-modal" role="dialog" aria-modal="true" aria-labelledby="edit-title"><div className="modal-heading"><div className="heading-icon blue"><Pencil size={19}/></div><div><h2 id="edit-title">Editar código {editing+1}</h2><p>El código de barras y su fecha se actualizarán al guardar.</p></div><button className="icon-button" onClick={()=>setEditing(null)} aria-label="Cerrar edición"><X size={20}/></button></div><div className="modal-content"><label className="form-label">Identificador<input data-initial-focus className="code-edit-input" value={editValue} onChange={event=>{setEditValue(event.target.value);setEditError('');}} onKeyDown={event=>{if(event.key==='Enter')saveEdit();}} spellCheck={false}/></label><label className="form-label">Fecha del código <span>Opcional</span><input aria-label="Fecha del código" placeholder="DD/MM/AAAA" value={editDate} maxLength={10} inputMode="numeric" onChange={event=>{setEditDate(event.target.value);setEditError('');}} onKeyDown={event=>{if(event.key==='Enter')saveEdit();}} aria-describedby="date-help"/></label><p id="date-help" className="setting-help">Aparece a la izquierda del identificador en el PDF y las imágenes.</p>{editError&&<p role="alert" className="field-error">{editError}</p>}</div><div className="modal-footer"><button className="button button-secondary" onClick={()=>setEditing(null)}>Cancelar</button><button className="button button-primary" onClick={saveEdit}><Check size={16}/>Guardar cambio</button></div></section></div>}

    {confirmClear && <div className="modal-overlay"><section className="modal edit-modal" role="dialog" aria-modal="true" aria-labelledby="clear-title"><div className="modal-heading"><div className="heading-icon red"><Trash2 size={20}/></div><div><h2 id="clear-title">Vaciar el documento</h2><p>Se quitarán los {codes.length} códigos de la lista.</p></div></div><div className="modal-content"><p className="confirm-text">Puedes recuperar la lista con el botón Deshacer.</p></div><div className="modal-footer"><button className="button button-secondary" onClick={()=>setConfirmClear(false)}>Cancelar</button><button className="button button-danger" onClick={()=>{updateCodes([]);setConfirmClear(false);}}>Vaciar documento</button></div></section></div>}
  </div>;
}

function errorMessage(error: unknown) {return error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : 'No se pudo completar la operación. Inténtalo de nuevo.';}

function updateStatus(state: UpdateState) {
  switch (state.status) {
    case 'checking': return 'Buscando actualizaciones…';
    case 'available': return 'Hay una nueva versión disponible';
    case 'downloading': return 'Descargando actualización';
    case 'downloaded': return 'Todo listo para actualizar';
    case 'up-to-date': return 'Tienes la última versión';
    case 'error': return 'No se pudo completar la actualización';
    case 'unsupported': return 'Actualización mediante descarga';
    default: return 'Las actualizaciones se comprueban automáticamente';
  }
}

function formatLastChecked(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
