// Shared building blocks. Class names are defined in ../styles.css.
import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ItemKind, Person } from '../../shared/types';
import { Icon } from './icons';

export const KIND_VAR: Record<ItemKind, string> = {
  owe: 'var(--k-owe)', wait: 'var(--k-wait)', bring: 'var(--k-bring)', task: 'var(--k-task)', said: 'var(--k-said)', note: 'var(--k-note)',
};

export function Kbd({ children }: { children: ComponentChildren }) {
  return <span class="kbd" aria-hidden="true">{children}</span>;
}

export function Chip({ children, title }: { children: ComponentChildren; title?: string }) {
  return <span class="chip" title={title}>{children}</span>;
}

export function Dot({ kind, color }: { kind?: ItemKind; color?: string }) {
  return <span class="dot" style={{ background: color ?? (kind ? KIND_VAR[kind] : 'var(--text2)') }} />;
}

export function KindLabel({ kind }: { kind: ItemKind }) {
  return <span class="row-flex gap6 mono dim" aria-label={kind}><Dot kind={kind} />{kind}</span>;
}

export function initials(p: Pick<Person, 'name'>): string {
  const parts = p.name.trim().split(/\s+/);
  const s = parts.length > 1 ? (parts[0]![0] ?? '') + (parts[1]![0] ?? '') : p.name.slice(0, 2);
  return s.toUpperCase();
}

export function Avatar({ person, size = 22 }: { person: Pick<Person, 'name'>; size?: number }) {
  return <span class="avatar" aria-hidden="true" style={{ width: size, height: size, fontSize: size * 0.4 }}>{initials(person)}</span>;
}

type BtnProps = { children: ComponentChildren; onClick?: (e: MouseEvent) => void; title?: string; disabled?: boolean; class?: string; label?: string; type?: 'button' | 'submit' };
function Btn(kind: string, p: BtnProps) {
  return <button type={p.type ?? 'button'} class={`btn ${kind} ${p.class ?? ''}`} onClick={p.onClick as JSX.MouseEventHandler<HTMLButtonElement>} title={p.title} disabled={p.disabled} aria-label={p.label}>{p.children}</button>;
}
export const PrimaryButton = (p: BtnProps) => Btn('primary', p);
export const GhostButton = (p: BtnProps) => Btn('', p);
export const QuietButton = (p: BtnProps) => Btn('quiet', p);
export const IconButton = (p: BtnProps) => Btn('quiet icon', p);

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: Array<{ value: T; label: ComponentChildren; aria?: string }>; onChange: (v: T) => void; label?: string }) {
  return (
    <div class="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button type="button" key={o.value} aria-pressed={o.value === value} aria-label={o.aria} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

/** The signature ring. progress 0..1 fills it; `closed` shows the check (completion). */
export function LoopRing({ size = 16, line = 1.5, hot = false, closed = false, preview = false, progress }: { size?: number; line?: number; hot?: boolean; closed?: boolean; preview?: boolean; progress?: number }) {
  const r = (size - line) / 2;
  const pct = closed ? 100 : progress != null ? progress * 100 : preview ? 28 : 0;
  return (
    <span class={`loop ${hot ? 'hot' : ''} ${closed ? 'closed' : ''}`} style={{ width: size, height: size }} aria-hidden="true">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle class="track" cx={size / 2} cy={size / 2} r={r} stroke-width={line} />
        <circle class="fill" cx={size / 2} cy={size / 2} r={r} stroke-width={line} pathLength={100} stroke-dasharray="100" stroke-dashoffset={100 - pct} />
      </svg>
      <span class="check"><Icon name="check" size={size * 0.55} /></span>
    </span>
  );
}

/** Avatar inside a ring that fills as days since the last 1:1 approach the cadence. */
export function CadenceRing({ person, daysSince, overdue, size = 56, pulse = false }: { person: Person; daysSince: number | null; overdue: boolean; size?: number; pulse?: boolean }) {
  const [shown, setShown] = useState(false);
  useEffect(() => { const t = requestAnimationFrame(() => setShown(true)); return () => cancelAnimationFrame(t); }, []);
  const line = 2.5, r = (size - line) / 2;
  const target = person.cadenceDays && person.cadenceDays > 0 ? (daysSince == null ? 1 : Math.min(1, daysSince / person.cadenceDays)) : 0;
  const label = person.cadenceDays == null ? 'No 1:1 cadence' : overdue ? 'Past 1:1 cadence' : 'Within 1:1 cadence';
  return (
    <span class="loop" role="img" aria-label={label} style={{ width: size, height: size, transform: pulse ? 'scale(1.12)' : 'none', transition: 'transform 0.3s cubic-bezier(0.3,1.6,0.6,1)' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--hairline)" stroke-width={line} />
        {person.cadenceDays != null && (
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={overdue ? 'var(--clay)' : 'var(--text2)'} stroke-width={line} stroke-linecap="round"
            pathLength={100} stroke-dasharray="100" stroke-dashoffset={100 - (shown ? target * 100 : 0)}
            style={{ transform: 'rotate(-90deg)', transformOrigin: 'center', transition: 'stroke-dashoffset 0.8s ease-out' }} />
        )}
      </svg>
      <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Avatar person={person} size={size - 12} /></span>
    </span>
  );
}

export function SectionHeader({ title, count, tint, children }: { title: string; count?: number; tint?: string; children?: ComponentChildren }) {
  return (
    <div class="section-head" role="heading" aria-level={2}>
      <span class="caps" style={tint ? { color: tint } : undefined}>{title}</span>
      {count != null && <span class="dim tnum" style={{ fontSize: 11.5 }}>{count}</span>}
      <span class="rule" />
      {children}
    </div>
  );
}

export function EmptySection({ title, message }: { title: string; message: string }) {
  return <div class="empty-section"><span class="caps">{title}</span><span class="dim" style={{ fontSize: 12.5 }}>{message}</span></div>;
}

// ---------- popups ----------

export interface MenuItem { label?: ComponentChildren; onClick?: () => void; divider?: boolean; danger?: boolean; checked?: boolean; disabled?: boolean }

function useOutside(open: boolean, close: () => void, ref: { current: HTMLElement | null }) {
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    window.addEventListener('mousedown', down, true);
    window.addEventListener('keydown', key, true);
    return () => { window.removeEventListener('mousedown', down, true); window.removeEventListener('keydown', key, true); };
  }, [open]);
}

/** Positions a fixed panel under (or above) an anchor element, kept inside the window. */
function place(anchor: HTMLElement | null, panel: HTMLElement | null) {
  if (!anchor || !panel) return;
  const a = anchor.getBoundingClientRect(), p = panel.getBoundingClientRect();
  let x = Math.min(Math.max(8, a.left), window.innerWidth - p.width - 8);
  let y = a.bottom + 4;
  if (y + p.height > window.innerHeight - 8) y = Math.max(8, a.top - p.height - 4);
  panel.style.left = `${x}px`; panel.style.top = `${y}px`;
}

export function Popover({ anchor, open, onClose, children, width }: { anchor: HTMLElement | null; open: boolean; onClose: () => void; children: ComponentChildren; width?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useOutside(open, onClose, ref);
  useEffect(() => { if (open) place(anchor, ref.current); });
  if (!open) return null;
  return <div class="menu" ref={ref} style={{ width, padding: 12 }} role="dialog">{children}</div>;
}

export function MenuButton({ button, items, label, align }: { button: ComponentChildren; items: MenuItem[]; label: string; align?: 'right' }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const ref = useRef<HTMLDivElement>(null);
  useOutside(open, () => setOpen(false), ref);
  useEffect(() => { if (open) { place(btn.current, ref.current); if (align === 'right' && ref.current && btn.current) { const a = btn.current.getBoundingClientRect(); ref.current.style.left = `${Math.max(8, a.right - ref.current.offsetWidth)}px`; } } });
  return (
    <>
      <button type="button" ref={btn} class="btn quiet icon" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={(e) => { e.stopPropagation(); setOpen(!open); }}>{button}</button>
      {open && (
        <div class="menu" ref={ref} role="menu">
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

/** A context menu opened at the pointer (right click). */
export function openContextMenu(e: MouseEvent, items: MenuItem[]) {
  e.preventDefault();
  const host = document.createElement('div');
  document.body.appendChild(host);
  const close = () => { host.remove(); window.removeEventListener('mousedown', down, true); window.removeEventListener('keydown', key, true); };
  const down = (ev: MouseEvent) => { if (!host.contains(ev.target as Node)) close(); };
  const key = (ev: KeyboardEvent) => { if (ev.key === 'Escape') close(); };
  host.className = 'menu';
  host.setAttribute('role', 'menu');
  for (const it of items) {
    if (it.divider) { host.appendChild(document.createElement('hr')); continue; }
    const b = document.createElement('button');
    b.type = 'button'; b.setAttribute('role', 'menuitem'); b.textContent = String(it.label ?? '');
    if (it.danger) b.style.color = 'var(--clay)';
    b.onclick = () => { close(); it.onClick?.(); };
    host.appendChild(b);
  }
  host.style.left = `${Math.min(e.clientX, window.innerWidth - 180)}px`;
  host.style.top = `${Math.min(e.clientY, window.innerHeight - 40 - items.length * 28)}px`;
  window.addEventListener('mousedown', down, true);
  window.addEventListener('keydown', key, true);
}
