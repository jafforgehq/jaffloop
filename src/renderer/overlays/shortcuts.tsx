import { useEffect, useRef } from 'preact/hooks';
import { Fmt } from '../core';
import { Icon } from '../components/icons';
import { settings, showShortcuts } from '../model';

type Group = [string, Array<[string, string]>];

function groups(hotkey: string): Group[] {
  return [
    ['In lists', [['j  k  ↑  ↓', 'Move the selection'], ['⏎', 'Complete'], ['s', 'Snooze to tomorrow'], ['e', 'Edit the title'],
      ['space', 'Open or close details'], ['x', 'Mark for bulk actions'], ['p', 'Pin or unpin'], ['⌫', 'Drop'], ['esc', 'Clear marks, close details']]],
    ['Inbox triage', [['p', 'Assign a person'], ['d  t  w', 'Due today, tomorrow, next week'], ['x', 'Drop']]],
    ['Anywhere', [[Fmt.hotkeyLabel(hotkey), 'Capture from any app'], ['⌘K', 'Search'], ['⌘P', 'Jump to a person'], ['⌘N', 'New capture'], ['⌘1 – 4', 'Today, Ledger, Inbox, People'],
      ['⌘[  ⌘]', 'Back and forward'], ['⌘\\', 'Hide or show the sidebar'], ['⌘Z', 'Undo while the toast shows'], ['?', 'This sheet']]],
    ['Capture bar', [['⏎', 'Save'], ['⌘⏎', 'Save and keep open'], ['tab', 'Complete an @person'], ['↑', 'Repeat the last capture'], ['esc', 'Cancel']]],
  ];
}

/** Keyboard cheat sheet (press ?). */
export function ShortcutsView() {
  if (!showShortcuts.value) return null;
  return <Sheet />;
}

function Sheet() {
  const card = useRef<HTMLDivElement>(null);
  useEffect(() => { card.current?.focus(); }, []);
  const close = () => { showShortcuts.value = false; };
  const g = groups(settings.value.hotkey);
  const block = ([title, rows]: Group) => (
    <div class="sc-block" key={title}>
      <span class="caps">{title}</span>
      {rows.map(([k, d]) => <div class="sc-row" key={k + d}><span class="sc-key">{k}</span><span class="dim">{d}</span></div>)}
    </div>
  );
  return (
    <div class="overlay center" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div class="card sc-card" ref={card} tabIndex={-1} role="dialog" aria-label="Keyboard shortcuts"
        onKeyDown={(e) => { if (e.key === 'Escape' || e.key === '?') { e.preventDefault(); e.stopPropagation(); close(); } }}>
        <div class="row-flex" style={{ marginBottom: 16 }}>
          <h2 class="title sm grow">Keyboard shortcuts</h2>
          <button type="button" class="btn quiet icon" aria-label="Close" onClick={close}><Icon name="xmark" size={12} /></button>
        </div>
        <div class="sc-cols">
          <div class="sc-col">{block(g[0]!)}{block(g[1]!)}</div>
          <div class="sc-col">{block(g[2]!)}{block(g[3]!)}</div>
        </div>
      </div>
    </div>
  );
}
