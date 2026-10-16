import { describe, expect, it } from 'vitest';
import type { Item, Person, PersonSummary, TodaySections } from '../src/shared/types';
import {
  ambientContext, burstDots, filterToday, lastOneOnOne, localDay, matchPeople, nextOneOnOnePreset, normalizeJiraBase, nudgeText, pausedUntilLabel,
  savableTemplates, shouldBurst, tomorrowAt9, urgentCount, validateTemplateName,
} from '../src/renderer/speed-logic';

const person = (id: string, name: string, extra: Partial<Person> = {}): Person => ({
  id, handle: name.split(' ')[0]!.toLowerCase(), name, relation: 'report', cadenceDays: 7, matchEmails: '', hiddenFromClaude: false, archived: false, notes: '', startDate: null, birthday: null, ...extra,
});
const sum = (p: Person, daysSinceLast: number | null = 3): PersonSummary => ({ person: p, lastInteraction: null, openOwe: 0, openWait: 0, daysSinceLast, cadenceOverdue: false });
const item = (id: string, personId: string | null, extra: Partial<Item> = {}): Item => ({
  id, kind: 'owe', title: id, body: null, quote: null, personId, status: 'open', dueAt: null, dueHasTime: false, remindAt: null, snoozedUntil: null, snoozeCount: 0,
  recurRule: null, pinned: false, inbox: false, source: 'hotkey', createdAt: 0, updatedAt: 0, completedAt: null, lastTouchedAt: 0, externalId: null, sourceLabel: null, sourceUrl: null, interactionId: null, ...extra,
});
const isPrefix = (w: string) => ['owe', 'wait', 'bring', 'todo', 'said', 'note', 'o', 'w', 'b', 't', 's', 'n'].includes(w);

describe('ambient context', () => {
  const sara = person('s', 'Sara Lindqvist', { notes: 'x'.repeat(100) });
  it('cuts the notes at 80 characters and keeps the two soonest owes', () => {
    const a = ambientContext(sum(sara), [item('late', 's', { dueAt: 30 }), item('soon', 's', { dueAt: 10 }), item('undated', 's'), item('mid', 's', { dueAt: 20 }), item('wait', 's', { kind: 'wait' }), item('other', 'o')])!;
    expect(a.notes).toHaveLength(80);
    expect(a.notes.endsWith('…')).toBe(true);
    expect(a.owes.map((i) => i.id)).toEqual(['soon', 'mid']);
    expect(a.last).toBe('last 1:1 3 days ago');
  });
  it('says never when there was no 1:1 and hides when there is nothing at all', () => {
    expect(ambientContext(sum(person('s', 'Sara'), null), [])).toEqual({ notes: '', owes: [], last: 'last 1:1 never' });
    expect(ambientContext(undefined, [])).toBeNull();
  });
  it('wording of the last 1:1', () => {
    expect([lastOneOnOne(0), lastOneOnOne(1), lastOneOnOne(12), lastOneOnOne(null)]).toEqual(['last 1:1 today', 'last 1:1 yesterday', 'last 1:1 12 days ago', 'last 1:1 never']);
  });
});

describe('snooze until the next 1:1', () => {
  const now = new Date(2026, 9, 15, 10, 0).getTime(); // Thu 15 Oct 10:00
  const day = (d: number) => new Date(2026, 9, d).getTime();
  const lbl = (ms: number) => String(new Date(ms).getDate());
  it('uses 09:00 on the day the core gives', () => {
    const p = nextOneOnOnePreset(person('s', 'Sara Lindqvist'), null, now, () => day(20), lbl)!;
    expect(p.label).toBe('Until next 1:1 with Sara (20)');
    expect(new Date(p.date).getHours()).toBe(9);
    expect(new Date(p.date).getDate()).toBe(20);
  });
  it('is skipped without a cadence, without a date, or when 09:00 already passed', () => {
    expect(nextOneOnOnePreset(person('s', 'Sara', { cadenceDays: null }), null, now, () => day(20), lbl)).toBeNull();
    expect(nextOneOnOnePreset(person('s', 'Sara'), null, now, () => null, lbl)).toBeNull();
    expect(nextOneOnOnePreset(person('s', 'Sara'), null, now, () => day(15), lbl)).toBeNull();
    expect(nextOneOnOnePreset(undefined, null, now, () => day(20), lbl)).toBeNull();
  });
});

describe('people palette', () => {
  const people = [person('a', 'Amir Haddad'), person('s', 'Sara Lindqvist'), person('z', 'Zed Old', { archived: true })];
  const summaries = people.map((p) => sum(p));
  it('lists active people, most recent first, and matches name or handle', () => {
    expect(matchPeople(summaries, [people[1]!, people[0]!], '').map((s) => s.person.id)).toEqual(['s', 'a']);
    expect(matchPeople(summaries, [], 'lind').map((s) => s.person.id)).toEqual(['s']);
    expect(matchPeople(summaries, [], '@AMIR').map((s) => s.person.id)).toEqual(['a']);
    expect(matchPeople(summaries, [], 'zed')).toEqual([]);
  });
});

describe('Today person filter', () => {
  const t: TodaySections = { slipping: [item('1', 's')], overdue: [item('2', 'a')], today: [item('3', 's'), item('4', null)], waitingStale: [], inbox: [item('5', 's')], checkIn: [sum(person('s', 'Sara')), sum(person('a', 'Amir'))] };
  it('keeps one person in every section', () => {
    const f = filterToday(t, 's');
    expect([...f.slipping, ...f.overdue, ...f.today, ...f.waitingStale, ...f.inbox].map((i) => i.id)).toEqual(['1', '3', '5']);
    expect(f.checkIn.map((c) => c.person.id)).toEqual(['s']);
    expect(filterToday(t, null)).toBe(t);
  });
});

describe('capture templates', () => {
  it('validates the name', () => {
    expect(validateTemplateName('prep', [], isPrefix)).toBeNull();
    expect(validateTemplateName('', [], isPrefix)).toMatch(/name/);
    expect(validateTemplateName('my prep', [], isPrefix)).toMatch(/spaces/);
    expect(validateTemplateName('Prep', [], isPrefix)).toMatch(/lower/);
    expect(validateTemplateName('owe', [], isPrefix)).toMatch(/keyword/);
    expect(validateTemplateName('prep', ['prep'], isPrefix)).toMatch(/already/);
  });
  it('only valid templates with lines are saved, blank lines dropped', () => {
    const out = savableTemplates([
      { name: 'prep', text: 'bring @{person} one\n\n  bring @{person} two  ' }, { name: 'owe', text: 'x' }, { name: 'empty', text: ' \n' }, { name: 'dup', text: 'a' }, { name: 'dup', text: 'b' },
    ], isPrefix);
    expect(out).toEqual([{ name: 'prep', lines: ['bring @{person} one', 'bring @{person} two'] }]);
  });
});

describe('nudge, jira base, pause', () => {
  it('nudge text uses the first name', () => {
    expect(nudgeText('Sara Lindqvist', 'the API spec')).toBe('Hi Sara, quick check-in on the API spec. Any update?');
  });
  it('normalizes the Jira base URL', () => {
    expect(normalizeJiraBase(' https://acme.atlassian.net/browse ')).toBe('https://acme.atlassian.net/browse/');
    expect(normalizeJiraBase('https://acme.atlassian.net/browse/')).toBe('https://acme.atlassian.net/browse/');
    expect(normalizeJiraBase('https://x.example/?selectedIssue=')).toBe('https://x.example/?selectedIssue=');
    expect(normalizeJiraBase('')).toBe('');
    expect(normalizeJiraBase('javascript:alert(1)')).toBeNull();
    expect(normalizeJiraBase('acme.atlassian.net')).toBeNull();
  });
  it('pause label and tomorrow 09:00', () => {
    const now = new Date(2026, 9, 15, 10, 0).getTime();
    const fmt = (ms: number, p: string) => `${p}:${new Date(ms).getHours()}`;
    expect(pausedUntilLabel(now + 3_600_000, now, fmt)).toBe('HH:mm:11');
    expect(pausedUntilLabel(tomorrowAt9(now), now, fmt)).toBe('EEE HH:mm:9');
    expect(new Date(tomorrowAt9(now)).getDate()).toBe(16);
  });
});

describe('ring burst', () => {
  it('plays only on non-empty to empty, once a day', () => {
    expect(shouldBurst(null, 0, '', '2026-10-15')).toBe(false); // first load
    expect(shouldBurst(0, 0, '', '2026-10-15')).toBe(false);
    expect(shouldBurst(3, 2, '', '2026-10-15')).toBe(false);
    expect(shouldBurst(1, 0, '', '2026-10-15')).toBe(true);
    expect(shouldBurst(1, 0, '2026-10-15', '2026-10-15')).toBe(false);
    expect(shouldBurst(1, 0, '2026-10-14', '2026-10-15')).toBe(true);
  });
  it('counts overdue, slipping and inbox only', () => {
    const t: TodaySections = { slipping: [item('1', null)], overdue: [item('2', null)], today: [item('3', null)], waitingStale: [item('4', null)], inbox: [item('5', null)], checkIn: [] };
    expect(urgentCount(t)).toBe(3);
  });
  it('14 dots, all away from the centre', () => {
    const d = burstDots();
    expect(d).toHaveLength(14);
    expect(d.every((x) => Math.hypot(x.dx, x.dy) > 60)).toBe(true);
  });
  it('local day key', () => { expect(localDay(new Date(2026, 0, 5, 23, 59).getTime())).toBe('2026-01-05'); });
});
