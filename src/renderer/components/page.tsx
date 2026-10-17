// Page chrome (scrolling column with serif title) and the collapsible section block.
import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { type HelpId, tip } from '../help';
import { isCollapsed, selectedItemId, toggleCollapsed } from '../model';
import { Icon } from './icons';
import { Help } from './info';

/** `.page > .page-inner`; scrolls the selected row into view whenever the selection changes. */
/** `help` puts an (i) beside the title that says what the screen is for. */
export function Page({ title, subtitle, header, help, children }: { title: string; subtitle?: string; header?: ComponentChildren; help?: HelpId; children?: ComponentChildren }) {
  const ref = useRef<HTMLDivElement>(null);
  const sel = selectedItemId.value;
  useEffect(() => {
    if (!sel || !ref.current) return;
    ref.current.querySelector(`[data-item-id="${CSS.escape(sel)}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [sel]);
  return (
    <div class="page" ref={ref}>
      <div class="page-inner">
        <div class="page-title-row">
          <h1 class="title page-title" title={title} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</h1>
          {help && <Help id={help} size={15} />}
        </div>
        {subtitle != null && <div class="subtitle">{subtitle}</div>}
        {header}
        {children}
      </div>
    </div>
  );
}

/** Section header with a chevron; click to collapse. The state is remembered under `key` (ui.collapsed). */
export function SectionBlock({ id, title, count, tint, help, children }: { id: string; title: string; count: number; tint?: string; help?: HelpId; children?: ComponentChildren }) {
  const collapsed = isCollapsed(id);
  const head = (
    <button type="button" class="section-head" aria-expanded={!collapsed} aria-label={`${title}, ${count} items, ${collapsed ? 'collapsed' : 'expanded'}`} title={tip('section.collapse')} onClick={() => toggleCollapsed(id)}>
      <span class={`chev ${collapsed ? '' : 'open'}`}><Icon name="chevron" size={10} /></span>
      <span class="caps" style={tint ? { color: tint } : undefined}>{title}</span>
      <span class="dim tnum" style={{ fontSize: 11.5 }}>{count}</span>
      <span class="rule" />
    </button>
  );
  return (
    <div class="section" data-section={id}>
      {help ? <div class="sh-wrap">{head}<Help id={help} /></div> : head}
      {!collapsed && children}
    </div>
  );
}
