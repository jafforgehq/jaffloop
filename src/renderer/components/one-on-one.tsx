import { useEffect, useState } from 'preact/hooks';
import type { Item, Person } from '../../shared/types';
import { Fmt } from '../core';
import { useFetched } from '../hooks/use-fetched';
import { useItemKeys } from '../hooks/use-item-keys';
import { api, captureFor, itemsFor, logInteraction, save } from '../model';
import { firstName, saidLine, timer } from '../people-logic';
import { ItemList } from './item-row';
import { NotesField } from './notes-field';
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

/** A calm page for the meeting itself: what to bring up, what is owed both ways, a place to record what was said. */
export function OneOnOne({ person, onEnd }: { person: Person; onEnd: () => void }) {
  const [started] = useState(() => Date.now());
  const [elapsed, setElapsed] = useState(0);
  const [said, setSaid] = useState('');
  const [quick, setQuick] = useState('');
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

  const submitSaid = () => {
    const line = saidLine(person.handle, said);
    if (!line) return;
    void save(line);
    setSaid('');
  };
  const group = (title: string, items: Item[], empty: string) => items.length === 0
    ? <EmptySection title={title} message={empty} />
    : <div class="section"><SectionHeader title={title} count={items.length} /><ItemList items={items} showPerson={false} showKind={false} /></div>;

  return (
    <div class="oneonone">
      <div class="oo-head">
        <Avatar person={person} size={36} />
        <div class="grow">
          <h1 class="title sm" style={{ fontSize: 20 }}>1:1 with {person.name}</h1>
          <div class="dim tnum" style={{ fontSize: 12, marginTop: 2 }}>{timer(elapsed)}</div>
        </div>
        <GhostButton onClick={onEnd}>Cancel</GhostButton>
        <PrimaryButton onClick={() => { void logInteraction(person); onEnd(); }}>End 1:1 and log it</PrimaryButton>
      </div>
      <div class="hairline" />
      <div class="oo-body">
        <div class="oo-main">
          {group('Bring up', bring, 'Nothing to bring up.')}
          {group(`I owe ${first}`, owe, 'You owe nothing.')}
          {group(`${first} owes me`, wait, 'Nothing pending.')}
        </div>
        <div class="vline" />
        <div class="oo-side">
          <span class="caps">What you said</span>
          <input class="input" value={said} placeholder="A promise or a quote, saved word for word" aria-label="What you said"
            onInput={(e) => setSaid((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.isComposing) submitSaid(); }} />
          {log.slice(0, 3).map((i) => <SaidRow key={i.id} item={i} />)}
          <span class="caps" style={{ marginTop: 6 }}>Capture</span>
          <input class="input" value={quick} placeholder="owe, wait or bring…" aria-label="Capture"
            onInput={(e) => setQuick((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.isComposing) { void captureFor(person, quick); setQuick(''); } }} />
          <span class="caps" style={{ marginTop: 6 }}>Notes</span>
          <NotesField key={person.id} person={person} />
        </div>
      </div>
    </div>
  );
}
