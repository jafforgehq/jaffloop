import { useEffect, useState } from 'preact/hooks';
import type { Item, Person } from '../../shared/types';
import { Fmt } from '../core';
import { useFetched } from '../hooks/use-fetched';
import { useItemKeys } from '../hooks/use-item-keys';
import { api, captureForReturning, endOneOnOne, itemsFor, openItems, saveReturning } from '../model';
import { needsConfirm } from '../oneonone-logic';
import { firstName, saidLine, timer } from '../people-logic';
import { Help } from './info';
import { MiniItem } from './interaction-history';
import { ItemList } from './item-row';
import { NotesField } from './notes-field';
import type { HelpId } from '../help';
import { Avatar, EmptySection, GhostButton, KIND_VAR, PrimaryButton, SectionHeader } from './ui';

/** The said log of a person, re-fetched whenever the data changes. */
export const useSaidLog = (personId: string): Item[] => useFetched(() => api.saidLog(personId), [personId]) ?? [];

/** Said-log entries: a quote and when it was said. */
export function SaidRow({ item }: { item: Item }) {
  return (
    <div class="said-row">
      <span class="dot" style={{ background: KIND_VAR.said }} />
      <span class="quote said-quote">{`“${item.quote ?? item.title}”`}</span>
      <span class="dim tnum" style={{ fontSize: 11.5 }}>{Fmt.short(item.createdAt, 'MMM d')}</span>
    </div>
  );
}

/** What a 1:1 in progress holds, kept per person while the app runs so leaving the page and coming back does not lose it. */
interface Draft { notes: string; captured: Item[]; startedAt: number }
const drafts = new Map<string, Draft>();
const DRAFT_TTL = 4 * 3_600_000; // an older draft is a forgotten one: start fresh

/** A calm page for the meeting itself: what to bring up, what is owed both ways, a place to record what was said. */
export function OneOnOne({ person, onEnd }: { person: Person; onEnd: () => void }) {
  const [draft] = useState<Draft>(() => { const d = drafts.get(person.id); return d && Date.now() - d.startedAt < DRAFT_TTL ? d : { notes: '', captured: [], startedAt: Date.now() }; });
  const started = draft.startedAt;
  const [notes, setNotes] = useState(draft.notes);
  const [captured, setCaptured] = useState<Item[]>(draft.captured);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState((Date.now() - started) / 1000);
  const [said, setSaid] = useState('');
  const [quick, setQuick] = useState('');
  drafts.set(person.id, { notes, captured, startedAt: started });
  useEffect(() => {
    const t = setInterval(() => setElapsed((Date.now() - started) / 1000), 1000);
    return () => clearInterval(t);
  }, [started]);

  const first = firstName(person.name);
  const bring = itemsFor(person.id, 'bring');
  const owe = itemsFor(person.id, 'owe');
  const wait = itemsFor(person.id, 'wait');
  useItemKeys([...bring, ...owe, ...wait]);
  const log = useSaidLog(person.id);
  // statuses of the captured items stay live (complete one from its row and the mark follows)
  const live = useFetched(() => Promise.all(captured.map((i) => api.item(i.id))), [captured.map((i) => i.id).join(',')]);
  const shown = captured.map((i) => live?.find((x) => x?.id === i.id) ?? openItems.value.find((x) => x.id === i.id) ?? i);

  const keep = (item: Item | null) => { if (item) setCaptured((c) => (c.some((x) => x.id === item.id) ? c : [...c, item])); };
  const submitSaid = () => {
    const line = saidLine(person.handle, said);
    if (!line) return;
    void saveReturning(line).then(keep);
    setSaid('');
  };
  const submitQuick = () => { const t = quick; if (!t.trim()) return; setQuick(''); void captureForReturning(person, t).then(keep); };
  const finish = async () => {
    if (busy) return;
    setBusy(true);
    await endOneOnOne(person, notes, captured.map((i) => i.id), started);
    drafts.delete(person.id);
    onEnd();
  };
  const cancel = () => {
    if (needsConfirm(notes, captured.length) && !window.confirm(`Discard these notes${captured.length ? ` (the ${captured.length} captured item${captured.length === 1 ? '' : 's'} stay on your lists)` : ''}? The 1:1 will not be logged.`)) return;
    drafts.delete(person.id);
    onEnd();
  };
  const group = (title: string, items: Item[], empty: string, help: HelpId) => items.length === 0
    ? <EmptySection title={title} message={empty} help={help} />
    : <div class="section"><SectionHeader title={title} count={items.length} help={help} /><ItemList items={items} showPerson={false} showKind={false} /></div>;

  return (
    <div class="oneonone">
      <div class="oo-head">
        <Avatar person={person} size={36} />
        <div class="grow">
          <h1 class="title sm" style={{ fontSize: 20 }}>1:1 with {person.name}</h1>
          <div class="dim tnum row-flex" style={{ fontSize: 12, marginTop: 2 }}>{timer(elapsed)}<Help id="oo.timer" size={12} /></div>
        </div>
        <GhostButton onClick={cancel}>Cancel</GhostButton>
        <Help id="oo.cancel" />
        <PrimaryButton onClick={() => { void finish(); }} disabled={busy}>End 1:1 and log it</PrimaryButton>
        <Help id="oo.end" />
      </div>
      <div class="hairline" />
      <div class="oo-body">
        <div class="oo-main">
          {group('Bring up', bring, 'Nothing to bring up.', 'oo.bring')}
          {group(`I owe ${first}`, owe, 'You owe nothing.', 'oo.owe')}
          {group(`${first} owes me`, wait, 'Nothing pending.', 'oo.wait')}
        </div>
        <div class="vline" />
        <div class="oo-side">
          <span class="caps row-flex">Meeting notes<Help id="oo.notes" /></span>
          <textarea class="notes-field oo-notes" value={notes} aria-label="Meeting notes" placeholder={`Saved with this 1:1 when you end it. Jot down what ${first} and you discussed.`}
            onInput={(e) => setNotes((e.target as HTMLTextAreaElement).value)} />
          <span class="caps row-flex" style={{ marginTop: 6 }}>What you said<Help id="oo.said" /></span>
          <input class="input" value={said} placeholder="A promise or a quote, saved word for word" aria-label="What you said"
            onInput={(e) => setSaid((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.isComposing) submitSaid(); }} />
          {log.slice(0, 3).map((i) => <SaidRow key={i.id} item={i} />)}
          <span class="caps row-flex" style={{ marginTop: 6 }}>Capture<Help id="oo.capture" /></span>
          <input class="input" value={quick} placeholder="owe, wait or bring…" aria-label="Capture"
            onInput={(e) => setQuick((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.isComposing) submitQuick(); }} />
          <div class="oo-captured" data-testid="captured">
            <span class="caps row-flex">Captured in this 1:1<Help id="oo.captured" /></span>
            {shown.length === 0 ? <span class="dim" style={{ fontSize: 12 }}>Nothing yet. Items you add here are linked to this 1:1.</span> : shown.map((i) => <MiniItem key={i.id} item={i} showKind />)}
          </div>
          <span class="caps row-flex" style={{ marginTop: 6 }}>Notes about {first}<Help id="oo.aboutPerson" /></span>
          <NotesField key={person.id} person={person} />
        </div>
      </div>
    </div>
  );
}
