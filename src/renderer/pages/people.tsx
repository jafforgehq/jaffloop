import { useState } from 'preact/hooks';
import type { PersonSummary } from '../../shared/types';
import { AllClosed } from '../components/all-closed';
import { Icon } from '../components/icons';
import { Page } from '../components/page';
import { CadenceRing, Chip, Dot, GhostButton, Segmented } from '../components/ui';
import { addPerson, api, go, orderedPeople, summaries, ui } from '../model';
import { lastOneOnOne, sortPeopleBy } from '../people-logic';

export function PeoplePage() {
  const [name, setName] = useState('');
  const { peopleLayout: layout, peopleSort: sort, pinnedPeople } = ui.value;
  const people = sortPeopleBy(sort, summaries.value, orderedPeople.value);

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
      {summaries.value.length === 0 && <AllClosed title="No one yet" message="Add the people you meet with. Typing @name in a capture adds them too." />}
      {layout === 'grid'
        ? <div class="people-grid">{people.map((s) => <Card key={s.person.id} s={s} pinned={pinnedPeople.includes(s.person.id)} />)}</div>
        : <div class="people-list">{people.map((s) => <Row key={s.person.id} s={s} />)}</div>}
    </Page>
  );
}

function Row({ s }: { s: PersonSummary }) {
  return (
    <button type="button" class="prow" onClick={() => go(`person:${s.person.id}`)}>
      <CadenceRing person={s.person} daysSince={s.daysSinceLast} overdue={s.cadenceOverdue} size={40} />
      <span class="grow" style={{ textAlign: 'left' }}>
        <span style={{ display: 'block', fontSize: 13.5, fontWeight: 500 }}>{s.person.name}</span>
        <span class="mono dim" style={{ display: 'block' }}>{s.person.relation}</span>
      </span>
      <span class={s.cadenceOverdue ? 'clay' : 'dim'} style={{ fontSize: 12 }}>{lastOneOnOne(s.daysSinceLast)}</span>
      <span class="mono dim" style={{ width: 100, textAlign: 'right' }}>{s.openOwe} owe · {s.openWait} wait</span>
    </button>
  );
}

function Card({ s, pinned }: { s: PersonSummary; pinned: boolean }) {
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
      <span class="row-flex gap6">
        <Chip><Dot kind="owe" />{s.openOwe} owe</Chip>
        <Chip><Dot kind="wait" />{s.openWait} wait</Chip>
      </span>
    </button>
  );
}
