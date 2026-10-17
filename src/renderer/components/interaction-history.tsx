// Past 1:1s of a person (notes and the action items recorded in them) and the compact item row they share with 1:1 mode.
import { useState } from 'preact/hooks';
import type { InteractionWithItems, Item, Person } from '../../shared/types';
import { Fmt } from '../core';
import { useFetched } from '../hooks/use-fetched';
import { api, drawerItemId, isCollapsed, selectedItemId, toggleCollapsed } from '../model';
import { agoLabel, statusLabel } from '../oneonone-logic';
import { Icon } from './icons';
import { Help } from './info';
import { Dot, LoopRing } from './ui';

const openDrawer = (id: string) => { selectedItemId.value = id; drawerItemId.value = id; };

/** open ring / done check / dropped x */
export function StatusMark({ status }: { status: Item['status'] }) {
  return (
    <span class="mini-status dim" role="img" aria-label={statusLabel(status)} title={statusLabel(status)}>
      {status === 'open' ? <LoopRing size={13} line={1.4} /> : <Icon name={status === 'done' ? 'circlecheck' : 'circlex'} size={13} />}
    </span>
  );
}

/** One item as a small clickable line: kind (dot, or dot and word), title, source chip, status. Opens the item drawer. */
export function MiniItem({ item, showKind = false }: { item: Item; showKind?: boolean }) {
  return (
    <button type="button" class={`mini-item ${item.status}`} data-item-id={item.id} data-status={item.status} title={item.title} onClick={() => openDrawer(item.id)}>
      {showKind ? <span class="mini-kind row-flex gap6 mono dim"><Dot kind={item.kind} />{item.kind}</span> : <Dot kind={item.kind} />}
      <span class="mini-title ellipsis">{item.title}</span>
      {item.sourceLabel && <span class="chip mini-src" title={item.externalId ? `id: ${item.externalId}` : undefined}>{item.sourceLabel}</span>}
      <StatusMark status={item.status} />
    </button>
  );
}

function Entry({ e }: { e: InteractionWithItems }) {
  const [open, setOpen] = useState(false);
  const at = e.interaction.occurredAt;
  const notes = e.interaction.notes?.trim() ?? '';
  return (
    <div class="hist-entry" data-testid="history-entry">
      <div class="hist-when"><span class="hist-date">{Fmt.short(at, 'EEE d MMM')}</span><span class="dim">{agoLabel(at)}</span></div>
      {notes && (
        <div class={`hist-notes ${open ? 'open' : ''}`} role="button" tabIndex={0} aria-expanded={open} title={open ? 'Click to collapse' : 'Click to expand'}
          onClick={() => setOpen(!open)} onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); setOpen(!open); } }}>{notes}</div>
      )}
      {e.items.length > 0 && <div class="hist-items">{e.items.map((i) => <MiniItem key={i.id} item={i} />)}</div>}
      {!notes && e.items.length === 0 && <div class="dim hist-none">No notes</div>}
    </div>
  );
}

export function InteractionHistory({ person }: { person: Person }) {
  const key = `person.${person.id}.history`;
  const entries = useFetched(() => api.interactionHistory(person.id, 10), [person.id]);
  const open = !isCollapsed(key);
  return (
    <div class="section hist" data-testid="history">
      <div class="sh-wrap">
        <button type="button" class="section-head" aria-expanded={open} aria-controls="history-list" onClick={() => toggleCollapsed(key)}>
          <span class={`chev ${open ? 'open' : ''}`}><Icon name="chevron" size={10} /></span>
          <span class="caps">1:1 history</span>
          {entries && entries.length > 0 && <span class="dim tnum" style={{ fontSize: 11.5 }}>{entries.length}</span>}
          <span class="rule" />
        </button>
        <Help id="person.history" />
      </div>
      {open && entries && (
        <div id="history-list" class="hist-list">
          {entries.length === 0 && <div class="dim" style={{ fontSize: 12.5, padding: '2px 8px' }}>No 1:1s logged yet. Use Start 1:1 to take notes and capture action items.</div>}
          {entries.map((e) => <Entry key={e.interaction.id} e={e} />)}
        </div>
      )}
    </div>
  );
}
