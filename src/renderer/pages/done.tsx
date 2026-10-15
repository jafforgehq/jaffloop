// Done: finished and dropped items, newest first, with Reopen. Ported from Lists.swift DoneView / HistoryRow.
import { useState } from 'preact/hooks';
import type { Item } from '../../shared/types';
import { AllClosed } from '../components/all-closed';
import { Icon } from '../components/icons';
import { Page } from '../components/page';
import { Avatar, KindLabel, QuietButton, Segmented } from '../components/ui';
import { Fmt } from '../core';
import { useFetched } from '../hooks/use-fetched';
import { api, drawerItemId, person, reopen } from '../model';
import { addDays } from '../ui-logic';

const firstName = (n: string) => n.split(/\s+/)[0] ?? n;

export function HistoryRow({ item }: { item: Item }) {
  const done = item.status === 'done';
  const p = person(item.personId);
  return (
    <div class="row history" data-item-id={item.id} onClick={() => { drawerItemId.value = item.id; }}
      onContextMenu={(e) => { e.preventDefault(); }}>
      <span class="dim" style={{ width: 16 }} role="img" aria-label={done ? 'Done' : 'Dropped'}><Icon name={done ? 'circlecheck' : 'circlex'} size={16} /></span>
      <div class="title-cell"><div class="row-title dim" style={{ textDecoration: done ? 'line-through' : 'none', textDecorationColor: 'color-mix(in srgb, var(--text2) 60%, transparent)' }} title={item.title}>{item.title}</div></div>
      <span class="hover-only"><QuietButton onClick={(e) => { e.stopPropagation(); void reopen(item); }}>Reopen</QuietButton></span>
      <span class="c-kind"><KindLabel kind={item.kind} /></span>
      <span class="c-person">{p && <><Avatar person={p} size={16} /><span class="ellipsis">{firstName(p.name)}</span></>}</span>
      <span class="c-date">{done ? 'Done' : 'Dropped'} {Fmt.short(item.updatedAt, 'd MMM')}</span>
    </div>
  );
}

export function DonePage() {
  const [range, setRange] = useState(7);
  const items = useFetched(() => api.history(range === 0 ? null : addDays(Date.now(), -range), 500), [range]);
  const header = (
    <div style={{ marginTop: 14 }}>
      <Segmented<string> label="Range" value={String(range)} onChange={(v) => setRange(Number(v))}
        options={[{ value: '7', label: '7 days' }, { value: '30', label: '30 days' }, { value: '0', label: 'All' }]} />
    </div>
  );
  return (
    <Page title="Done" subtitle={`${items?.length ?? 0} finished or dropped`} header={header}>
      {items && items.length === 0 && <AllClosed title="Nothing here yet" message="Items you complete or drop show up here, so you can find them again and reopen them." showCapture={false} />}
      <div class="rows" style={{ marginTop: 8 }}>{items?.map((i) => <HistoryRow key={i.id} item={i} />)}</div>
    </Page>
  );
}
