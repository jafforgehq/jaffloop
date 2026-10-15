// 0.2.0 pure helpers (no node:/electron imports, bundled into the renderer too). Contract: docs/FEATURES-0.2.md.
import type { CaptureTemplate, Item, LinkSegment, ReviewData, UpcomingDate } from '../shared/types';
import { addDays, startOfDay } from './calendar';
import { fmtShort } from './format';

const URL_TAIL = /[.,;:)!?\]'"]+$/;
// A URL is matched first and as a whole, so a Jira-looking key inside it is never linked on its own.
const JIRA_KEY = '(?<![\\w-])[A-Z][A-Z0-9]+-\\d+(?!\\w)';

/**
 * Splits a title into plain and link runs. http(s) URLs always link (trailing `.,;:)!?]'"` stay outside); Jira keys
 * (`ABC-123`) link to `jiraBase + key` only when `jiraBase` is not empty. Adjacent plain text is merged.
 */
export function linkify(text: string, jiraBase: string): LinkSegment[] {
  const base = jiraBase.trim();
  // shortcut: a base without a trailing / = ? # gets a / so 'https://x/browse' still yields 'https://x/browse/ABC-1'
  const prefix = base === '' || /[/=?#]$/.test(base) ? base : base + '/';
  const re = new RegExp(`https?://\\S+${base === '' ? '' : '|' + JIRA_KEY}`, 'g');
  const out: LinkSegment[] = [];
  const plain = (t: string): void => {
    if (t === '') return;
    const last = out[out.length - 1];
    if (last && last.href === undefined) last.text += t; else out.push({ text: t });
  };
  let at = 0;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    let hit = m[0];
    if (/^https?:/.test(hit)) {
      hit = hit.replace(URL_TAIL, '');
      if (!/^https?:\/\/./.test(hit)) { re.lastIndex = m.index + 1; continue; } // "https://" followed only by punctuation is not a link
    }
    plain(text.slice(at, m.index));
    out.push({ text: hit, href: /^https?:/.test(hit) ? hit : prefix + hit });
    at = m.index + hit.length;
    re.lastIndex = at; // the stripped tail goes back into the scan
  }
  plain(text.slice(at));
  return out;
}

const HANDLE = /(^|\s)@([A-Za-z0-9._-]+)/;

/**
 * `prep @sara` with a template named `prep` becomes its lines, `{person}` = the handle without @, `{rest}` = the rest of the
 * line without the template word and the first @handle. null when the first word is no template or there is no @handle.
 */
export function expandTemplate(line: string, templates: CaptureTemplate[]): string[] | null {
  const text = line.trim();
  const m = /^(\S+)(?:\s+([\s\S]*))?$/.exec(text);
  if (!m) return null;
  const tpl = templates.find((t) => t.name.trim().toLowerCase() === m[1]!.toLowerCase());
  if (!tpl) return null;
  const body = m[2] ?? '';
  const h = HANDLE.exec(body);
  if (!h) return null;
  const person = h[2]!.replace(/[.-]+$/, ''); // "@sara." at the end of a sentence
  if (person === '') return null;
  const cut = h.index + h[1]!.length;
  const rest = (body.slice(0, cut) + ' ' + body.slice(cut + 1 + h[2]!.length)).replace(/\s+/g, ' ').trim();
  const lines = tpl.lines.map((l) => l.replaceAll('{person}', person).replaceAll('{rest}', rest).trim()).filter((l) => l !== '');
  return lines;
}

/**
 * Start of the day the next 1:1 is due: last + cadence. In the past, or never met: today. null without a cadence.
 */
export function nextOneOnOneAt(cadenceDays: number | null, lastInteraction: number | null, now: number): number | null {
  if (cadenceDays === null) return null;
  const today = startOfDay(now);
  if (lastInteraction === null) return today;
  return Math.max(today, startOfDay(addDays(lastInteraction, cadenceDays)));
}

const day = (ms: number): string => fmtShort(ms, 'd MMM', 'en');
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** "Sara's 2-year work anniversary is in 3 days", "Amir's birthday is tomorrow", "... is today". */
export function upcomingLabel(u: UpcomingDate, name: string): string {
  const what = u.kind === 'birthday' ? 'birthday' : u.years === null ? 'work anniversary' : `${u.years}-year work anniversary`;
  const when = u.inDays <= 0 ? 'today' : u.inDays === 1 ? 'tomorrow' : `in ${u.inDays} days`;
  return `${name}'s ${what} is ${when}`;
}

/**
 * The weekly review as Markdown, built from the data only (no AI). Sections without entries are left out. Items are
 * ordered by person so a person's lines sit together.
 */
export function reviewMarkdown(r: ReviewData, names: Record<string, string>, opts: { title?: string } = {}): string {
  const who = (i: Item): string | null => (i.personId !== null ? names[i.personId] ?? null : null);
  const byPerson = (items: Item[]): Item[] => items
    .map((i, n) => ({ i, n, w: who(i) }))
    .sort((a, b) => (a.w === b.w ? a.n - b.n : a.w === null ? 1 : b.w === null ? -1 : a.w.localeCompare(b.w, 'en', { sensitivity: 'base' }) || a.n - b.n))
    .map((x) => x.i);
  const line = (i: Item, extra = ''): string => {
    const p = who(i);
    return `- ${i.title}${p !== null ? ` (${p})` : ''}${extra}`;
  };
  const out: string[] = [opts.title ?? `## Week of ${day(r.from)} to ${day(Math.max(r.from, r.to - 1))}`, ''];

  const k = r.keptRate;
  if (k.total > 0) out.push(`Promises kept on time: ${k.onTime} of ${k.total} (${Math.round((k.onTime / k.total) * 100)}%)`, '');
  const section = (title: string, lines: string[]): void => { if (lines.length > 0) out.push(`### ${title}`, ...lines, ''); };

  section('Done', byPerson(r.closed).map((i) => line(i)));
  const seen = new Set<string>();
  const open = byPerson([...r.overduePromises, ...r.slipped]).filter((i) => !seen.has(i.id) && seen.add(i.id));
  section('Still open', open.map((i) => line(i, i.dueAt !== null ? `, due ${day(i.dueAt)}` : '')));
  section('Waiting on others', byPerson(r.staleWaits).map((i) => line(i)));
  section('Needs attention', r.offCadence.map((s) => {
    const name = names[s.person.id] ?? s.person.name;
    return s.daysSinceLast === null ? `- ${name}: no 1:1 yet` : `- ${name}: last 1:1 ${plural(s.daysSinceLast, 'day')} ago`;
  }));
  while (out[out.length - 1] === '') out.pop();
  return out.join('\n') + '\n';
}
