// Pure helpers for the people, search, 1:1 and releases views (no DOM, no model): kept apart so vitest can import them.
import type { PersonSummary } from '../shared/types';

export interface Part { text: string; hit: boolean }

/** Split `text` into parts, marking every case-insensitive occurrence of any term (overlaps merged). */
export function highlightParts(text: string, terms: string[]): Part[] {
  const low = text.toLowerCase();
  const ranges: Array<[number, number]> = [];
  for (const t of terms) {
    const w = t.toLowerCase();
    if (!w) continue;
    for (let from = low.indexOf(w); from >= 0; from = low.indexOf(w, from + w.length)) ranges.push([from, from + w.length]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  const out: Part[] = [];
  let at = 0;
  for (const [s, e] of merged) {
    if (s > at) out.push({ text: text.slice(at, s), hit: false });
    out.push({ text: text.slice(s, e), hit: true });
    at = e;
  }
  if (at < text.length || !out.length) out.push({ text: text.slice(at), hit: false });
  return out;
}

/** "name" keeps the given order, "urgency" uses `ordered` (cadence-overdue first), "last" puts the longest gap first (never first of all). */
export function sortPeopleBy(sort: string, summaries: PersonSummary[], ordered: PersonSummary[]): PersonSummary[] {
  if (sort === 'urgency') return ordered;
  if (sort === 'last') return [...summaries].sort((a, b) => (b.daysSinceLast ?? Infinity) - (a.daysSinceLast ?? Infinity) || 0);
  return summaries;
}

export const firstName = (name: string): string => name.trim().split(/\s+/)[0] || name;

/** m:ss for the 1:1 timer. */
export function timer(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** The line saved from the "What you said" field; double quotes inside become single quotes. Null when empty. */
export function saidLine(handle: string, text: string): string | null {
  const t = text.trim().replace(/"/g, "'");
  return t ? `said @${handle} "${t}"` : null;
}

export function lastOneOnOne(days: number | null, grid = false): string {
  if (days == null) return 'no 1:1 logged';
  return grid && days === 0 ? '1:1 today' : `last 1:1 ${days}d ago`;
}

/** Person page "Last 1:1" stat. */
export const lastStat = (days: number | null): string => (days == null ? 'never' : days === 0 ? 'today' : `${days} days ago`);
