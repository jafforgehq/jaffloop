import { useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import type { Item, Person, PersonSummary, Relation } from '../../shared/types';
import { RELATIONS } from '../../shared/types';
import { CadenceStripView } from '../components/cadence-strip';
import { Icon } from '../components/icons';
import { ItemList } from '../components/item-row';
import { NotesField } from '../components/notes-field';
import { OneOnOne, SaidRow, useSaidLog } from '../components/one-on-one';
import { Page } from '../components/page';
import { StreakChip } from '../components/streak';
import { CadenceRing, Chip, EmptySection, GhostButton, MenuButton, Popover, PrimaryButton, SectionHeader } from '../components/ui';
import { useItemKeys } from '../hooks/use-item-keys';
import { api, captureFor, itemsFor, logInteraction, pulsePersonId, savePerson, summary } from '../model';
import { firstName, lastStat } from '../people-logic';
import { birthdayToInput, inputToBirthday, validDateInput } from '../reports-logic';

export function PersonPage({ personId }: { personId: string }) {
  const [oneOnOneId, setOneOnOneId] = useState<string | null>(null); // keyed by person so a page change leaves 1:1 mode
  const s = summary(personId);
  if (!s) return <div class="center-col dim" style={{ height: '100%', justifyContent: 'center', paddingTop: 0 }}>Person not found</div>;
  if (oneOnOneId === personId) return <OneOnOne person={s.person} onEnd={() => setOneOnOneId(null)} />;
  return <PersonBody key={personId} s={s} startOneOnOne={() => setOneOnOneId(personId)} />;
}

function Stat({ label, value, hot }: { label: string; value: string; hot?: boolean }) {
  return (
    <div class="stat">
      <span class="cap-sm">{label}</span>
      <span class={`tnum ${hot ? 'clay' : ''}`} style={{ fontSize: 13 }}>{value}</span>
    </div>
  );
}

function PersonBody({ s, startOneOnOne }: { s: PersonSummary; startOneOnOne: () => void }) {
  const p = s.person;
  const [edit, setEdit] = useState(false);
  const [quick, setQuick] = useState('');
  const anchor = useRef<HTMLSpanElement>(null);
  const owe = itemsFor(p.id, 'owe'), wait = itemsFor(p.id, 'wait'), bring = itemsFor(p.id, 'bring');
  useItemKeys([...owe, ...wait, ...bring]);
  const said = useSaidLog(p.id);

  const section = (title: string, items: Item[], empty: string) => items.length === 0
    ? <EmptySection title={title} message={empty} />
    : <div class="section"><SectionHeader title={title} count={items.length} /><ItemList items={items} showPerson={false} /></div>;
  const header: ComponentChildren = (
    <div class="person-head">
      <CadenceRing person={p} daysSince={s.daysSinceLast} overdue={s.cadenceOverdue} size={60} pulse={pulsePersonId.value === p.id} />
      <div class="grow" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div class="row-flex gap14">
          <Stat label="Last 1:1" value={lastStat(s.daysSinceLast)} hot={s.cadenceOverdue} />
          <Stat label="Cadence" value={p.cadenceDays != null ? `every ${p.cadenceDays} days` : 'not set'} />
          <Stat label="Relation" value={p.relation} />
        </div>
        <div class="row-flex gap8">
          <PrimaryButton onClick={() => void logInteraction(p)}>Log 1:1</PrimaryButton>
          <GhostButton onClick={startOneOnOne}>Start 1:1</GhostButton>
          <span ref={anchor} style={{ display: 'inline-flex' }}>
            <MenuButton label="Person options" button={<Icon name="ellipsis" size={14} />} items={[
              { label: 'Start 1:1 mode', onClick: startOneOnOne },
              { label: 'Prep brief', onClick: () => void api.openPersonBrief(p.id) },
              { label: 'Edit person…', onClick: () => setEdit(true) },
            ]} />
          </span>
          <Popover anchor={anchor.current} open={edit} onClose={() => setEdit(false)} width={300}>
            <PersonEditor person={p} onDone={() => setEdit(false)} />
          </Popover>
          {p.hiddenFromClaude && <Chip><Icon name="eyeslash" size={11} />hidden from Claude</Chip>}
        </div>
        <div class="row-flex gap10" style={{ marginTop: 2, flexWrap: 'wrap' }}><CadenceStripView person={p} /><StreakChip person={p} /></div>
        <div style={{ maxWidth: 520, marginTop: 4 }}><NotesField key={p.id} person={p} /></div>
      </div>
    </div>
  );

  return (
    <div class="person-wrap">
      <Page title={p.name} header={header}>
        {section('I owe them', owe, 'Nothing promised.')}
        {section('They owe me', wait, 'Nothing pending.')}
        {section('Bring up', bring, 'No talking points.')}
        {said.length === 0
          ? <EmptySection title="Said log" message="Nothing logged yet." />
          : <div class="section"><SectionHeader title="Said log" count={said.length} />{said.slice(0, 12).map((i) => <SaidRow key={i.id} item={i} />)}</div>}
      </Page>
      <div class="quick-add">
        <div class="quick-field">
          <Icon name="plus" size={12} />
          <input value={quick} placeholder={`Add for ${firstName(p.name)} — e.g. owe review RFC fri`} aria-label={`Add for ${firstName(p.name)}`}
            onInput={(e) => setQuick((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.isComposing) { void captureFor(p, quick); setQuick(''); } }} />
        </div>
      </div>
    </div>
  );
}

function PersonEditor({ person, onDone }: { person: Person; onDone: () => void }) {
  const [draft, setDraft] = useState<Person>(person);
  const [cadence, setCadence] = useState(person.cadenceDays ?? 0);
  const set = <K extends keyof Person>(k: K, v: Person[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const step = (d: number) => setCadence((c) => Math.min(90, Math.max(0, c + d)));
  const submit = () => {
    if (!draft.name.trim()) return;
    void savePerson({ ...draft, name: draft.name.trim(), cadenceDays: cadence === 0 ? null : cadence });
    onDone();
  };
  return (
    <div class="person-editor" onKeyDown={(e) => { if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') submit(); }}>
      <input class="input" value={draft.name} placeholder="Name" aria-label="Name" onInput={(e) => set('name', (e.target as HTMLInputElement).value)} />
      <label class="form-line">Relation
        <select class="input" style={{ width: 'auto' }} value={draft.relation} onChange={(e) => set('relation', (e.target as HTMLSelectElement).value as Relation)}>
          {RELATIONS.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </label>
      <div class="form-line">
        <span>{cadence === 0 ? '1:1 cadence: none' : `1:1 every ${cadence} days`}</span>
        <span class="row-flex gap6">
          <button type="button" class="btn icon" aria-label="Fewer days" disabled={cadence <= 0} onClick={() => step(-1)}>−</button>
          <button type="button" class="btn icon" aria-label="More days" disabled={cadence >= 90} onClick={() => step(1)}>+</button>
        </span>
      </div>
      <input class="input" value={draft.matchEmails} placeholder="Emails (comma separated)" aria-label="Emails" onInput={(e) => set('matchEmails', (e.target as HTMLInputElement).value)} />
      <div class="form-line">
        <label for="pe-start">Start date</label>
        <span class="row-flex gap6">
          <input id="pe-start" type="date" class="input date-input" aria-label="Start date" value={draft.startDate ?? ''}
            onInput={(e) => set('startDate', validDateInput((e.target as HTMLInputElement).value))} />
          <button type="button" class="btn quiet icon" aria-label="Clear start date" title="Clear" disabled={!draft.startDate} onClick={() => set('startDate', null)}><Icon name="xmark" size={11} /></button>
        </span>
      </div>
      <div class="form-line">
        <label for="pe-birthday">Birthday</label>
        <span class="row-flex gap6">
          <input id="pe-birthday" type="date" class="input date-input" aria-label="Birthday (year is ignored)" title="Only the month and day are kept" value={birthdayToInput(draft.birthday)}
            onInput={(e) => set('birthday', inputToBirthday((e.target as HTMLInputElement).value))} />
          <button type="button" class="btn quiet icon" aria-label="Clear birthday" title="Clear" disabled={!draft.birthday} onClick={() => set('birthday', null)}><Icon name="xmark" size={11} /></button>
        </span>
      </div>
      <label class="toggle"><input type="checkbox" checked={draft.hiddenFromClaude} onChange={(e) => set('hiddenFromClaude', (e.target as HTMLInputElement).checked)} />Hide from Claude (MCP)</label>
      <label class="toggle"><input type="checkbox" checked={draft.archived} onChange={(e) => set('archived', (e.target as HTMLInputElement).checked)} />Archived</label>
      <div class="row-flex" style={{ justifyContent: 'flex-end' }}><PrimaryButton onClick={submit} disabled={!draft.name.trim()}>Save</PrimaryButton></div>
    </div>
  );
}

