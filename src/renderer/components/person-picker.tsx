// Pick a person by typing; Enter takes the first match, or creates the typed name as a new handle. Rendered inside a Popover.
import { useEffect, useRef, useState } from 'preact/hooks';
import { summaries } from '../model';
import { Avatar } from './ui';

export function PersonPicker({ onPick }: { onPick: (handle: string) => void }) {
  const [query, setQuery] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  const q = query.trim().toLowerCase();
  const filtered = q ? summaries.value.filter((s) => s.person.name.toLowerCase().includes(q) || s.person.handle.includes(q.replace('@', ''))) : summaries.value;
  const handleFor = (text: string) => text.toLowerCase().replace(/ /g, '.');
  return (
    <div class="picker" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <input ref={input} class="input" placeholder="Person…" aria-label="Person" value={query} onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          const first = filtered[0];
          if (first) onPick(first.person.handle); else if (q) onPick(handleFor(query.trim()));
        }} />
      {filtered.slice(0, 6).map((s) => (
        <button type="button" key={s.person.id} class="navrow" style={{ color: 'var(--text)' }} onClick={() => onPick(s.person.handle)}>
          <Avatar person={s.person} size={18} /><span class="grow">{s.person.name}</span>
        </button>
      ))}
      {filtered.length === 0 && q && <button type="button" class="navrow" style={{ color: 'var(--text)' }} onClick={() => onPick(handleFor(query.trim()))}>Create “{query.trim()}”</button>}
    </div>
  );
}
