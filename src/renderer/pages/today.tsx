// Today: what needs you now, grouped by section, person or kind; Focus shows only the top 3. Ported from MainView.swift TodayView.
import { AllClosed } from '../components/all-closed';
import { Icon } from '../components/icons';
import { ItemList } from '../components/item-row';
import { Page, SectionBlock } from '../components/page';
import { Avatar, Dot, QuietButton, SectionHeader, Segmented } from '../components/ui';
import { Fmt } from '../core';
import type { PersonSummary } from '../../shared/types';
import { ITEM_KINDS } from '../../shared/types';
import type { TodayGroup } from '../../shared/api';
import { useItemKeys } from '../hooks/use-item-keys';
import { api, dismissCheckIn, dismissedCheckIns, go, isCollapsed, openItems, orderedItems, person, snapshot, ui } from '../model';
import { todayBlocks, todayTotal } from '../ui-logic';

function KindMix() {
  const total = todayTotal(snapshot.value.today);
  const counts = ITEM_KINDS.map((k) => [k, openItems.value.filter((i) => i.kind === k).length] as const).filter(([, c]) => c > 0);
  if (!counts.length) return <div style={{ height: 16 }} />;
  return (
    <div class="kindmix">
      <div class="mono" style={{ color: 'var(--text)' }}>{openItems.value.length} open · {total} need you today</div>
      <div class="kindbar" aria-hidden="true">
        {counts.map(([k, c]) => <span key={k} style={{ flex: `${c} 1 0`, background: `var(--k-${k})`, opacity: 0.85 }} />)}
      </div>
      <div class="row-flex gap14" role="group" aria-label="Open items by kind">
        {counts.map(([k, c]) => <span key={k} class="row-flex gap6 mono dim"><Dot kind={k} />{c} {k}</span>)}
      </div>
    </div>
  );
}

function CheckInRow({ s }: { s: PersonSummary }) {
  return (
    <div class="row checkin">
      <Avatar person={s.person} size={20} />
      <span>{s.person.name}</span>
      <span class="clay" style={{ fontSize: 12.5 }}>{s.daysSinceLast ?? 0} days since your last 1:1</span>
      <span class="grow" />
      <QuietButton onClick={() => go(`person:${s.person.id}`)}>Schedule</QuietButton>
      <QuietButton onClick={() => dismissCheckIn(s.person.id)}>Dismiss</QuietButton>
    </div>
  );
}

export function TodayPage() {
  const t = snapshot.value.today;
  const group = ui.value.todayGroup;
  const focus = ui.value.todayFocus;
  const checkIns = t.checkIn.filter((s) => !dismissedCheckIns.value.has(s.person.id));
  const blocks = todayBlocks(t, { group, focus, personName: (id) => person(id)?.name, order: orderedItems });
  const visible = blocks.filter((b) => !isCollapsed(`today.${b.id}`)).flatMap((b) => b.items);
  const total = todayTotal(t);
  const snoozed = snapshot.value.snoozedCount;
  useItemKeys(visible);

  const header = (
    <>
      <KindMix />
      <div class="row-flex gap10" style={{ marginTop: 14 }}>
        <div style={focus ? { opacity: 0.5, pointerEvents: 'none' } : undefined}>
          <Segmented<TodayGroup> label="Group by" value={group} onChange={(v) => { void api.setUiState({ todayGroup: v }); }}
            options={[{ value: 'section', label: 'Sections' }, { value: 'person', label: 'People' }, { value: 'kind', label: 'Kinds' }]} />
        </div>
        <button type="button" class="btn toggle-btn" aria-pressed={focus} title="Show only your top 3" onClick={() => { void api.setUiState({ todayFocus: !focus }); }}>
          <Icon name="scope" size={13} /> Focus
        </button>
      </div>
    </>
  );

  return (
    <Page title="Today" subtitle={Fmt.short(Date.now(), 'EEEE, d MMMM')} header={header}>
      {total === 0 && checkIns.length === 0 ? <AllClosed /> : (
        <div>
          {blocks.map((b) => (
            <SectionBlock key={b.id} id={`today.${b.id}`} title={b.title} count={b.items.length} tint={b.tint}><ItemList items={b.items} /></SectionBlock>
          ))}
          {focus ? (
            <button type="button" class="link-btn" style={{ marginTop: 8 }} onClick={() => { void api.setUiState({ todayFocus: false }); }}>Show all {total}</button>
          ) : checkIns.length > 0 && (
            <div class="section"><SectionHeader title="Check in" count={checkIns.length} />{checkIns.map((s) => <CheckInRow key={s.person.id} s={s} />)}</div>
          )}
          {snoozed > 0 && (
            <button type="button" class="link-btn dim" style={{ marginTop: 14 }} onClick={() => go('snoozed')}>
              <Icon name="moon" size={12} /> {snoozed} snoozed
            </button>
          )}
        </div>
      )}
    </Page>
  );
}
