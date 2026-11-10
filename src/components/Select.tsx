import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';

export interface SelectOption<Value extends string> { value: Value; label: string; disabled?: boolean }
interface SelectProps<Value extends string> {
  value: Value;
  options: readonly SelectOption<Value>[];
  onChange(value: Value): void;
  ariaLabel: string;
  id?: string;
  variant?: 'toolbar' | 'field';
  disabled?: boolean;
}
interface Position { left: number; top: number; width: number; maxHeight: number; side: 'top' | 'bottom' }

/** Select-only combobox. Focus stays on its trigger while the listbox is open. */
export default function Select<Value extends string>({ value, options, onChange, ariaLabel, id, variant = 'field', disabled = false }: SelectProps<Value>) {
  const generatedId = useId();
  const listboxId = `${generatedId}-listbox`;
  const selectedIndex = Math.max(0, options.findIndex(option => option.value === value));
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const [position, setPosition] = useState<Position | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const search = useRef({ text: '', time: 0 });
  const optionId = (index: number) => `${listboxId}-option-${index}`;
  // A modal's popup stays in its accessibility tree; fixed positioning escapes scroll containers.
  const portalTarget = triggerRef.current?.closest<HTMLElement>('[role="dialog"]') ?? document.body;

  const close = () => { setOpen(false); setPosition(null); search.current = { text: '', time: 0 }; };
  const show = (index = selectedIndex) => { setActiveIndex(index); setOpen(true); };
  const choose = (index: number) => { if (options[index] && !options[index].disabled) { onChange(options[index].value); close(); } };
  const enabledIndices = options.flatMap((option, index) => option.disabled ? [] : [index]);

  useLayoutEffect(() => {
    if (!open || disabled) return;
    let frame = 0;
    const measure = () => {
      const trigger = triggerRef.current;
      const menu = menuRef.current;
      if (!trigger || !menu) return;
      const rect = trigger.getBoundingClientRect();
      const viewportWidth = document.documentElement.clientWidth;
      const viewportHeight = window.innerHeight;
      let visible = { left: 0, top: 0, right: viewportWidth, bottom: viewportHeight };
      for (let parent = trigger.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (/(auto|scroll|hidden|clip)/.test(`${style.overflowX} ${style.overflowY}`)) {
          const bounds = parent.getBoundingClientRect();
          visible = { left: Math.max(visible.left, bounds.left), top: Math.max(visible.top, bounds.top), right: Math.min(visible.right, bounds.right), bottom: Math.min(visible.bottom, bounds.bottom) };
        }
      }
      if (rect.bottom <= visible.top || rect.top >= visible.bottom || rect.right <= visible.left || rect.left >= visible.right) { setOpen(false); setPosition(null); return; }
      const margin = 8, gap = 6;
      const width = Math.min(Math.max(rect.width, 238), viewportWidth - margin * 2);
      const below = Math.max(0, viewportHeight - rect.bottom - gap - margin);
      const above = Math.max(0, rect.top - gap - margin);
      const desiredHeight = Math.min(menu.scrollHeight + 2, 320);
      const side = below >= desiredHeight || below >= above ? 'bottom' : 'top';
      const maxHeight = Math.max(1, Math.min(320, side === 'bottom' ? below : above));
      const height = Math.min(desiredHeight, maxHeight);
      const next: Position = {
        left: Math.max(margin, Math.min(rect.left, viewportWidth - width - margin)),
        top: Math.max(margin, Math.min(side === 'bottom' ? rect.bottom + gap : rect.top - gap - height, viewportHeight - height - margin)),
        width, maxHeight, side,
      };
      setPosition(previous => previous && Object.keys(next).every(key => previous[key as keyof Position] === next[key as keyof Position]) ? previous : next);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !triggerRef.current?.contains(event.target) && !menuRef.current?.contains(event.target)) close();
    };
    const observer = new ResizeObserver(schedule);
    if (triggerRef.current) observer.observe(triggerRef.current);
    if (menuRef.current) observer.observe(menuRef.current);
    measure();
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('blur', close);
    document.addEventListener('pointerdown', outside, true);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('blur', close);
      document.removeEventListener('pointerdown', outside, true);
    };
  }, [open, options.length, disabled]);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    const option = document.getElementById(optionId(activeIndex));
    if (!open || !position || !menu || !option) return;
    const bounds = menu.getBoundingClientRect();
    const active = option.getBoundingClientRect();
    if (active.top < bounds.top + 5) menu.scrollTop -= bounds.top + 5 - active.top;
    else if (active.bottom > bounds.bottom - 5) menu.scrollTop += active.bottom - bounds.bottom + 5;
  }, [activeIndex, open, position]);

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.ctrlKey || event.metaKey || disabled || !options.length) return;
    if (event.key === 'Tab') { if (open) choose(activeIndex); return; }
    if (event.key === 'Escape') {
      if (open) { event.preventDefault(); event.stopPropagation(); close(); }
      return;
    }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      search.current = { text: '', time: 0 };
      if (event.key === 'Home') { show(enabledIndices[0] ?? selectedIndex); return; }
      if (event.key === 'End') { show(enabledIndices.at(-1) ?? selectedIndex); return; }
      if (event.key === 'Enter' || event.key === ' ') { if (open) choose(activeIndex); else show(); return; }
      if (!open) show();
      else setActiveIndex(index => {
        const current = enabledIndices.indexOf(index);
        return enabledIndices[Math.max(0, Math.min(enabledIndices.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1)))] ?? index;
      });
      return;
    }
    if (event.key.length === 1 && !event.altKey) {
      event.preventDefault();
      event.stopPropagation();
      const now = Date.now();
      const text = now - search.current.time < 700 ? search.current.text + event.key : event.key;
      search.current = { text, time: now };
      const normalized = normalize(text);
      const query = [...normalized].every(character => character === normalized[0]) ? normalized[0] : normalized;
      const start = open ? activeIndex : selectedIndex;
      for (let step = 1; step <= options.length; step++) {
        const index = (start + step) % options.length;
        if (!options[index].disabled && normalize(options[index].label).startsWith(query)) { show(index); return; }
      }
    }
  };

  return <>
    <button id={id} ref={triggerRef} type="button" role="combobox" aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listboxId : undefined} aria-activedescendant={open ? optionId(activeIndex) : undefined} className={`select-control select-control-${variant}`} disabled={disabled || !options.length} onKeyDown={handleKeyDown} onClick={() => { if (open) close(); else show(); }} onBlur={close}>
      <span>{options[selectedIndex]?.label ?? ''}</span><ChevronDown size={14} aria-hidden="true"/>
    </button>
    {open && createPortal(<div id={listboxId} ref={menuRef} role="listbox" aria-label={ariaLabel} className="select-popover" data-side={position?.side} style={position ? { left: position.left, top: position.top, width: position.width, maxHeight: position.maxHeight } : { visibility: 'hidden', left: 0, top: 0, width: 238, maxHeight: 320 }} onMouseDown={event => event.preventDefault()}>
      {options.map((option, index) => <div key={option.value} id={optionId(index)} role="option" aria-selected={option.value === value} aria-disabled={option.disabled || undefined} data-active={index === activeIndex} className="select-option" onPointerMove={() => { if (!option.disabled) setActiveIndex(index); }} onClick={() => choose(index)}><span>{option.label}</span>{option.value === value ? <Check size={15} aria-hidden="true"/> : <span className="select-option-check"/>}</div>)}
    </div>, portalTarget)}
  </>;
}

function normalize(value: string) { return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('es'); }
