// ⌘P: jump to a person. Type to filter, arrows and Enter to go, Esc to close.
import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from '../components/icons';
import { Help } from '../components/info';
import { Avatar, Kbd } from '../components/ui';
import { go, recentPeople, showPeoplePalette, summaries } from '../model';
import { lastOneOnOne, matchPeople } from '../speed-logic';

export function PeoplePalette() {
  if (!showPeoplePalette.value) return null;
  return <Palette />;
}

function Palette() {
  const [query, setQuery] = useState('');
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  // Esc closes even when focus is not inside the dialog
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); showPeoplePalette.value = false; } };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, []);
  const rows = matchPeople(summaries.value, recentPeople.value, query);
  const at = Math.min(sel, Math.max(0, rows.length - 1));
  const close = () => { showPeoplePalette.value = false; };
  const open = (id: string) => { close(); go(`person:${id}`); };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel(Math.min(at + 1, rows.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(Math.max(at - 1, 0)); }
    else if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); if (rows[at]) open(rows[at]!.person.id); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
    else return;
    e.stopPropagation();
  };

  return (
    <div class="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div class="card palette" role="dialog" aria-label="Jump to a person" onKeyDown={onKey}>
        <div class="row-flex gap10" style={{ padding: 14 }}>
          <span class="dim"><Icon name="person2" size={15} /></span>
          <input ref={input} class="palette-input" value={query} spellcheck={false} aria-label="Person" placeholder="Jump to a person…"
            onInput={(e) => { setQuery((e.target as HTMLInputElement).value); setSel(0); }} />
          <Help id="people.palette" />
          <Kbd>esc</Kbd>
        </div>
        <div class="hairline" />
        <div style={{ padding: 6, maxHeight: 360, overflowY: 'auto' }} role="listbox">
          {rows.map((s, idx) => (
            <div key={s.person.id} role="option" aria-selected={idx === at} class={`palette-row people-row ${idx === at ? 'on' : ''}`}
              onMouseDown={(e) => e.preventDefault()} onMouseMove={() => setSel(idx)} onClick={() => open(s.person.id)}>
              <Avatar person={s.person} size={20} />
              <span class="grow palette-title">{s.person.name}{s.person.title && <span class="dim" style={{ fontSize: 11.5, marginLeft: 8 }}>{s.person.title}</span>}</span>
              <span class="mono dim" style={{ fontSize: 11.5 }}>{lastOneOnOne(s.daysSinceLast)}</span>
              <span class={`mono ${s.openOwe + s.openWait ? '' : 'dim'}`} style={{ fontSize: 11.5, minWidth: 92, textAlign: 'right' }}>{s.openOwe} owe · {s.openWait} wait</span>
            </div>
          ))}
          {rows.length === 0 && <div class="dim" style={{ fontSize: 12.5, padding: 18 }}>No one matches</div>}
        </div>
      </div>
    </div>
  );
}
