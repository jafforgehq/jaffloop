// Done: finished and dropped items, newest first, with Reopen. Ported from Lists.swift DoneView / HistoryRow.
import { useState } from 'preact/hooks';
import type { Item } from '../../shared/types';
import { AllClosed } from '../components/all-closed';
import { Icon } from '../components/icons';
import { Help } from '../components/info';
import { Page } from '../components/page';
import { copyReview, KeptRateLine } from '../components/report-bits';
import { Avatar, GhostButton, KindLabel, QuietButton, Segmented } from '../components/ui';
import { Fmt } from '../core';
import { tip } from '../help';
import { useFetched } from '../hooks/use-fetched';
import { api, drawerItemId, person, reopen } from '../model';
import { EVENT_ICON, EVENT_VERB, reviewWindow } from '../reports-logic';
import { addDays, startOfDay } from '../ui-logic';

const firstName = (n: string) => n.split(/\s+/)[0] ?? n;

export function HistoryRow({ item }: { item: Item }) {
  const done = item.status === 'done';
  const p = person(item.personId);
  return (
    <div class="row history" data-item-id={item.id} onClick={() => { drawerItemId.value = item.id; }}
      onContextMenu={(e) => { e.preventDefault(); }}>
      <span class="dim" style={{ width: 16 }} role="img" aria-label={done ? 'Done' : 'Dropped'}><Icon name={done ? 'circlecheck' : 'circlex'} size={16} /></span>
      <div class="title-cell"><div class="row-title dim" style={{ textDecoration: done ? 'line-through' : 'none', textDecorationColor: 'color-mix(in srgb, var(--text2) 60%, transparent)' }} title={item.title}>{item.title}</div></div>
      <span class="hover-only"><QuietButton title={tip('row.reopen')} onClick={(e) => { e.stopPropagation(); void reopen(item); }}>Reopen</QuietButton></span>
      <span class="c-kind"><KindLabel kind={item.kind} /></span>
      <span class="c-person">{p && <><Avatar person={p} size={16} /><span class="ellipsis">{firstName(p.name)}</span></>}</span>
      <span class="c-date">{done ? 'Done' : 'Dropped'} {Fmt.short(item.updatedAt, 'd MMM')}</span>
    </div>
  );
}

/** "Today in review": every event of today (captured, completed, dropped, snoozed, reopened, edited), newest first. */
function ActivityPanel() {
  const [open, setOpen] = useState(false);
  const entries = useFetched(() => api.activity(startOfDay(Date.now()), 200), []);
  return (
    <div class="section activity" data-testid="activity">
      <div class="sh-wrap">
        <button type="button" class="section-head" aria-expanded={open} aria-controls="activity-list" onClick={() => setOpen(!open)}>
          <span class={`chev ${open ? 'open' : ''}`}><Icon name="chevron" size={10} /></span>
          <span class="caps">Today in review</span>
          {entries && <span class="dim tnum" style={{ fontSize: 11.5 }}>{entries.length}</span>}
          <span class="rule" />
        </button>
        <Help id="done.activity" />
      </div>
      {open && (
        <div id="activity-list" class="timeline" role="list" aria-label="Today in review">
          {entries && entries.length === 0 && <div class="dim" style={{ fontSize: 12.5, padding: '6px 8px' }}>Nothing has happened yet today. Captures, completions and snoozes show up here.</div>}
          {entries?.map((e, i) => {
            const p = person(e.item.personId);
            return (
              <div key={`${e.item.id}:${e.at}:${i}`} class="tl-row" role="listitem">
                <span class="tl-time mono dim">{Fmt.short(e.at, 'HH:mm')}</span>
                <span class="dim" role="img" aria-label={EVENT_VERB[e.event]} title={EVENT_VERB[e.event]}><Icon name={EVENT_ICON[e.event] ?? 'dotted'} size={14} /></span>
                <span class="tl-verb dim">{EVENT_VERB[e.event]}</span>
                <span class="tl-title ellipsis" title={e.item.title}>{e.item.title}</span>
                {p && <span class="tl-person dim row-flex gap6"><Avatar person={p} size={16} /><span class="ellipsis">{p.name}</span></span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function DonePage() {
  const [range, setRange] = useState(7);
  const items = useFetched(() => api.history(range === 0 ? null : addDays(Date.now(), -range), 500), [range]);
  const days = range === 0 ? 365 : range;
  const kept = useFetched(() => api.keptRate(days), [days]);
  const copyWeek = async () => { await copyReview(await api.review(reviewWindow(0, Date.now()).from)); };
  const header = (
    <div style={{ marginTop: 14 }}>
      <div class="row-flex gap10">
        <Segmented<string> label="Range" value={String(range)} onChange={(v) => setRange(Number(v))}
          options={[{ value: '7', label: '7 days' }, { value: '30', label: '30 days' }, { value: '0', label: 'All' }]} />
        <Help id="done.range" />
        <span class="grow" />
        <GhostButton label="Copy week as Markdown" onClick={() => { void copyWeek(); }}><span class="row-flex gap6"><Icon name="copy" size={12} />Copy week as Markdown</span></GhostButton>
        <Help id="done.copy" />
      </div>
      <div class="row-flex" style={{ marginTop: 12 }}><KeptRateLine rate={kept} suffix={`in the last ${days} days`} />{kept && <Help id="done.kept" />}</div>
    </div>
  );
  return (
    <Page title="Done" help="page.done" subtitle={`${items?.length ?? 0} finished or dropped`} header={header}>
      {items && items.length === 0 && <AllClosed title="Nothing here yet" message="Items you complete or drop show up here, so you can find them again and reopen them." showCapture={false} />}
      <div class="rows" style={{ marginTop: 8 }}>{items?.map((i) => <HistoryRow key={i.id} item={i} />)}</div>
      <ActivityPanel />
    </Page>
  );
}
