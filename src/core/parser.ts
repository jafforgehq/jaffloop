// Deterministic, offline parser for the one-line capture grammar (pure, no node/electron imports).
// `[prefix] [@person] text [date] [recurrence] [#tag] [!]`   Token ranges are UTF-16 offsets into the input.
import type { ItemKind, ParsedCapture, ParsedToken, TokenRole } from '../shared/types';
import { addDays, addMonths, atTime, startOfDay, startOfWeek, weekday } from './calendar';
import { RRULE_DAY, nextOccurrence as recurrenceNext } from './recurrence';

/** Null-prototype dictionary so user text such as "constructor" never hits Object.prototype. */
function dict<T>(o: Record<string, T>): Record<string, T> {
  return Object.assign(Object.create(null) as Record<string, T>, o);
}

export const PREFIXES: Record<string, ItemKind> = dict<ItemKind>({
  owe: 'owe', o: 'owe', wait: 'wait', w: 'wait', bring: 'bring', b: 'bring',
  todo: 'task', t: 'task', said: 'said', s: 'said', note: 'note', n: 'note',
});
/** 1 = Sunday ... 7 = Saturday */
const WEEKDAYS = dict<number>({
  sun: 1, sunday: 1, mon: 2, monday: 2, tue: 3, tues: 3, tuesday: 3, wed: 4, wednesday: 4,
  thu: 5, thur: 5, thurs: 5, thursday: 5, fri: 6, friday: 6, sat: 7, saturday: 7,
});
const MONTHS = dict<number>({
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
});
const FREQ_UNIT = dict<string>({ day: 'DAILY', days: 'DAILY', week: 'WEEKLY', weeks: 'WEEKLY', month: 'MONTHLY', months: 'MONTHLY' });
const FREQ_WORD = dict<string>({ day: 'DAILY', week: 'WEEKLY', month: 'MONTHLY' });

interface Tok { text: string; start: number; end: number; used: boolean }
interface DatePick { day: number | null; time: [number, number] | null; absolute: number | null; absHasTime: boolean }

const swiftInt = (s: string): number | null => (/^[+-]?\d+$/.test(s) ? parseInt(s, 10) : null);
const swiftDouble = (s: string): number | null => (/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(s) ? Number(s) : null);
const trimDots = (s: string): string => s.replace(/^[,.]+|[,.]+$/g, '');

function timeOf(s: string): [number, number] | null {
  const m = /^(\d{1,2})(?::(\d{2}))?(am|pm)?$/.exec(s.toLowerCase());
  if (!m) return null;
  const hasColon = m[2] !== undefined;
  const ap = m[3];
  if (!hasColon && ap === undefined) return null;
  let h = parseInt(m[1]!, 10);
  const mi = hasColon ? parseInt(m[2]!, 10) : 0;
  if (ap !== undefined) {
    if (h < 1 || h > 12) return null;
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
  }
  return h < 24 && mi < 60 ? [h, mi] : null;
}

/** "2h" -> seconds */
function duration(s: string): number | null {
  const m = /^(\d+)(m|min|h|hr|d)$/.exec(s.toLowerCase());
  if (!m) return null;
  const n = Number(m[1]);
  switch (m[2]) {
    case 'm': case 'min': return n * 60;
    case 'h': case 'hr': return n * 3600;
    default: return n * 86400;
  }
}

function unitSeconds(s: string): number | null {
  switch (s.toLowerCase()) {
    case 'min': case 'mins': case 'minute': case 'minutes': return 60;
    case 'h': case 'hr': case 'hrs': case 'hour': case 'hours': return 3600;
    case 'd': case 'day': case 'days': return 86400;
    default: return null;
  }
}

export interface ParseOptions {
  now?: number;
  /** end-of-day time used by "eod" and "eow", default [17, 30] */
  eod?: [number, number];
}

export function parseCapture(input: string, opts: ParseOptions = {}): ParsedCapture {
  const now = opts.now ?? Date.now();
  const eod = opts.eod ?? [17, 30];
  const out: ParsedCapture = {
    kind: 'task', kindExplicit: false, personHandle: null, title: '', quote: null, dueAt: null, dueHasTime: false,
    remindAt: null, recurRule: null, tags: [], pinned: false, tokens: [], inbox: false,
  };

  // 1. tokenise on whitespace
  const toks: Tok[] = [];
  for (const m of input.matchAll(/[^\s\u0085]+/g)) toks.push({ text: m[0], start: m.index, end: m.index + m[0].length, used: false });
  const tk = (i: number): Tok => toks[i]!;
  const use = (idx: number, role: TokenRole): void => {
    const t = tk(idx);
    t.used = true;
    out.tokens.push({ role, start: t.start, end: t.end, text: t.text });
  };

  // 2. prefix
  const first = toks[0];
  if (first) {
    const k = PREFIXES[first.text.toLowerCase()];
    if (k !== undefined && (toks.length > 1 || [...first.text].length > 2)) {
      out.kind = k; out.kindExplicit = true;
      use(0, 'kind');
    }
  }

  // 3. quote (said only): first "..." pair
  if (out.kind === 'said' && out.kindExplicit) {
    const m = /["“]([^"”]*)["”]/.exec(input);
    if (m) {
      const qs = m.index, qe = m.index + m[0].length;
      out.quote = m[1]!;
      out.tokens.push({ role: 'quote', start: qs, end: qe, text: m[0] });
      for (const t of toks) if (Math.min(t.end, qe) - Math.max(t.start, qs) > 0) t.used = true;
    }
  }

  // 4. person, tags, pin
  for (let idx = 0; idx < toks.length; idx++) {
    const t = tk(idx);
    if (t.used) continue;
    const s = t.text;
    if (out.personHandle === null && s.startsWith('@') && [...s].length > 1) {
      const handle = s.slice(1).replace(/^[,.:;!?]+|[,.:;!?]+$/g, '');
      if (handle !== '' && /^[A-Za-z0-9_.-]+$/.test(handle)) {
        out.personHandle = handle.toLowerCase();
        t.used = true;
        out.tokens.push({ role: 'person', start: t.start, end: t.start + handle.length + 1, text: '@' + handle });
      }
    } else if (s.startsWith('#') && [...s].length > 1 && /^[A-Za-z0-9_-]+$/.test(s.slice(1))) {
      out.tags.push(s.slice(1).toLowerCase()); use(idx, 'tag');
    } else if (s === '!') {
      out.pinned = true; use(idx, 'pin');
    }
  }

  // 5. date machinery
  const today = startOfDay(now);
  const nextWeekday = (wd: number, nextWeek: boolean): number => {
    if (nextWeek) { // first matching day on or after next Monday
      const base = addDays(startOfWeek(now), 7);
      return addDays(base, (wd - weekday(base) + 7) % 7);
    }
    return addDays(today, (wd - weekday(today) + 7) % 7 || 7); // strictly after today
  };
  const resolveMonthDay = (mo: number, d: number): number => {
    let date = new Date(new Date(today).getFullYear(), mo - 1, d).getTime();
    if (date < today) date = new Date(new Date(today).getFullYear() + 1, mo - 1, d).getTime();
    return date;
  };

  /** Scans unused tokens from `start` for one date phrase. Marks consumed tokens. */
  const scanDate = (start: number, onlyFirstUnusedRun = false): DatePick => {
    const pick: DatePick = { day: null, time: null, absolute: null, absHasTime: true };
    let idx = start;
    while (idx < toks.length) {
      if (tk(idx).used) {
        if (onlyFirstUnusedRun && (pick.day !== null || pick.time !== null || pick.absolute !== null)) break;
        idx++; continue;
      }
      const t = trimDots(tk(idx).text.toLowerCase());
      const nextT = idx + 1 < toks.length && !tk(idx + 1).used ? trimDots(tk(idx + 1).text.toLowerCase()) : null;
      const next2 = idx + 2 < toks.length && !tk(idx + 2).used ? tk(idx + 2).text.toLowerCase() : null;
      // in 2h / in 2 hours
      if (t === 'in' && nextT !== null && pick.absolute === null) {
        const d = duration(nextT);
        if (d !== null) {
          pick.absolute = now + d * 1000; pick.absHasTime = !nextT.endsWith('d');
          use(idx, 'date'); use(idx + 1, 'date'); idx += 2; continue;
        }
        const num = swiftDouble(nextT);
        const u = num !== null && next2 !== null ? unitSeconds(next2) : null;
        if (num !== null && u !== null) {
          pick.absolute = now + num * u * 1000; pick.absHasTime = u < 86400;
          use(idx, 'date'); use(idx + 1, 'date'); use(idx + 2, 'date'); idx += 3; continue;
        }
      }
      if (t === 'at' && nextT !== null && pick.time === null) {
        const tm = timeOf(nextT);
        if (tm) { pick.time = tm; use(idx, 'date'); use(idx + 1, 'date'); idx += 2; continue; }
      }
      if (t === 'next' && nextT !== null && pick.day === null) {
        const wd = WEEKDAYS[nextT];
        if (wd !== undefined) { pick.day = nextWeekday(wd, true); use(idx, 'date'); use(idx + 1, 'date'); idx += 2; continue; }
      }
      if (pick.day === null && pick.absolute === null) {
        if (t === 'today') { pick.day = today; use(idx, 'date'); idx++; continue; }
        if (t === 'tomorrow' || t === 'tmr' || t === 'tmrw') { pick.day = addDays(today, 1); use(idx, 'date'); idx++; continue; }
        const wd = WEEKDAYS[t];
        if (wd !== undefined) { pick.day = nextWeekday(wd, false); use(idx, 'date'); idx++; continue; }
        if (t === 'eow') {
          pick.day = weekday(today) === 6 ? today : nextWeekday(6, false);
          pick.time = pick.time ?? eod; use(idx, 'date'); idx++; continue;
        }
        // 15 nov / nov 15
        const d = swiftInt(t);
        if (d !== null && d >= 1 && d <= 31 && nextT !== null && MONTHS[nextT] !== undefined) {
          pick.day = resolveMonthDay(MONTHS[nextT]!, d); use(idx, 'date'); use(idx + 1, 'date'); idx += 2; continue;
        }
        const mo = MONTHS[t];
        const d2 = nextT !== null ? swiftInt(nextT) : null;
        if (mo !== undefined && d2 !== null && d2 >= 1 && d2 <= 31) {
          pick.day = resolveMonthDay(mo, d2); use(idx, 'date'); use(idx + 1, 'date'); idx += 2; continue;
        }
      }
      if (t === 'eod' && pick.time === null) { pick.time = eod; use(idx, 'date'); idx++; continue; }
      if (pick.time === null && pick.absolute === null) {
        const tm = timeOf(t);
        if (tm) { pick.time = tm; use(idx, 'date'); idx++; continue; }
      }
      idx++;
    }
    return pick;
  };
  const resolve = (p: DatePick): [number, boolean] | null => {
    if (p.absolute !== null) return p.absHasTime ? [p.absolute, true] : [startOfDay(p.absolute), false];
    if (p.day !== null && p.time !== null) return [atTime(p.day, p.time[0], p.time[1]), true];
    if (p.day !== null) return [p.day, false];
    if (p.time !== null) {
      let c = atTime(today, p.time[0], p.time[1]);
      if (c <= now) c = addDays(c, 1);
      return [c, true];
    }
    return null;
  };

  // 5a. remind
  const ri = toks.findIndex((t) => !t.used && t.text.toLowerCase() === 'remind');
  if (ri >= 0 && ri + 1 < toks.length) {
    use(ri, 'remind');
    const n = tk(ri + 1);
    const d = n.used ? null : duration(n.text);
    if (d !== null) {
      out.remindAt = now + d * 1000; use(ri + 1, 'remind');
    } else {
      const r = resolve(scanDate(ri + 1, true));
      if (r) out.remindAt = r[0];
    }
  }

  // 5b. recurrence
  let recurTime: [number, number] | null = null;
  let recurFirst: number | null = null;
  for (let idx = 0; idx < toks.length && out.recurRule === null; idx++) {
    if (tk(idx).used) continue;
    const t = tk(idx).text.toLowerCase();
    const nx = idx + 1 < toks.length && !tk(idx + 1).used ? tk(idx + 1).text.toLowerCase() : null;
    let consumed = 0;
    let rule: string | null = null;
    let firstDay: number | null = null;
    if (t === 'every' && nx !== null) {
      const wd = WEEKDAYS[nx];
      const n = swiftInt(nx);
      if (wd !== undefined) { rule = `FREQ=WEEKLY;BYDAY=${RRULE_DAY[wd]}`; firstDay = nextWeekday(wd, false); consumed = 2; }
      else if (nx === 'weekday' || nx === 'weekdays') { rule = 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'; consumed = 2; }
      else if (FREQ_WORD[nx] !== undefined) { rule = `FREQ=${FREQ_WORD[nx]}`; consumed = 2; }
      else if (n !== null && n > 0 && idx + 2 < toks.length && !tk(idx + 2).used) {
        const f = FREQ_UNIT[trimDots(tk(idx + 2).text.toLowerCase())];
        if (f !== undefined) { rule = `FREQ=${f};INTERVAL=${n}`; consumed = 3; }
      }
    } else if (t === 'monthly') { rule = 'FREQ=MONTHLY'; consumed = 1; }
    else if (t === 'weekly') { rule = 'FREQ=WEEKLY'; consumed = 1; }
    else if (t === 'daily') { rule = 'FREQ=DAILY'; consumed = 1; }
    else if (t === 'weekdays') { rule = 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'; consumed = 1; }
    if (rule !== null) {
      out.recurRule = rule;
      for (let k = 0; k < consumed; k++) use(idx + k, 'recurrence');
      // optional time right after
      const after = idx + consumed;
      if (after < toks.length && !tk(after).used) {
        const tm = timeOf(tk(after).text);
        if (tm) { recurTime = tm; use(after, 'recurrence'); }
      }
      recurFirst = firstDay;
    }
  }

  // 5c. due date
  const due = resolve(scanDate(0));
  if (due) {
    out.dueAt = due[0]; out.dueHasTime = due[1];
  } else if (out.recurRule !== null) {
    // first occurrence of the recurrence
    const rule = out.recurRule;
    let day = recurFirst ?? today;
    if (recurFirst === null) {
      if (rule.includes('BYDAY=MO,TU,WE,TH,FR')) {
        const wd = weekday(today);
        if (wd < 2 || wd > 6) day = recurrenceNext(today, rule) ?? today;
      } else if (rule.includes('MONTHLY')) day = addMonths(today, 1);
      else if (rule.includes('WEEKLY')) day = addDays(today, 7 * (swiftInt(rule.split('INTERVAL=').pop()!) ?? 1));
      else if (rule.includes('DAILY')) day = today;
    }
    if (recurTime) {
      let d = atTime(day, recurTime[0], recurTime[1]);
      if (d <= now) d = recurrenceNext(d, rule) ?? addDays(d, 1);
      out.dueAt = d; out.dueHasTime = true;
    } else { out.dueAt = day; out.dueHasTime = false; }
  }

  // 6. title: unused tokens in original order
  out.title = toks.filter((t) => !t.used).map((t) => t.text).join(' ');
  if (out.title === '' && out.quote !== null) out.title = out.quote;
  if (!out.kindExplicit) out.kind = out.personHandle !== null ? 'bring' : 'task';
  out.tokens.sort((a: ParsedToken, b: ParsedToken) => a.start - b.start);
  out.inbox = (out.kind === 'task' || out.kind === 'owe' || out.kind === 'wait' || out.kind === 'bring') && out.dueAt === null && out.personHandle === null;
  return out;
}

export const CaptureParser = { parse: parseCapture, prefixes: PREFIXES };
