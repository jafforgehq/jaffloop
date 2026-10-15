import { describe, expect, it } from 'vitest';
import { CaptureParser, PREFIXES, parseCapture } from '../src/core/pure';

// Wednesday 2026-10-14 10:00 (TZ=UTC, set in vitest.config.ts)
const now = Date.UTC(2026, 9, 14, 10);
const p = (s: string) => parseCapture(s, { now });
const d = (y: number, m: number, day: number, h = 0, mi = 0) => Date.UTC(y, m - 1, day, h, mi);

describe('time zone', () => {
  it('runs in UTC', () => expect(new Date().getTimezoneOffset()).toBe(0));
});

describe('ParserTests', () => {
  it('owe', () => {
    const r = p('owe @sara review RFC fri');
    expect(r.kind).toBe('owe'); expect(r.personHandle).toBe('sara'); expect(r.title).toBe('review RFC');
    expect(r.dueAt).toBe(d(2026, 10, 16)); expect(r.dueHasTime).toBe(false);
  });
  it('wait with time', () => {
    const r = p('wait @amir API spec mon 10:00');
    expect(r.kind).toBe('wait'); expect(r.personHandle).toBe('amir'); expect(r.title).toBe('API spec');
    expect(r.dueAt).toBe(d(2026, 10, 19, 10)); expect(r.dueHasTime).toBe(true);
  });
  it('bring', () => {
    const r = p('bring @sara workload, promotion timeline');
    expect(r.kind).toBe('bring'); expect(r.title).toBe('workload, promotion timeline'); expect(r.dueAt).toBeNull();
  });
  it('said quote', () => {
    const r = p('said @sara "we\'ll revisit headcount in Nov"');
    expect(r.kind).toBe('said'); expect(r.quote).toBe("we'll revisit headcount in Nov");
    expect(r.dueAt, 'date words inside the quote must not be parsed').toBeNull();
  });
  it('task tag pin', () => {
    const r = p('todo prepare Q4 plan thu #planning !');
    expect(r.kind).toBe('task'); expect(r.title).toBe('prepare Q4 plan'); expect(r.tags).toEqual(['planning']);
    expect(r.pinned).toBe(true); expect(r.dueAt).toBe(d(2026, 10, 15));
  });
  it('recurring', () => {
    const r = p('todo 1:1 prep every mon 09:00');
    expect(r.kind).toBe('task'); expect(r.title).toBe('1:1 prep');
    expect(r.recurRule).toBe('FREQ=WEEKLY;BYDAY=MO'); expect(r.dueAt).toBe(d(2026, 10, 19, 9)); expect(r.dueHasTime).toBe(true);
  });
  it('person defaults to bring', () => {
    const r = p('@sara ask about on-call rotation');
    expect(r.kind).toBe('bring'); expect(r.kindExplicit).toBe(false); expect(r.title).toBe('ask about on-call rotation');
  });
  it('plain defaults to task', () => {
    const r = p('buy usb-c cable');
    expect(r.kind).toBe('task'); expect(r.title).toBe('buy usb-c cable'); expect(r.inbox).toBe(true);
  });
  it('short prefix needs a space', () => {
    expect(p('o @sara thing').kind).toBe('owe');
    expect(p('owed money').kind).toBe('task');
    expect(p('notes about x').kind).toBe('task');
  });
  it('dates', () => {
    expect(p('todo x today').dueAt).toBe(d(2026, 10, 14));
    expect(p('todo x tomorrow').dueAt).toBe(d(2026, 10, 15));
    expect(p('todo x next mon').dueAt).toBe(d(2026, 10, 19));
    expect(p('todo x next fri').dueAt).toBe(d(2026, 10, 23));
    expect(p('todo x 15 nov').dueAt).toBe(d(2026, 11, 15));
    expect(p('todo x 1 oct').dueAt, 'past dates roll to next year').toBe(d(2027, 10, 1));
    const r = p('todo x in 2h'); expect(r.dueAt).toBe(now + 7200_000); expect(r.dueHasTime).toBe(true);
    const e = p('todo x eod'); expect(e.dueAt).toBe(d(2026, 10, 14, 17, 30)); expect(e.dueHasTime).toBe(true);
    const w = p('todo x eow'); expect(w.dueAt).toBe(d(2026, 10, 16, 17, 30));
  });
  it('time only is the next occurrence', () => {
    expect(p('todo x 15:00').dueAt).toBe(d(2026, 10, 14, 15));
    expect(p('todo x 9:00').dueAt).toBe(d(2026, 10, 15, 9));
    expect(p('todo x 3pm').dueAt).toBe(d(2026, 10, 14, 15));
  });
  it('remind', () => {
    const r = p('owe @sara thing fri remind 1h');
    expect(r.remindAt).toBe(now + 3600_000); expect(r.title).toBe('thing');
    const r2 = p('todo x remind fri 9:00'); expect(r2.remindAt).toBe(d(2026, 10, 16, 9)); expect(r2.dueAt).toBeNull();
  });
  it('recurrence variants', () => {
    expect(p('todo x every 2 weeks').recurRule).toBe('FREQ=WEEKLY;INTERVAL=2');
    expect(p('todo x monthly').recurRule).toBe('FREQ=MONTHLY');
    expect(p('todo x weekdays 9:00').recurRule).toBe('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR');
    expect(p('todo x weekdays 9:00').dueAt).toBe(d(2026, 10, 15, 9));
  });
  it('second person stays in the title', () => {
    const r = p('owe @sara sync with @amir about api');
    expect(r.personHandle).toBe('sara'); expect(r.title).toBe('sync with @amir about api');
  });
  it('unparseable stays in the title', () => {
    const r = p('todo call vendor sometime soon');
    expect(r.title).toBe('call vendor sometime soon'); expect(r.dueAt).toBeNull();
  });
  it('tokens for highlighting', () => {
    const r = p('owe @sara review RFC fri #x !');
    expect(r.tokens.map((t) => t.role)).toEqual(['kind', 'person', 'date', 'tag', 'pin']);
  });
});

describe('parser extras', () => {
  it('token ranges are UTF-16 offsets into the input', () => {
    const s = 'owe @sara review RFC fri #x !';
    for (const t of p(s).tokens) expect(s.slice(t.start, t.end)).toBe(t.text);
    const emoji = '😀 owe @sara x fri';   // the emoji is two UTF-16 units and must not split the line
    const r = p(emoji);
    expect(r.title).toBe('😀 owe x');
    expect(r.tokens.find((t) => t.role === 'person')!.start).toBe(emoji.indexOf('@sara'));
  });
  it('exports the prefix map and is safe against prototype keys', () => {
    expect(PREFIXES.owe).toBe('owe'); expect(CaptureParser.prefixes).toBe(PREFIXES); expect(PREFIXES.t).toBe('task');
    expect(p('constructor x').kind).toBe('task');
    expect(p('todo x constructor').title).toBe('x constructor');
  });
  it('honours a custom end of day', () => {
    expect(parseCapture('todo x eod', { now, eod: [16, 0] }).dueAt).toBe(d(2026, 10, 14, 16));
  });
  it('when today is Friday, eow is today and a weekday name is next week', () => {
    const fri = Date.UTC(2026, 9, 16, 10);
    expect(parseCapture('todo x eow', { now: fri }).dueAt).toBe(d(2026, 10, 16, 17, 30));
    expect(parseCapture('todo x fri', { now: fri }).dueAt).toBe(d(2026, 10, 23));
    expect(parseCapture('todo x next mon', { now: Date.UTC(2026, 9, 18, 10) }).dueAt).toBe(d(2026, 10, 19)); // Sunday: next week starts tomorrow
  });
  it('relative days and numeric durations', () => {
    expect(p('todo x in 2d').dueAt).toBe(d(2026, 10, 16)); expect(p('todo x in 2d').dueHasTime).toBe(false);
    expect(p('todo x in 3 hours').dueAt).toBe(now + 3 * 3600_000);
    expect(p('todo x at 4pm').dueAt).toBe(d(2026, 10, 14, 16));
  });
  it('recurrence without a date starts on the first occurrence', () => {
    expect(p('todo x daily').dueAt).toBe(d(2026, 10, 14));
    expect(p('todo x weekly').dueAt).toBe(d(2026, 10, 21));
    expect(p('todo x monthly').dueAt).toBe(d(2026, 11, 14));
    expect(p('todo x every weekday').dueAt).toBe(d(2026, 10, 14));
  });
  it('a lone quote becomes the title', () => {
    expect(p('said "only a quote"').title).toBe('only a quote');
  });
});
