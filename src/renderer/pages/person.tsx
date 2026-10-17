import { useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import type { Item, Person, PersonSummary, Relation } from '../../shared/types';
import { RELATIONS } from '../../shared/types';
import { CadenceStripView } from '../components/cadence-strip';
import { Icon } from '../components/icons';
import { Help } from '../components/info';
import { InteractionHistory } from '../components/interaction-history';
import { ItemList } from '../components/item-row';
import { NotesField } from '../components/notes-field';
import { OneOnOne, SaidRow, useSaidLog } from '../components/one-on-one';
import { Page } from '../components/page';
import { StreakChip } from '../components/streak';
import { CadenceRing, Chip, EmptySection, GhostButton, MenuButton, Popover, PrimaryButton, SectionHeader } from '../components/ui';
import { type HelpId, tip } from '../help';
import { useItemKeys } from '../hooks/use-item-keys';
import { api, captureFor, itemsFor, logInteraction, pulsePersonId, savePerson, summary } from '../model';
import { titleLine } from '../onboarding-logic';
import { firstName, lastStat } from '../people-logic';
import { birthdayToInput, inputToBirthday, validDateInput } from '../reports-logic';

export function PersonPage({ personId }: { personId: string }) {
  const [oneOnOneId, setOneOnOneId] = useState<string | null>(null); // keyed by person so a page change leaves 1:1 mode
  const s = summary(personId);
  if (!s) return <div class="center-col dim" style={{ height: '100%', justifyContent: 'center', paddingTop: 0 }}>Person not found</div>;
  if (oneOnOneId === personId) return <OneOnOne person={s.person} onEnd={() => setOneOnOneId(null)} />;
  return <PersonBody key={personId} s={s} startOneOnOne={() => setOneOnOneId(personId)} />;
}

function Stat({ label, value, hot, help }: { label: string; value: string; hot?: boolean; help?: HelpId }) {
  return (
    <div class="stat">
      <span class="cap-sm row-flex">{label}{help && <Help id={help} size={12} />}</span>
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

  const section = (title: string, items: Item[], empty: string, help: HelpId) => items.length === 0
    ? <EmptySection title={title} message={empty} help={help} />
    : <div class="section"><SectionHeader title={title} count={items.length} help={help} /><ItemList items={items} showPerson={false} /></div>;
  const header: ComponentChildren = (
    <div class="person-head">
      <CadenceRing person={p} daysSince={s.daysSinceLast} overdue={s.cadenceOverdue} size={60} pulse={pulsePersonId.value === p.id} />
      <div class="grow" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div class="row-flex gap14">
          <Stat label="Last 1:1" value={lastStat(s.daysSinceLast)} hot={s.cadenceOverdue} help="person.lastOneOnOne" />
          <Stat label="Cadence" value={p.cadenceDays != null ? `every ${p.cadenceDays} days` : 'not set'} help="person.cadence" />
          <Stat label="Relation" value={p.relation} help="person.relation" />
        </div>
        <div class="row-flex gap8">
          <PrimaryButton onClick={() => void logInteraction(p)}>Log 1:1</PrimaryButton>
          <Help id="person.log" />
          <GhostButton onClick={startOneOnOne}>Start 1:1</GhostButton>
          <Help id="person.start" />
          <span ref={anchor} style={{ display: 'inline-flex' }}>
            <MenuButton label="Person options" title={tip('person.options')} button={<Icon name="ellipsis" size={14} />} items={[
              { label: 'Start 1:1 mode', hint: tip('person.start'), onClick: startOneOnOne },
              { label: 'Prep brief', hint: tip('person.brief'), onClick: () => void api.openPersonBrief(p.id) },
              { label: 'Edit person…', hint: tip('person.edit'), onClick: () => setEdit(true) },
            ]} />
          </span>
          <Help id="person.options" />
          <Popover anchor={anchor.current} open={edit} onClose={() => setEdit(false)} width={300}>
            <PersonEditor person={p} onDone={() => setEdit(false)} />
          </Popover>
          {p.hiddenFromClaude && <><Chip><Icon name="eyeslash" size={11} />hidden from Claude</Chip><Help id="person.hidden" /></>}
        </div>
        <div class="row-flex gap10" style={{ marginTop: 2, flexWrap: 'wrap' }}><CadenceStripView person={p} /><StreakChip person={p} /></div>
        <div style={{ maxWidth: 520, marginTop: 4 }}>
          <div class="row-flex" style={{ marginBottom: 3 }}><span class="cap-sm">Private notes</span><Help id="person.notes" size={12} /></div>
          <NotesField key={p.id} person={p} />
        </div>
      </div>
    </div>
  );

  return (
    <div class="person-wrap">
      <Page title={p.name} help="page.person" subtitle={p.title.trim() ? titleLine(p) : undefined} header={header}>
        {section('I owe them', owe, 'Nothing promised.', 'person.owe')}
        {section('They owe me', wait, 'Nothing pending.', 'person.wait')}
        {section('Bring up', bring, 'No talking points.', 'person.bring')}
        {said.length === 0
          ? <EmptySection title="Said log" message="Nothing logged yet." help="person.said" />
          : <div class="section"><SectionHeader title="Said log" count={said.length} help="person.said" />{said.slice(0, 12).map((i) => <SaidRow key={i.id} item={i} />)}</div>}
        <InteractionHistory person={p} />
      </Page>
      <div class="quick-add row-flex">
        <div class="quick-field grow">
          <Icon name="plus" size={12} />
          <input value={quick} placeholder={`Add for ${firstName(p.name)} — e.g. owe review RFC fri`} aria-label={`Add for ${firstName(p.name)}`}
            onInput={(e) => setQuick((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.isComposing) { void captureFor(p, quick); setQuick(''); } }} />
        </div>
        <Help id="person.quickAdd" />
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
    void savePerson({ ...draft, name: draft.name.trim(), title: draft.title.trim(), cadenceDays: cadence === 0 ? null : cadence });
    onDone();
  };
  return (
    <div class="person-editor" onKeyDown={(e) => { if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') submit(); }}>
      <div class="with-info">
        <input class="input" value={draft.name} placeholder="Name" aria-label="Name" onInput={(e) => set('name', (e.target as HTMLInputElement).value)} />
        <Help id="person.editName" />
      </div>
      <div class="with-info">
        <input class="input" value={draft.title} placeholder="Position (e.g. Staff engineer)" aria-label="Position" onInput={(e) => set('title', (e.target as HTMLInputElement).value)} />
        <Help id="person.editTitle" />
      </div>
      <div class="form-line">
        <label class="row-flex" for="pe-relation">Relation<Help id="person.editRelation" /></label>
        <select id="pe-relation" aria-label="Relation" class="input" style={{ width: 'auto' }} value={draft.relation} onChange={(e) => set('relation', (e.target as HTMLSelectElement).value as Relation)}>
          {RELATIONS.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>
      <div class="form-line">
        <span class="row-flex">{cadence === 0 ? '1:1 cadence: none' : `1:1 every ${cadence} days`}<Help id="person.editCadence" /></span>
        <span class="row-flex gap6">
          <button type="button" class="btn icon" aria-label="Fewer days" title={tip('person.fewerDays')} disabled={cadence <= 0} onClick={() => step(-1)}>−</button>
          <button type="button" class="btn icon" aria-label="More days" title={tip('person.moreDays')} disabled={cadence >= 90} onClick={() => step(1)}>+</button>
        </span>
      </div>
      <div class="with-info">
        <input class="input" value={draft.matchEmails} placeholder="Emails (comma separated)" aria-label="Emails" onInput={(e) => set('matchEmails', (e.target as HTMLInputElement).value)} />
        <Help id="person.editEmails" />
      </div>
      <div class="form-line">
        <label class="row-flex" for="pe-start">Start date<Help id="person.editStart" /></label>
        <span class="row-flex gap6">
          <input id="pe-start" type="date" class="input date-input" aria-label="Start date" value={draft.startDate ?? ''}
            onInput={(e) => set('startDate', validDateInput((e.target as HTMLInputElement).value))} />
           <button type="button" class="btn quiet icon" aria-label="Clear start date" title={tip('person.clear')} disabled={!draft.startDate} onClick={() => set('startDate', null)}><Icon name="xmark" size={11} /></button>
        </span>
      </div>
      <div class="form-line">
        <label class="row-flex" for="pe-birthday">Birthday<Help id="person.editBirthday" /></label>
        <span class="row-flex gap6">
          <input id="pe-birthday" type="date" class="input date-input" aria-label="Birthday (year is ignored)" title="Only the month and day are kept" value={birthdayToInput(draft.birthday)}
            onInput={(e) => set('birthday', inputToBirthday((e.target as HTMLInputElement).value))} />
           <button type="button" class="btn quiet icon" aria-label="Clear birthday" title={tip('person.clear')} disabled={!draft.birthday} onClick={() => set('birthday', null)}><Icon name="xmark" size={11} /></button>
        </span>
      </div>
      <div class="row-flex"><label class="toggle"><input type="checkbox" checked={draft.hiddenFromClaude} onChange={(e) => set('hiddenFromClaude', (e.target as HTMLInputElement).checked)} />Hide from Claude (MCP)</label><Help id="person.editHide" /></div>
      <div class="row-flex"><label class="toggle"><input type="checkbox" checked={draft.archived} onChange={(e) => set('archived', (e.target as HTMLInputElement).checked)} />Archived</label><Help id="person.editArchived" /></div>
      <div class="row-flex" style={{ justifyContent: 'flex-end' }}><PrimaryButton onClick={submit} disabled={!draft.name.trim()}>Save</PrimaryButton></div>
    </div>
  );
}

