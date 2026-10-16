// Today: what needs you now, grouped by section, person or kind; Focus shows only the top 3. Ported from MainView.swift TodayView.
import { useEffect, useState } from 'preact/hooks';
import { AllClosed } from '../components/all-closed';
import { Burst } from '../components/burst';
import { DateChips } from '../components/date-chips';
import { Icon } from '../components/icons';
import { ItemList } from '../components/item-row';
import { Page, SectionBlock } from '../components/page';
import { Avatar, Dot, QuietButton, SectionHeader, Segmented } from '../components/ui';
import { Fmt } from '../core';
import type { PersonSummary } from '../../shared/types';
import { ITEM_KINDS } from '../../shared/types';
import type { TodayGroup } from '../../shared/api';
import { useItemKeys } from '../hooks/use-item-keys';
import { api, dismissCheckIn, dismissedCheckIns, drawerItemId, go, isCollapsed, openItems, orderedItems, person, showPeoplePalette, showSearch, showShortcuts, snapshot, todayPersonFilter, ui } from '../model';
import { filterToday, localDay, shouldBurst, urgentCount } from '../speed-logic';
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

/** the urgent count last seen by any Today page this session; null until the first one (so nothing bursts on first load) */
let lastUrgent: number | null = null;
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function TodayPage() {
  const everyone = snapshot.value.today;
  const who = person(todayPersonFilter.value);
  const t = filterToday(everyone, who?.id ?? null);
  const [burst, setBurst] = useState(false);
  const urgent = urgentCount(everyone);
  const group = ui.value.todayGroup;
  const focus = ui.value.todayFocus;
  const checkIns = t.checkIn.filter((s) => !dismissedCheckIns.value.has(s.person.id));
  const blocks = todayBlocks(t, { group, focus, personName: (id) => person(id)?.name, order: orderedItems });
  const visible = blocks.filter((b) => !isCollapsed(`today.${b.id}`)).flatMap((b) => b.items);
  const total = todayTotal(t);
  const snoozed = snapshot.value.snoozedCount;
  useItemKeys(visible);

  useEffect(() => {
    const prev = lastUrgent;
    lastUrgent = urgent;
    const today = localDay(Date.now());
    if (!shouldBurst(prev, urgent, ui.peek().burstDay, today) || reducedMotion()) return;
    setBurst(true);
    void api.setUiState({ burstDay: today });
  }, [urgent]);

  // Esc clears the person filter once nothing else (marks, drawer, selection, overlays) took it
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || !todayPersonFilter.value) return;
      if (showSearch.value || showShortcuts.value || showPeoplePalette.value || drawerItemId.value || document.querySelector('.menu')) return;
      if ((document.activeElement as HTMLElement | null)?.matches('input, textarea, select')) return;
      todayPersonFilter.value = null;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const header = (
    <>
      <KindMix />
      <div class="row-flex gap10" style={{ marginTop: 14 }}>
        <div style={focus ? { opacity: 0.65, pointerEvents: 'none' } : undefined}>
          <Segmented<TodayGroup> label="Group by" value={group} onChange={(v) => { void api.setUiState({ todayGroup: v }); }}
            options={[{ value: 'section', label: 'Sections' }, { value: 'person', label: 'People' }, { value: 'kind', label: 'Kinds' }]} />
        </div>
        <button type="button" class="btn toggle-btn" aria-pressed={focus} title="Show only your top 3" onClick={() => { void api.setUiState({ todayFocus: !focus }); }}>
          <Icon name="scope" size={13} /> Focus
        </button>
      </div>
      {who && (
        <div class="filter-row">
          <span class="chip filter-chip">Showing {who.name.split(/\s+/)[0]}
            <button type="button" aria-label="Show everyone" title="Show everyone  esc" onClick={() => { todayPersonFilter.value = null; }}><Icon name="xmark" size={9} /></button>
          </span>
        </div>
      )}
    </>
  );

  return (
    <Page title="Today" subtitle={Fmt.short(Date.now(), 'EEEE, d MMMM')} header={header}>
      {burst && <Burst onDone={() => setBurst(false)} />}
      {total === 0 && checkIns.length === 0 ? (who
        ? <AllClosed title={`Nothing for ${who.name.split(/\s+/)[0]}`} message="No open items for them need you today." showCapture={false} />
        : <AllClosed />) : (
        <div>
          {blocks.map((b) => (
            <SectionBlock key={b.id} id={`today.${b.id}`} title={b.title} count={b.items.length} tint={b.tint}><ItemList items={b.items} /></SectionBlock>
          ))}
          {focus ? (
            <button type="button" class="link-btn" style={{ marginTop: 8 }} onClick={() => { void api.setUiState({ todayFocus: false }); }}>Show all {total}</button>
          ) : checkIns.length > 0 && (
            <div class="section"><SectionHeader title="Check in" count={checkIns.length} />{checkIns.map((s) => <CheckInRow key={s.person.id} s={s} />)}</div>
          )}
          {!focus && <DateChips />}
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
