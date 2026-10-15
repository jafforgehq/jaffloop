import { useState } from 'preact/hooks';
import type { HeatRow, PersonSummary } from '../../shared/types';
import { AllClosed } from '../components/all-closed';
import { Icon } from '../components/icons';
import { Page } from '../components/page';
import { CadenceRing, Chip, Dot, GhostButton, Segmented } from '../components/ui';
import { Fmt } from '../core';
import { useFetched } from '../hooks/use-fetched';
import { addPerson, api, go, orderedPeople, person, summaries, ui } from '../model';
import { lastOneOnOne, sortPeopleBy } from '../people-logic';
import { heatWeekStarts, loadShares } from '../reports-logic';

const HEAT_WEEKS = 12;

/** Who you met with, week by week: one row per person, twelve squares, oldest to newest. The current week is outlined. */
function RhythmPanel() {
  const rows = useFetched(() => api.heatGrid(HEAT_WEEKS), []);
  if (!rows || rows.length === 0) return null;
  const starts = heatWeekStarts(Date.now(), HEAT_WEEKS);
  const weekText = (ms: number) => `Week of ${Fmt.short(ms, 'd MMM')}`;
  return (
    <section class="rhythm card" aria-label="Rhythm" data-testid="rhythm">
      <div class="rhythm-head"><span class="caps">Rhythm</span><span class="dim" style={{ fontSize: 11.5 }}>1:1s per week, last {HEAT_WEEKS} weeks</span></div>
      {rows.map((r: HeatRow) => {
        const p = person(r.personId);
        if (!p) return null;
        const met = r.weeks.filter(Boolean).length;
        return (
          <div key={r.personId} class="heat-row" data-testid="heat-row">
            <button type="button" class="heat-name ellipsis" onClick={() => go(`person:${r.personId}`)} title={`Open ${p.name}`}>{p.name}</button>
            <span class="heat-cells" role="img" aria-label={`${p.name}: 1:1 in ${met} of the last ${r.weeks.length} weeks`}>
              {r.weeks.map((on, i) => (
                <span key={i} class={`heat-cell ${on ? 'on' : ''} ${i === r.weeks.length - 1 ? 'now' : ''}`}
                  title={`${weekText(starts[i] ?? 0)}${on ? ': 1:1' : ': none'}`} />
              ))}
            </span>
            <span class="mono dim heat-count">{met}/{r.weeks.length}</span>
          </div>
        );
      })}
    </section>
  );
}

/** Open owes (accent) and waits (blue) as one thin bar, scaled by the busiest person. */
function LoadBar({ share, owe, wait }: { share?: { owe: number; wait: number }; owe: number; wait: number }) {
  return (
    <span class="loadbar" role="img" aria-label={`${owe} owed, ${wait} waiting`}>
      <span class="loadbar-owe" style={{ width: `${share?.owe ?? 0}%` }} />
      <span class="loadbar-wait" style={{ width: `${share?.wait ?? 0}%` }} />
    </span>
  );
}

export function PeoplePage() {
  const [name, setName] = useState('');
  const { peopleLayout: layout, peopleSort: sort, pinnedPeople } = ui.value;
  const people = sortPeopleBy(sort, summaries.value, orderedPeople.value);
  const load = loadShares(summaries.value);

  const add = async () => {
    const n = name.trim();
    if (!n) return;
    const p = await addPerson(n);
    if (!p) return;
    setName('');
    go(`person:${p.id}`);
  };

  return (
    <Page title="People" subtitle={`${summaries.value.length} tracked`}>
      <div class="row-flex gap10" style={{ marginTop: 16 }}>
        <input class="input" style={{ width: 220 }} value={name} placeholder="Add a person…" aria-label="Add a person"
          onInput={(e) => setName((e.target as HTMLInputElement).value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.isComposing) void add(); }} />
        <GhostButton onClick={() => void add()}>Add</GhostButton>
        <span class="grow" />
        <select class="input" style={{ width: 160 }} aria-label="Sort people" value={sort}
          onChange={(e) => void api.setUiState({ peopleSort: (e.target as HTMLSelectElement).value as typeof sort })}>
          <option value="name">Name</option>
          <option value="urgency">Most overdue</option>
          <option value="last">Longest since 1:1</option>
        </select>
        <Segmented label="Layout" value={layout} onChange={(v) => void api.setUiState({ peopleLayout: v })} options={[
          { value: 'list', aria: 'List', label: <Icon name="list" size={14} /> },
          { value: 'grid', aria: 'Grid', label: <Icon name="grid" size={14} /> },
        ]} />
      </div>
      <RhythmPanel />
      {summaries.value.length === 0 && <AllClosed title="No one yet" message="Add the people you meet with. Typing @name in a capture adds them too." />}
      {layout === 'grid'
        ? <div class="people-grid">{people.map((s) => <Card key={s.person.id} s={s} pinned={pinnedPeople.includes(s.person.id)} share={load.get(s.person.id)} />)}</div>
        : <div class="people-list">{people.map((s) => <Row key={s.person.id} s={s} share={load.get(s.person.id)} />)}</div>}
    </Page>
  );
}

function Row({ s, share }: { s: PersonSummary; share?: { owe: number; wait: number } }) {
  return (
    <button type="button" class="prow" onClick={() => go(`person:${s.person.id}`)}>
      <CadenceRing person={s.person} daysSince={s.daysSinceLast} overdue={s.cadenceOverdue} size={40} />
      <span class="grow" style={{ textAlign: 'left' }}>
        <span style={{ display: 'block', fontSize: 13.5, fontWeight: 500 }}>{s.person.name}</span>
        <span class="mono dim" style={{ display: 'block' }}>{s.person.relation}</span>
      </span>
      <span class={s.cadenceOverdue ? 'clay' : 'dim'} style={{ fontSize: 12 }}>{lastOneOnOne(s.daysSinceLast)}</span>
      <span class="load-cell">
        <LoadBar share={share} owe={s.openOwe} wait={s.openWait} />
        <span class="mono dim"><span class="load-owe">{s.openOwe}</span> owe · <span class="load-wait">{s.openWait}</span> wait</span>
      </span>
    </button>
  );
}

function Card({ s, pinned, share }: { s: PersonSummary; pinned: boolean; share?: { owe: number; wait: number } }) {
  return (
    <button type="button" class="pcard card" onClick={() => go(`person:${s.person.id}`)}>
      <span class="row-flex gap10" style={{ width: '100%' }}>
        <CadenceRing person={s.person} daysSince={s.daysSinceLast} overdue={s.cadenceOverdue} size={46} />
        <span class="grow" style={{ textAlign: 'left' }}>
          <span style={{ display: 'block', fontSize: 13.5, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.person.name}</span>
          <span class="mono dim" style={{ display: 'block' }}>{s.person.relation}</span>
        </span>
        {pinned && <span class="dim"><Icon name="pin" size={11} /></span>}
      </span>
      <span class={s.cadenceOverdue ? 'clay' : 'dim'} style={{ fontSize: 12 }}>{lastOneOnOne(s.daysSinceLast, true)}</span>
      <LoadBar share={share} owe={s.openOwe} wait={s.openWait} />
      <span class="row-flex gap6">
        <Chip><Dot kind="owe" />{s.openOwe} owe</Chip>
        <Chip><Dot kind="wait" />{s.openWait} wait</Chip>
      </span>
    </button>
  );
}
