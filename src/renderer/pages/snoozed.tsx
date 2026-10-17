// Snoozed: items hidden until later, with Wake now. Ported from Lists.swift SnoozedView / SnoozedRow.
import type { Item } from '../../shared/types';
import { AllClosed } from '../components/all-closed';
import { Icon } from '../components/icons';
import { Page } from '../components/page';
import { Avatar, KindLabel, QuietButton } from '../components/ui';
import { Fmt } from '../core';
import { useFetched } from '../hooks/use-fetched';
import { tip } from '../help';
import { api, drawerItemId, person, wake } from '../model';

const firstName = (n: string) => n.split(/\s+/)[0] ?? n;

function SnoozedRow({ item }: { item: Item }) {
  const p = person(item.personId);
  return (
    <div class="row history" data-item-id={item.id} onClick={() => { drawerItemId.value = item.id; }}>
      <span class="dim" style={{ width: 16 }} aria-hidden="true"><Icon name="moon" size={14} /></span>
      <div class="title-cell"><div class="row-title" title={item.title}>{item.title}</div></div>
      <span class="hover-only"><QuietButton title={tip('row.wake')} onClick={(e) => { e.stopPropagation(); void wake(item); }}>Wake now</QuietButton></span>
      <span class="c-kind"><KindLabel kind={item.kind} /></span>
      <span class="c-person">{p && <><Avatar person={p} size={16} /><span class="ellipsis">{firstName(p.name)}</span></>}</span>
      <span class="c-date" style={{ width: 'calc(var(--col-date) + 10px)' }}>{item.snoozedUntil != null ? `back ${Fmt.short(item.snoozedUntil, 'EEE HH:mm')}` : ''}</span>
    </div>
  );
}

export function SnoozedPage() {
  const items = useFetched(() => api.snoozed());
  return (
    <Page title="Snoozed" help="page.snoozed" subtitle={`${items?.length ?? 0} hidden until later`}>
      {items && items.length === 0 && <AllClosed title="Nothing snoozed" message="Snooze an item with s, or from its menu, and it waits here until the time you chose." showCapture={false} />}
      <div class="rows" style={{ marginTop: 8 }}>{items?.map((i) => <SnoozedRow key={i.id} item={i} />)}</div>
    </Page>
  );
}
