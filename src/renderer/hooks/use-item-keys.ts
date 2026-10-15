// Keyboard handling shared by every list of items. Ported from Selection.swift ItemKeys:
// j/k or arrows move the selection; Enter completes, s snoozes to tomorrow, e edits the title, space opens the drawer,
// x marks for bulk actions, p pins, Backspace/Delete drops, Esc clears marks, then the drawer, then the selection, ? toggles shortcuts.
import { useEffect, useRef } from 'preact/hooks';
import type { Item } from '../../shared/types';
import {
  completeMany, drawerItemId, dropMany, drop, multi, selectedItemId, showPeoplePalette, showSearch, showShortcuts, showWelcome, snooze, snoozeMany, snoozePresets, toggleDrawer,
  toggleMulti, togglePin, triggerComplete, triggerEdit,
} from '../model';
import { moveSelection, neighbour } from '../ui-logic';

export interface ItemKeysOptions {
  /** Extra single-letter keys for a screen (Inbox triage). Return true when the key was used. */
  triage?: (key: string, item: Item, items: Item[]) => boolean;
}

const TYPING = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';

export function useItemKeys(items: Item[], opts?: ItemKeysOptions) {
  const latest = useRef({ items, opts });
  latest.current = { items, opts };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return;
      const active = document.activeElement as HTMLElement | null;
      if (active?.matches(TYPING)) return;
      // a focused button or an open menu handles Enter/space/arrows itself
      if (document.querySelector('.menu') || (active?.matches('button, a') && (e.key === 'Enter' || e.key === ' '))) return;
      const key = e.key;
      const overlay = showSearch.value || showShortcuts.value || showWelcome.value || showPeoplePalette.value;
      if (overlay && key !== '?') return;

      const { items: list, opts: o } = latest.current;
      const ids = list.map((i) => i.id);
      const sel = selectedItemId.value ? list.find((i) => i.id === selectedItemId.value) : undefined;
      const bulk = [...multi.value].filter((id) => ids.includes(id));
      const handled = () => { e.preventDefault(); };
      const move = (d: number) => { selectedItemId.value = moveSelection(selectedItemId.value, ids, d); };
      const tomorrow = () => snoozePresets().find((p) => p.label.startsWith('Tomorrow'))?.date;

      switch (key) {
        case 'ArrowDown': move(1); return handled();
        case 'ArrowUp': move(-1); return handled();
        case 'Enter':
          if (e.repeat) return;
          if (bulk.length) { void completeMany(bulk); return handled(); }
          if (!sel) return;
          selectedItemId.value = neighbour(sel.id, ids);
          triggerComplete.value = sel.id;
          return handled();
        case ' ':
          if (!sel) return;
          toggleDrawer();
          return handled();
        case 'Backspace':
        case 'Delete':
          if (e.repeat) return;
          if (bulk.length) { void dropMany(bulk); return handled(); }
          if (!sel) return;
          selectedItemId.value = neighbour(sel.id, ids);
          void drop(sel);
          return handled();
        case 'Escape':
          if (multi.value.size) { multi.value = new Set(); return handled(); }
          if (drawerItemId.value) { drawerItemId.value = null; return handled(); }
          if (selectedItemId.value) { selectedItemId.value = null; return handled(); }
          return;
        case '?': showShortcuts.value = !showShortcuts.value; return handled();
      }
      if (e.repeat && key !== 'j' && key !== 'k') return;
      if (sel && o?.triage?.(key, sel, list)) return handled();

      switch (key) {
        case 'j': move(1); break;
        case 'k': move(-1); break;
        case 's': {
          const when = tomorrow();
          if (when == null) return;
          if (bulk.length) void snoozeMany(bulk, when);
          else if (sel) { selectedItemId.value = neighbour(sel.id, ids); void snooze(sel, when); }
          else return;
          break;
        }
        case 'e': if (!sel) return; triggerEdit.value = sel.id; break;
        case 'x': if (!sel) return; toggleMulti(sel.id); break;
        case 'p': if (!sel) return; void togglePin(sel); break;
        default: return;
      }
      handled();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // the selected item left this list (completed, snoozed, filtered away): clear the selection. Not on first mount (reveal sets it first).
  const first = useRef(true);
  const key = items.map((i) => i.id).join(',');
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const s = selectedItemId.peek();
    if (s && !items.some((i) => i.id === s)) selectedItemId.value = null;
  }, [key]);
}
