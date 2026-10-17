import { useEffect, useRef, useState } from 'preact/hooks';
import type { Item } from '../../shared/types';
import { Fmt } from '../core';
import { Icon } from '../components/icons';
import { Help } from '../components/info';
import { Kbd, LoopRing } from '../components/ui';
import { tip } from '../help';
import { addFilter, api, go, person, reveal, showSearch, showShortcuts, summaries } from '../model';
import { firstName, highlightParts } from '../people-logic';

interface Row { id: string; icon: string; title: string; detail: string; terms?: string[]; run: () => void }

const MAX_ROWS = 9;

/** ⌘K palette: actions, people and items, with the typed words underlined in item titles. */
export function SearchPalette() {
  if (!showSearch.value) return null;
  return <Palette />;
}

function Palette() {
  const [query, setQuery] = useState('');
  const [sel, setSel] = useState(0);
  const [found, setFound] = useState<{ q: string; items: Item[] }>({ q: '', items: [] });
  const input = useRef<HTMLInputElement>(null);
  const q = query.trim();
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => {
    if (!q) return;
    let live = true;
    void api.search(q, 12).then((items) => { if (live) setFound({ q, items }); }).catch(() => { if (live) setFound({ q, items: [] }); });
    return () => { live = false; };
  }, [q]);

  const close = () => { showSearch.value = false; };
  const nav = (n: string) => () => { close(); go(n); };
  const actions: Row[] = [
    { id: 'a-today', icon: 'dotted', title: 'Go to Today', detail: 'action', run: nav('today') },
    { id: 'a-ledger', icon: 'scroll', title: 'Go to Promise ledger', detail: 'action', run: nav('ledger') },
    { id: 'a-inbox', icon: 'tray', title: 'Go to Inbox', detail: 'action', run: nav('inbox') },
    { id: 'a-people', icon: 'person2', title: 'Go to People', detail: 'action', run: nav('people') },
    { id: 'a-snoozed', icon: 'moon', title: 'Go to Snoozed', detail: 'action', run: nav('snoozed') },
    { id: 'a-done', icon: 'circlecheck', title: 'Go to Done', detail: 'action', run: nav('done') },
    { id: 'a-capture', icon: 'plus', title: 'New capture', detail: 'action', run: () => { close(); void api.openCapture(); } },
    { id: 'a-keys', icon: 'keyboard', title: 'Keyboard shortcuts', detail: '?', run: () => { close(); showShortcuts.value = true; } },
    { id: 'a-settings', icon: 'gear', title: 'Open Settings', detail: 'action', run: () => { close(); void api.openSettings(); } },
  ];
  let rows: Row[] = actions;
  if (q) {
    const lq = q.toLowerCase();
    const handleQ = lq.replace(/@/g, '');
    const terms = Fmt.queryWords(q);
    // results of an older query are not shown for the new one
    const items = found.q === q ? found.items : [];
    rows = [
      { id: 'save', icon: 'bookmark', title: 'Save this search as a filter', detail: 'sidebar', run: () => { close(); addFilter(q); } },
      ...actions.filter((a) => a.title.toLowerCase().includes(lq)),
      ...summaries.value.filter((s) => s.person.name.toLowerCase().includes(lq) || s.person.handle.includes(handleQ))
        .map((s): Row => ({ id: `p-${s.person.id}`, icon: 'person2', title: s.person.name, detail: s.person.relation, run: nav(`person:${s.person.id}`) })),
      ...items.map((i): Row => {
        const who = person(i.personId)?.name;
        return { id: `i-${i.id}`, icon: 'item', title: i.title, terms, run: () => { close(); reveal(i); },
          detail: `${i.kind}${who ? ` · ${firstName(who)}` : ''}${i.status === 'open' ? '' : ` · ${i.status}`}` };
      }),
    ];
  }
  const shown = rows.slice(0, MAX_ROWS);
  const at = Math.min(sel, Math.max(0, shown.length - 1));

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel(Math.min(at + 1, shown.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(Math.max(at - 1, 0)); }
    else if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); shown[at]?.run(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else return;
    e.stopPropagation();
  };

  return (
    <div class="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div class="card palette" role="dialog" aria-label="Search" onKeyDown={onKey}>
        <div class="row-flex gap10" style={{ padding: 14 }}>
          <span class="dim"><Icon name="search" size={15} /></span>
          <input ref={input} class="palette-input" value={query} spellcheck={false} aria-label="Search"
            placeholder="Search items, people, actions…  @person  kind:owe  before:2026-11-01"
            onInput={(e) => { setQuery((e.target as HTMLInputElement).value); setSel(0); }} />
          <Help id="search.input" />
          <Kbd>esc</Kbd>
        </div>
        <div class="hairline" />
        <div style={{ padding: 6 }} role="listbox">
          {shown.map((r, idx) => (
            <div key={r.id} role="option" aria-selected={idx === at} title={r.id === 'save' ? tip('search.save') : undefined} class={`palette-row ${idx === at ? 'on' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={r.run}>
              <span class="dim" style={{ width: 18, display: 'inline-flex', justifyContent: 'center' }}>{r.icon === 'item' ? <LoopRing size={11} line={1.2} /> : <Icon name={r.icon} size={12} />}</span>
              <span class="grow palette-title">{r.terms?.length ? highlightParts(r.title, r.terms).map((p, i) => p.hit ? <mark key={i}>{p.text}</mark> : p.text) : r.title}</span>
              <span class="mono dim">{r.detail}</span>
            </div>
          ))}
          {shown.length === 0 && <div class="dim" style={{ fontSize: 12.5, padding: 18 }}>No results</div>}
        </div>
      </div>
    </div>
  );
}
