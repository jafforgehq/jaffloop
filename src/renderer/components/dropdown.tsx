// A menu button whose face can be text or an icon (ui.tsx MenuButton is icon-only). Used by the item row, drawer and bulk bar.
import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Icon } from './icons';
import type { MenuItem } from './ui';

export function Dropdown({ face, items, label, title, className = 'btn quiet icon', align }: {
  face: ComponentChildren; items: MenuItem[]; label: string; title?: string; className?: string; align?: 'right';
}) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const pane = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { const t = e.target as Node; if (!pane.current?.contains(t) && !btn.current?.contains(t)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); btn.current?.focus(); } };
    window.addEventListener('mousedown', down, true);
    window.addEventListener('keydown', key, true);
    pane.current?.querySelector('button')?.focus();
    return () => { window.removeEventListener('mousedown', down, true); window.removeEventListener('keydown', key, true); };
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !btn.current || !pane.current) return;
    const a = btn.current.getBoundingClientRect(), p = pane.current.getBoundingClientRect();
    let x = align === 'right' ? a.right - p.width : a.left;
    x = Math.min(Math.max(8, x), window.innerWidth - p.width - 8);
    let y = a.bottom + 4;
    if (y + p.height > window.innerHeight - 8) y = Math.max(8, a.top - p.height - 4);
    pane.current.style.left = `${x}px`; pane.current.style.top = `${y}px`;
  });

  const arrows = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const bs = [...(pane.current?.querySelectorAll('button:not(:disabled)') ?? [])] as HTMLElement[];
    const i = bs.indexOf(document.activeElement as HTMLElement);
    bs[(i + (e.key === 'ArrowDown' ? 1 : -1) + bs.length) % bs.length]?.focus();
  };

  return (
    <>
      <button type="button" ref={btn} class={className} aria-label={label} title={title ?? label} aria-haspopup="menu" aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}>{face}</button>
      {open && (
        <div class="menu" ref={pane} role="menu" onKeyDown={arrows} onClick={(e) => e.stopPropagation()}>
          {items.map((it, i) => it.divider ? <hr key={i} /> : (
            <button type="button" role="menuitem" key={i} disabled={it.disabled} style={it.danger ? { color: 'var(--clay)' } : undefined}
              onClick={(e) => { e.stopPropagation(); setOpen(false); it.onClick?.(); }}>
              <span style={{ width: 12 }}>{it.checked ? <Icon name="check" size={11} /> : null}</span>{it.label}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

/** Text button with a small chevron: "Snooze ⌄". */
export const Caret = ({ children }: { children: ComponentChildren }) => <span class="row-flex gap6">{children}<Icon name="chevdown" size={9} /></span>;
