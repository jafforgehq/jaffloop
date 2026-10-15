// Pure helpers for the capture window (unit tested in test/ui-windows-capture.test.ts).
import type { ParsedToken, Person } from '../../shared/types';

export interface Segment { text: string; role?: ParsedToken['role'] }

/** Splits `text` into plain and token segments for the highlighted mirror of the input. */
export function highlightSegments(text: string, tokens: ParsedToken[]): Segment[] {
  const out: Segment[] = [];
  let at = 0;
  for (const t of [...tokens].sort((a, b) => a.start - b.start)) {
    if (t.start < at || t.end > text.length || t.end <= t.start) continue;
    if (t.start > at) out.push({ text: text.slice(at, t.start) });
    out.push({ text: text.slice(t.start, t.end), role: t.role });
    at = t.end;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}

/** The `@token` being typed at the end of the line (lowercased, without the @), or null. */
export function atQuery(text: string): string | null {
  const last = text.split(' ').pop() ?? '';
  return last.startsWith('@') && !text.endsWith(' ') ? last.slice(1).toLowerCase() : null;
}

/** Up to four people for the @ query: recent first (the caller passes them in that order). */
export function suggestionsFor(q: string | null, recent: Person[]): Person[] {
  if (q === null) return [];
  const hits = q === '' ? recent : recent.filter((p) => {
    const n = p.name.toLowerCase();
    return p.handle.startsWith(q) || n.startsWith(q) || n.includes(' ' + q);
  });
  return hits.slice(0, 4);
}

/** Replaces the @token at the end of the line with the chosen handle. */
export function completeAt(text: string, p: Pick<Person, 'handle'>): string {
  const parts = text.split(' ');
  parts.pop();
  parts.push(`@${p.handle} `);
  return parts.join(' ');
}

export const capitalize = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

/** "17:30" -> [17, 30] */
export function hm(s: string): [number, number] {
  const [h, m] = s.split(':').map((x) => parseInt(x, 10));
  return [Number.isFinite(h) ? h! : 17, Number.isFinite(m) ? m! : 30];
}
