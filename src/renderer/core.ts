// Facade over the pure core logic. The renderer imports pure logic ONLY from here (never from src/core directly), so the shape
// documented in docs/ELECTRON.md stays stable even when the core is reorganised.
import type { Item, ParsedCapture, PersonSummary, Settings } from '../shared/types';
import * as P from '../core/pure';

const MOD_SYMBOLS: Record<string, string> = {
  alt: '⌥', option: '⌥', command: '⌘', cmd: '⌘', commandorcontrol: '⌘', cmdorctrl: '⌘', super: '⌘', meta: '⌘', control: '⌃', ctrl: '⌃', shift: '⇧',
};

export const Fmt = {
  isOverdue: (i: Pick<Item, 'status' | 'dueAt' | 'dueHasTime'>, now: number = Date.now()): boolean => P.isOverdue(i, now),
  isSlipping: (i: Pick<Item, 'status' | 'snoozeCount'>): boolean => P.isSlipping(i),
  isStaleWait: (i: Item, now: number | undefined, s: Settings): boolean => P.isStaleWait(i, now ?? Date.now(), s),
  due: (i: Pick<Item, 'dueAt' | 'dueHasTime'>, now: number = Date.now()): string | null => P.fmtDue(i, now),
  exact: (i: Pick<Item, 'dueAt' | 'dueHasTime'>): string | null => P.fmtExact(i),
  short: (ms: number, pattern: string): string => P.fmtShort(ms, pattern),
  backLabel: (ms: number, now: number = Date.now()): string => P.fmtBackLabel(ms, now),
  isPrefix: (word: string): boolean => Object.hasOwn(P.PREFIXES, word),
  /** "Alt+Space" -> "⌥Space", "CommandOrControl+Shift+K" -> "⌘⇧K" */
  hotkeyLabel(accelerator: string): string {
    return accelerator.split('+').map((p) => MOD_SYMBOLS[p.toLowerCase()] ?? (p.length === 1 ? p.toUpperCase() : p)).join('');
  },
  ageBadge: (i: Pick<Item, 'kind' | 'createdAt'>, now: number = Date.now()): number | null => P.ItemAge.badge(i, now),
  ageLevel: (days: number): 0 | 1 | 2 => P.ItemAge.level(days) as 0 | 1 | 2,
  recurrenceText: (rule: string): string => P.RecurrenceText.describe(rule),
  queryWords: (q: string): string[] => P.QueryTerms.words(q),
  cadenceWeeks: (dates: number[], now: number = Date.now(), count = 12): boolean[] => P.CadenceStrip.weeks(dates, now, count),
};

export const PinOrder = P.PinOrder;
export { NavHistory } from '../core/pure';
export const sortPeople = (s: PersonSummary[], pinned: Set<string>): PersonSummary[] => P.PeopleOrder.sorted(s, pinned);
export function parseCapture(line: string, opts?: { now?: number; eod?: [number, number] }): ParsedCapture { return P.parseCapture(line, opts); }
