import { useEffect, useRef, useState } from 'preact/hooks';
import type { HeatRow, PersonSummary } from '../../shared/types';
import { AllClosed } from '../components/all-closed';
import { Icon } from '../components/icons';
import { Help } from '../components/info';
import { Page } from '../components/page';
import { PersonForm, createFromDraft } from '../components/person-form';
import { CadenceRing, Chip, Dot, GhostButton, PrimaryButton, Segmented } from '../components/ui';
import { Fmt } from '../core';
import { tip } from '../help';
import { useFetched } from '../hooks/use-fetched';
import { addPerson, api, go, openOnboarding, orderedPeople, person, summaries, ui } from '../model';
import { type PersonDraft, emptyDraft, titleLine } from '../onboarding-logic';
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
      <div class="rhythm-head"><span class="caps">Rhythm</span><Help id="people.rhythm" /><span class="dim" style={{ fontSize: 11.5 }}>1:1s per week, last {HEAT_WEEKS} weeks</span></div>
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
    <span class="loadbar" role="img" aria-label={`${owe} owed, ${wait} waiting`} title={tip('people.load')}>
      <span class="loadbar-owe" style={{ width: `${share?.owe ?? 0}%` }} />
      <span class="loadbar-wait" style={{ width: `${share?.wait ?? 0}%` }} />
    </span>
  );
}

/** "Add person…": the wizard's form in a dialog, one person, then it opens their page. */
function AddPersonDialog({ onClose }: { onClose: () => void }) {
  const [draft, setDraft] = useState<PersonDraft>(emptyDraft);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (busy || !draft.name.trim()) return;
    setBusy(true);
    const r = await createFromDraft(draft);
    setBusy(false);
    if ('error' in r) { setError(r.error); return; }
    onClose();
    go(`person:${r.person.id}`);
  };
  const latest = useRef(submit); // the key handler must see the form as it is now
  latest.current = submit;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
      else if (e.key === 'Enter' && e.metaKey && !e.isComposing) { e.preventDefault(); void latest.current(); }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, []);
  return (
    <div class="overlay center" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div class="card ob-card single" role="dialog" aria-label="Add person">
        <div class="ob-main">
          <h2 class="title" style={{ fontSize: 20 }}>Add person</h2>
          <PersonForm draft={draft} onChange={(d) => { setDraft(d); if (error) setError(null); }} error={error} onSubmit={() => void submit()} />
          <div class="row-flex gap8 ob-buttons">
            <span class="grow" />
            <GhostButton onClick={onClose}>Cancel</GhostButton>
            <PrimaryButton onClick={() => void submit()} disabled={busy || !draft.name.trim()}>Add person</PrimaryButton>
          </div>
        </div>
      </div>
    </div>
  );
}

export function PeoplePage() {
  const [name, setName] = useState('');
  const [dialog, setDialog] = useState(false);
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
    <Page title="People" help="page.people" subtitle={`${summaries.value.length} tracked`}>
      <div class="row-flex gap10" style={{ marginTop: 16 }}>
        <input class="input" style={{ width: 220 }} value={name} placeholder="Add a person…" aria-label="Add a person"
          onInput={(e) => setName((e.target as HTMLInputElement).value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.isComposing) void add(); }} />
        <Help id="people.add" />
        <GhostButton onClick={() => void add()}>Add</GhostButton>
        <Help id="people.addBtn" />
        <GhostButton onClick={() => setDialog(true)}>Add person…</GhostButton>
        <Help id="people.addDialog" />
        <span class="grow" />
        <select class="input" style={{ width: 160 }} aria-label="Sort people" value={sort}
          onChange={(e) => void api.setUiState({ peopleSort: (e.target as HTMLSelectElement).value as typeof sort })}>
          <option value="name">Name</option>
          <option value="urgency">Most overdue</option>
          <option value="last">Longest since 1:1</option>
        </select>
        <Help id="people.sort" />
        <Segmented label="Layout" value={layout} onChange={(v) => void api.setUiState({ peopleLayout: v })} options={[
          { value: 'list', aria: 'List', label: <Icon name="list" size={14} /> },
          { value: 'grid', aria: 'Grid', label: <Icon name="grid" size={14} /> },
        ]} />
        <Help id="people.layout" />
      </div>
      <RhythmPanel />
      {summaries.value.length === 0 && (
        <AllClosed title="No one yet" message="Add the people you meet with. Typing @name in a capture adds them too." showCapture={false}>
          <PrimaryButton onClick={openOnboarding}>Add your team</PrimaryButton>
        </AllClosed>
      )}
      {dialog && <AddPersonDialog onClose={() => setDialog(false)} />}
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
        <span class="mono dim ellipsis" style={{ display: 'block' }}>{titleLine(s.person)}</span>
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
          <span class="mono dim ellipsis" style={{ display: 'block' }}>{titleLine(s.person)}</span>
        </span>
        {pinned && <span class="dim" title={tip('people.pinned')}><Icon name="pin" size={11} /></span>}
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
