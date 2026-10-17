// The (i) button next to an action or tool: hover or keyboard focus shows what it does. Use it for every control whose effect is not obvious from its label.
// Wording lives in ../help.ts; <Help id="today.focus" /> looks it up. <Info text label /> takes the words directly.
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { HELP, HELP_NAME, type HelpId } from '../help';
import { Icon } from './icons';

const WIDTH = 260;
const GAP = 6;
const MARGIN = 8;
/** Inside these the (i) must not take Tab focus: the j/k lists, rows, menus and the capture field's neighbours keep their own keyboard flow. */
const NO_TAB = '.row, .rows, [role=listbox], [role=menu], .menu, .triage-bar, .cap-card, .pop-list';

/** `text` says what the thing does, in one or two plain sentences. `label` names it for screen readers ("About Accept all"). */
export function Info({ text, label = 'More information', size = 13 }: { text: string; label?: string; size?: number }) {
  const btn = useRef<HTMLButtonElement>(null);
  const tipEl = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);
  const id = useRef(`info-${Math.random().toString(36).slice(2, 9)}`).current;

  const show = () => setOpen(true);
  const hide = () => { setOpen(false); setPos(null); };

  // place the tooltip once it is in the DOM so its real height is known: below the button, above when there is no room, always inside the window
  useLayoutEffect(() => {
    const b = btn.current?.getBoundingClientRect();
    const t = tipEl.current;
    if (!open || !b || !t) return;
    const width = Math.min(WIDTH, window.innerWidth - 2 * MARGIN);
    const h = t.offsetHeight;
    const left = Math.max(MARGIN, Math.min(window.innerWidth - width - MARGIN, b.left + b.width / 2 - width / 2));
    const room = window.innerHeight - b.bottom - GAP - MARGIN;
    const top = room >= h || b.top < h + GAP + MARGIN ? Math.min(b.bottom + GAP, Math.max(MARGIN, window.innerHeight - h - MARGIN)) : b.top - GAP - h;
    setPos((p) => (p && p.left === left && p.top === top && p.width === width ? p : { left, top, width }));
  }, [open, text]);

  useEffect(() => {
    if (!open) return;
    // Escape closes the tip and nothing else (capture phase: it must not also close a drawer or dialog under it)
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); hide(); } };
    const away = () => hide(); // a scroll or resize moves the button from under the tip
    window.addEventListener('keydown', esc, true);
    window.addEventListener('resize', away);
    window.addEventListener('scroll', away, true);
    return () => { window.removeEventListener('keydown', esc, true); window.removeEventListener('resize', away); window.removeEventListener('scroll', away, true); };
  }, [open]);

  // tabindex is set here, not in the markup, because only the DOM position tells whether the button sits in a list or a row
  useLayoutEffect(() => { const b = btn.current; if (b && b.closest(NO_TAB)) b.tabIndex = -1; }, []);

  return (
    <span class="info-wrap">
      <button type="button" ref={btn} class="info-btn" aria-label={label} aria-describedby={open ? id : undefined} data-testid="info"
        // a click must not move focus out of the field or list the person was using
        onMouseDown={(e) => e.preventDefault()}
        onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}
        onClick={(e) => { e.stopPropagation(); open ? hide() : show(); }}>
        <Icon name="info" size={size} />
      </button>
      {open && (
        <span id={id} ref={tipEl} role="tooltip" class="info-tip"
          style={pos ? { left: pos.left, top: pos.top, width: pos.width } : { left: 0, top: 0, visibility: 'hidden' }}>{text}</span>
      )}
    </span>
  );
}

/** An (i) whose wording comes from the HELP registry. */
export function Help({ id, size }: { id: HelpId; size?: number }) {
  return <Info text={HELP[id]!} label={`About ${HELP_NAME[id]}`} size={size} />;
}
