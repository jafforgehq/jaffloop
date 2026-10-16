import { describe, expect, it } from 'vitest';
import { birthdayFrom, daysInMonth, draftError, draftFields, emptyDraft, handleFromName, inboxBadge, monthDayOf, proposedToast, reviewCardText, titleLine } from '../src/renderer/onboarding-logic';
import { matchPeople } from '../src/renderer/speed-logic';
import type { PersonSummary } from '../src/shared/types';

const existing = [{ handle: 'sara.lindqvist', name: 'Sara Lindqvist' }];

describe('handleFromName', () => {
  it('matches the main process rule', () => {
    expect(handleFromName('Sara Lindqvist')).toBe('sara.lindqvist');
    expect(handleFromName('  Zoë  O\'Neil-Smith ')).toBe('zoë.o.neil.smith');
    expect(handleFromName('---')).toBe('');
  });
});

describe('draftError', () => {
  it('needs a name with letters or numbers', () => {
    expect(draftError(emptyDraft(), [])).toMatch(/name/i);
    expect(draftError({ ...emptyDraft(), name: '!!!' }, [])).toMatch(/letters/);
    expect(draftError({ ...emptyDraft(), name: 'Amir' }, existing)).toBeNull();
  });
  it('reports a handle that already exists, whatever the case', () => {
    expect(draftError({ ...emptyDraft(), name: ' sara LINDQVIST ' }, existing)).toBe('Sara Lindqvist is already in your list');
  });
  it('wants both month and day of a birthday, or neither', () => {
    const d = { ...emptyDraft(), name: 'Amir' };
    expect(draftError({ ...d, birthMonth: 3 }, [])).toMatch(/birthday/);
    expect(draftError({ ...d, birthDay: 3 }, [])).toMatch(/birthday/);
    expect(draftError({ ...d, birthMonth: 4, birthDay: 31 }, [])).toMatch(/birthday/);
    expect(draftError({ ...d, birthMonth: 4, birthDay: 30 }, [])).toBeNull();
  });
});

describe('birthday', () => {
  it('builds MM-DD, allows 29 February, rejects impossible days', () => {
    expect(birthdayFrom(3, 7)).toBe('03-07');
    expect(birthdayFrom(2, 29)).toBe('02-29');
    expect(birthdayFrom(2, 30)).toBeNull();
    expect(birthdayFrom(0, 5)).toBeNull();
    expect(birthdayFrom(5, 0)).toBeNull();
    expect(daysInMonth(6)).toBe(30);
    expect(daysInMonth(12)).toBe(31);
  });
  it('reads a stored birthday back', () => {
    expect(monthDayOf('11-02')).toEqual({ month: 11, day: 2 });
    expect(monthDayOf('1990-11-02')).toEqual({ month: 11, day: 2 });
    expect(monthDayOf(null)).toEqual({ month: 0, day: 0 });
  });
});

describe('draftFields', () => {
  it('trims, maps the cadence and keeps only valid dates', () => {
    expect(draftFields({ ...emptyDraft(), name: ' Amir ', title: ' Senior engineer ', cadence: 0, birthMonth: 9, birthDay: 4, startDate: '2024-02-01', emails: ' a@x.com ,, b@x.com ' })).toEqual({
      name: 'Amir', title: 'Senior engineer', relation: 'report', cadenceDays: null, birthday: '09-04', startDate: '2024-02-01', matchEmails: 'a@x.com, b@x.com',
    });
    expect(draftFields({ ...emptyDraft(), name: 'A', cadence: 30, startDate: 'nope' })).toMatchObject({ cadenceDays: 30, birthday: null, startDate: null, matchEmails: '' });
    expect(draftFields({ ...emptyDraft(), name: 'A', cadence: 500 }).cadenceDays).toBe(90);
  });
  it('defaults to a report met every 14 days', () => {
    expect(emptyDraft()).toMatchObject({ relation: 'report', cadence: 14, title: '' });
  });
});

describe('titleLine', () => {
  it('puts the position before the relation', () => {
    expect(titleLine({ title: 'Staff engineer', relation: 'report' })).toBe('Staff engineer · report');
    expect(titleLine({ title: '', relation: 'peer' })).toBe('peer');
    expect(titleLine({ title: '  ', relation: 'peer' })).toBe('peer');
  });
});

describe('proposed items text', () => {
  it('counts, pluralises and sums', () => {
    expect(reviewCardText(1)).toBe('Claude added 1 item for you to review');
    expect(reviewCardText(3)).toBe('Claude added 3 items for you to review');
    expect(inboxBadge(2, 5)).toBe(7);
    expect(proposedToast('Accepted', 1, 'Review RFC')).toBe('Accepted · Review RFC');
    expect(proposedToast('Dismissed', 4)).toBe('Dismissed · 4 items');
  });
});

describe('people palette', () => {
  const s = (id: string, name: string, title: string): PersonSummary => ({
    person: { id, handle: id, name, title, relation: 'report', cadenceDays: null, matchEmails: '', hiddenFromClaude: false, archived: false, notes: '', startDate: null, birthday: null },
    lastInteraction: null, openOwe: 0, openWait: 0, daysSinceLast: null, cadenceOverdue: false,
  });
  it('also finds people by their position', () => {
    const list = [s('a', 'Ana', 'Product manager'), s('b', 'Ben', 'Staff engineer')];
    expect(matchPeople(list, [], 'staff').map((x) => x.person.id)).toEqual(['b']);
  });
});
