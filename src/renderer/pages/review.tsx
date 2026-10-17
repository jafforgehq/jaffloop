// Weekly review: what closed, what is overdue, slipping or stale, and who is off cadence. Works for this week and the previous one.
import { useState } from 'preact/hooks';
import type { PersonSummary } from '../../shared/types';
import { AllClosed } from '../components/all-closed';
import { Icon } from '../components/icons';
import { Help } from '../components/info';
import { ItemList } from '../components/item-row';
import { Page, SectionBlock } from '../components/page';
import { copyReview, KeptRateLine } from '../components/report-bits';
import { Avatar, GhostButton, QuietButton, Segmented } from '../components/ui';
import { Fmt } from '../core';
import { type HelpId, tip } from '../help';
import { useFetched } from '../hooks/use-fetched';
import { useItemKeys } from '../hooks/use-item-keys';
import { api, go, isCollapsed, logInteraction } from '../model';
import { daysAgoText, dedupeSections, reviewWindow, weekLabel } from '../reports-logic';
import { HistoryRow } from './done';

function Stat({ label, children, testid, help }: { label: string; children: preact.ComponentChildren; testid?: string; help: HelpId }) {
  return <div class="stat" data-testid={testid}><span class="cap-sm row-flex">{label}<Help id={help} size={12} /></span><div class="tnum" style={{ fontSize: 13 }}>{children}</div></div>;
}

function CadenceRow({ s }: { s: PersonSummary }) {
  return (
    <div class="row offcad" data-person-id={s.person.id}>
      <Avatar person={s.person} size={20} />
      <span>{s.person.name}</span>
      <span class="clay" style={{ fontSize: 12.5 }}>{daysAgoText(s.daysSinceLast)}</span>
      <span class="grow" />
      <QuietButton label={`Open ${s.person.name}`} title={tip('review.open')} onClick={() => go(`person:${s.person.id}`)}>Open</QuietButton>
      <GhostButton label={`Log 1:1 with ${s.person.name}`} title={tip('review.log')} onClick={() => { void logInteraction(s.person); }}>Log 1:1</GhostButton>
    </div>
  );
}

export function ReviewPage() {
  const [offset, setOffset] = useState<0 | -1>(0);
  const now = Date.now();
  const { from, to } = reviewWindow(offset, now);
  const r = useFetched(() => api.review(from, to), [from, to]);
  const secs = r ? dedupeSections(r) : { overdue: [], slipped: [], stale: [] };
  const open = [
    ...(isCollapsed('review.overdue') ? [] : secs.overdue),
    ...(isCollapsed('review.slipped') ? [] : secs.slipped),
    ...(isCollapsed('review.stale') ? [] : secs.stale),
  ];
  useItemKeys(open);

  const attention = secs.overdue.length + secs.slipped.length + secs.stale.length + (r?.offCadence.length ?? 0);
  const header = (
    <div class="review-head">
      <div class="row-flex gap10" style={{ marginTop: 14 }}>
        <Segmented<string> label="Week" value={String(offset)} onChange={(v) => setOffset(v === '0' ? 0 : -1)}
          options={[{ value: '-1', label: 'Previous week', aria: 'Previous week' }, { value: '0', label: 'This week', aria: 'This week' }]} />
        <Help id="review.week" />
        <span class="grow" />
        <GhostButton label="Copy as Markdown" disabled={!r} onClick={() => { if (r) void copyReview(r); }}>
          <span class="row-flex gap6"><Icon name="copy" size={12} />Copy as Markdown</span>
        </GhostButton>
        <Help id="review.copy" />
      </div>
      {r && (
        <div class="review-stats">
          <Stat label="Closed" testid="stat-closed" help="review.closed">{r.closed.length}</Stat>
          <Stat label="Kept on time" help="review.kept"><KeptRateLine rate={r.keptRate} /></Stat>
          <Stat label="Created" testid="stat-created" help="review.created">{r.created.length}</Stat>
          {r.dropped.length > 0 && <Stat label="Dropped" help="review.dropped">{r.dropped.length}</Stat>}
        </div>
      )}
    </div>
  );

  return (
    <Page title="Weekly review" help="page.review" subtitle={weekLabel(offset, now, Fmt.short)} header={header}>
      {r && attention === 0 && (
        <AllClosed title="Nothing needs attention" message="No overdue promises, nothing slipping, no stale waits, and everyone is on cadence." showCapture={false} />
      )}
      {secs.overdue.length > 0 && <SectionBlock id="review.overdue" title="Overdue promises" count={secs.overdue.length} tint="var(--clay)" help="review.overdue"><ItemList items={secs.overdue} /></SectionBlock>}
      {secs.slipped.length > 0 && <SectionBlock id="review.slipped" title="Slipped" count={secs.slipped.length} tint="var(--clay)" help="review.slipped"><ItemList items={secs.slipped} /></SectionBlock>}
      {secs.stale.length > 0 && <SectionBlock id="review.stale" title="Stale waits" count={secs.stale.length} tint="var(--k-wait)" help="review.stale"><ItemList items={secs.stale} /></SectionBlock>}
      {r && r.offCadence.length > 0 && (
        <SectionBlock id="review.cadence" title="People off cadence" count={r.offCadence.length} help="review.cadence">
          {r.offCadence.map((s) => <CadenceRow key={s.person.id} s={s} />)}
        </SectionBlock>
      )}
      {r && r.closed.length > 0 && (
        <SectionBlock id="review.closed" title={offset === 0 ? 'Closed this week' : 'Closed last week'} count={r.closed.length} help="review.closedList">
          <div class="rows">{r.closed.map((i) => <HistoryRow key={i.id} item={i} />)}</div>
        </SectionBlock>
      )}
    </Page>
  );
}
