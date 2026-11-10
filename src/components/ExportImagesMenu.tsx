import { useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Archive, ChevronDown, FolderDown, ImageDown, LoaderCircle } from 'lucide-react';
import type { ImageExportOptions } from '../types';

export default function ExportImagesMenu({ disabled, busy, onExport }: { disabled: boolean; busy: boolean; onExport(options: ImageExportOptions): void }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  useLayoutEffect(() => {
    if (!open) return;
    const bounds = trigger.current!.getBoundingClientRect();
    const height = menu.current!.offsetHeight;
    setPosition({ left: Math.max(8, Math.min(bounds.right - 255, window.innerWidth - 263)), top: bounds.top > height + 14 ? bounds.top - height - 7 : bounds.bottom + 7 });
    menu.current?.querySelector('button')?.focus();
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !trigger.current?.contains(event.target) && !menu.current?.contains(event.target)) setOpen(false); };
    const close = () => setOpen(false);
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('resize', close); window.removeEventListener('scroll', close, true); };
  }, [open]);
  const close = () => { setOpen(false); trigger.current?.focus(); };
  return <>
    <button ref={trigger} className="button button-ghost image-export-trigger" disabled={disabled} onClick={() => setOpen(value => !value)} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}>
      {busy ? <LoaderCircle className="spin" size={17}/> : <ImageDown size={17}/>}Exportar imágenes<ChevronDown size={14}/>
    </button>
    {open && createPortal(<div id={id} ref={menu} role="menu" aria-label="Formato de exportación de imágenes" className="image-export-menu" style={position} onKeyDown={event => {
      const items = [...menu.current!.querySelectorAll('button')];
      if (event.key === 'Escape' || event.key === 'Tab') { if (event.key === 'Escape') event.preventDefault(); close(); return; }
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
        items[next]?.focus();
      }
    }}>
      <button role="menuitem" onClick={() => { close(); onExport({ format: 'zip' }); }}><Archive size={18}/><span>Guardar imágenes en ZIP<small>Un archivo con todas las etiquetas PNG</small></span></button>
      <button role="menuitem" onClick={() => { close(); onExport({ format: 'folder' }); }}><FolderDown size={18}/><span>Guardar imágenes sueltas<small>Una imagen PNG por código</small></span></button>
    </div>, document.body)}
  </>;
}
