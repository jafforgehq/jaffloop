import { useEffect, useRef, useState } from 'preact/hooks';
import type { Person } from '../../shared/types';
import { firstName } from '../people-logic';
import { person as findPerson, savePerson } from '../model';

/** Private notes about a person. Saved when the field loses focus or the view goes away. Key it by person id. */
export function NotesField({ person }: { person: Person }) {
  const [text, setText] = useState(person.notes);
  const latest = useRef({ text, id: person.id, saved: person.notes });
  latest.current.text = text;
  latest.current.id = person.id;

  const save = () => {
    const { text: t, id, saved } = latest.current;
    const p = findPerson(id);
    if (!p || t === saved) return;
    latest.current.saved = t;
    void savePerson({ ...p, notes: t });
  };
  useEffect(() => save, []);

  const first = firstName(person.name);
  return (
    <textarea class="notes-field" value={text} rows={3} spellcheck={false} aria-label={`Notes about ${first}`}
      placeholder={`Private notes about ${first}: preferences, goals, what matters to them`}
      onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} onBlur={save} />
  );
}
