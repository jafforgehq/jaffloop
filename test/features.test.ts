import { describe, expect, it } from 'vitest';
import { expandTemplate, linkify, nextOneOnOneAt, reviewMarkdown, upcomingLabel } from '../src/core/pure';
import { newItem, newPerson } from '../src/core/pure';
import type { CaptureTemplate, ReviewData } from '../src/shared/types';

const JIRA = 'https://acme.atlassian.net/browse/';
const DAY = 86_400_000;

describe('linkify', () => {
  it('plain text stays one segment, empty gives none', () => {
    expect(linkify('nothing to see', JIRA)).toEqual([{ text: 'nothing to see' }]);
    expect(linkify('', JIRA)).toEqual([]);
  });
  it('links a Jira key only when a base is set', () => {
    expect(linkify('Review PLAT-482 plan', JIRA)).toEqual([{ text: 'Review ' }, { text: 'PLAT-482', href: JIRA + 'PLAT-482' }, { text: ' plan' }]);
    expect(linkify('Review PLAT-482 plan', '')).toEqual([{ text: 'Review PLAT-482 plan' }]);
    expect(linkify('Review PLAT-482 plan', '   ')).toEqual([{ text: 'Review PLAT-482 plan' }]);
  });
  it('does not mistake lowercase, a bare prefix or glued words for keys', () => {
    for (const t of ['encode as utf-8 please', 'ABC- alone', 'ABC-', 'xABC-12', 'ABC-12x', 'A-1', 'foo-ABC-12', 'ABC-12-4']) {
      const hit = linkify(t, JIRA).filter((s) => s.href !== undefined).map((s) => s.text);
      expect(hit, t).toEqual(t === 'ABC-12-4' ? ['ABC-12'] : []);
    }
    expect(linkify('PRJ2-7', JIRA)).toEqual([{ text: 'PRJ2-7', href: JIRA + 'PRJ2-7' }]);
  });
  it('handles keys at the edges and next to punctuation', () => {
    expect(linkify('(PLAT-1)', JIRA)).toEqual([{ text: '(' }, { text: 'PLAT-1', href: JIRA + 'PLAT-1' }, { text: ')' }]);
    expect(linkify('PLAT-1, PLAT-2.', JIRA).map((s) => s.href)).toEqual([JIRA + 'PLAT-1', undefined, JIRA + 'PLAT-2', undefined]);
  });
  it('adds a slash to a base without one', () => {
    expect(linkify('PLAT-1', 'https://x.net/browse')[0]!.href).toBe('https://x.net/browse/PLAT-1');
    expect(linkify('PLAT-1', 'https://x.net/?key=')[0]!.href).toBe('https://x.net/?key=PLAT-1');
  });
  it('links URLs always and keeps trailing punctuation outside', () => {
    expect(linkify('Read https://example.com/rfc-12 before Friday', '')).toEqual([
      { text: 'Read ' }, { text: 'https://example.com/rfc-12', href: 'https://example.com/rfc-12' }, { text: ' before Friday' }]);
    for (const tail of ['.', ',', ';', ':', ')', '!', '?', ']', "'", '"', '.)', '?!']) {
      expect(linkify(`see https://a.io/x${tail}`, '')).toEqual([{ text: 'see ' }, { text: 'https://a.io/x', href: 'https://a.io/x' }, { text: tail }]);
    }
    expect(linkify('http://a.io/p?q=1&r=2#top', '')[0]).toEqual({ text: 'http://a.io/p?q=1&r=2#top', href: 'http://a.io/p?q=1&r=2#top' });
    expect(linkify('https://.', '')).toEqual([{ text: 'https://.' }]);
    expect(linkify('ftp://a.io', '')).toEqual([{ text: 'ftp://a.io' }]);
  });
  it('a key inside a URL is part of that link, not a second one', () => {
    expect(linkify('open https://acme.atlassian.net/browse/PLAT-9 now', JIRA)).toEqual([
      { text: 'open ' }, { text: 'https://acme.atlassian.net/browse/PLAT-9', href: 'https://acme.atlassian.net/browse/PLAT-9' }, { text: ' now' }]);
  });
  it('several keys and URLs in one title, text is preserved', () => {
    const t = 'PLAT-1 and PLAT-22 vs https://a.io/x, then https://b.io. Done (ABC-3)';
    const segs = linkify(t, JIRA);
    expect(segs.map((s) => s.text).join('')).toBe(t);
    expect(segs.filter((s) => s.href).map((s) => s.href)).toEqual([JIRA + 'PLAT-1', JIRA + 'PLAT-22', 'https://a.io/x', 'https://b.io', JIRA + 'ABC-3']);
    expect(segs.every((s, i) => i === 0 || s.href !== undefined || segs[i - 1]!.href !== undefined)).toBe(true); // plain runs are merged
  });
});

describe('expandTemplate', () => {
  const T: CaptureTemplate[] = [
    { name: 'prep', lines: ['bring @{person} how things are going', 'bring @{person} career goals', 'bring @{person} feedback'] },
    { name: 'fu', lines: ['wait @{person} {rest}', '', 'todo chase {person} about {rest}'] },
  ];
  it('expands every line with the handle, in order', () => {
    expect(expandTemplate('prep @sara', T)).toEqual(['bring @sara how things are going', 'bring @sara career goals', 'bring @sara feedback']);
  });
  it('{rest} is the text without the template word and the first @handle, and empty results are skipped', () => {
    expect(expandTemplate('fu @sara the API spec', T)).toEqual(['wait @sara the API spec', 'todo chase sara about the API spec']);
    expect(expandTemplate('fu the API spec @sara please', T)).toEqual(['wait @sara the API spec please', 'todo chase sara about the API spec please']);
    expect(expandTemplate('fu @sara', T)).toEqual(['wait @sara', 'todo chase sara about']);
    expect(expandTemplate('fu @sara see @amir', T)![0]).toBe('wait @sara see @amir');
  });
  it('template name is case-insensitive', () => {
    expect(expandTemplate('PREP @Sara', T)![0]).toBe('bring @Sara how things are going');
    expect(expandTemplate('Fu @a.b-c_d x', T)![0]).toBe('wait @a.b-c_d x');
    expect(expandTemplate('fu @sara', [{ name: 'FU', lines: ['x {person}'] }])).toEqual(['x sara']);
  });
  it('null without a template, without a handle, or when the template word is not first', () => {
    expect(expandTemplate('prep', T)).toBeNull();
    expect(expandTemplate('prep for sara', T)).toBeNull();
    expect(expandTemplate('prep @', T)).toBeNull();
    expect(expandTemplate('owe @sara thing', T)).toBeNull();
    expect(expandTemplate('please prep @sara', T)).toBeNull();
    expect(expandTemplate('', T)).toBeNull();
    expect(expandTemplate('prep@sara', T)).toBeNull();
    expect(expandTemplate('prep @sara', [])).toBeNull();
  });
  it('trailing punctuation does not end up in the handle', () => {
    expect(expandTemplate('prep @sara.', T)![0]).toBe('bring @sara how things are going');
  });
  it('a template without lines gives an empty list', () => {
    expect(expandTemplate('x @sara', [{ name: 'x', lines: [] }])).toEqual([]);
  });
});

describe('nextOneOnOneAt', () => {
  const now = Date.UTC(2026, 9, 15, 14, 30);
  const today = Date.UTC(2026, 9, 15);
  it('null without a cadence', () => {
    expect(nextOneOnOneAt(null, now - DAY, now)).toBeNull();
    expect(nextOneOnOneAt(null, null, now)).toBeNull();
  });
  it('never met or already overdue: start of today', () => {
    expect(nextOneOnOneAt(14, null, now)).toBe(today);
    expect(nextOneOnOneAt(7, now - 30 * DAY, now)).toBe(today);
  });
  it('otherwise the start of the day last + cadence', () => {
    expect(nextOneOnOneAt(14, now - 5 * DAY, now)).toBe(today + 9 * DAY);
    expect(nextOneOnOneAt(7, now - 7 * DAY, now)).toBe(today);       // due today
    expect(nextOneOnOneAt(7, now - 6 * DAY - 3_600_000, now)).toBe(today + DAY);
  });
});

describe('upcomingLabel', () => {
  const base = { personId: 'p', on: 0 };
  it('anniversary', () => {
    expect(upcomingLabel({ ...base, kind: 'anniversary', inDays: 3, years: 2 }, 'Sara')).toBe("Sara's 2-year work anniversary is in 3 days");
    expect(upcomingLabel({ ...base, kind: 'anniversary', inDays: 1, years: 1 }, 'Sara')).toBe("Sara's 1-year work anniversary is tomorrow");
    expect(upcomingLabel({ ...base, kind: 'anniversary', inDays: 0, years: 5 }, 'Sara')).toBe("Sara's 5-year work anniversary is today");
    expect(upcomingLabel({ ...base, kind: 'anniversary', inDays: 4, years: null }, 'Sara')).toBe("Sara's work anniversary is in 4 days");
  });
  it('birthday', () => {
    expect(upcomingLabel({ ...base, kind: 'birthday', inDays: 1, years: null }, 'Amir')).toBe("Amir's birthday is tomorrow");
    expect(upcomingLabel({ ...base, kind: 'birthday', inDays: 0, years: null }, 'Amir')).toBe("Amir's birthday is today");
    expect(upcomingLabel({ ...base, kind: 'birthday', inDays: 9, years: null }, 'Amir')).toBe("Amir's birthday is in 9 days");
  });
});

describe('reviewMarkdown', () => {
  const from = Date.UTC(2026, 9, 12), to = Date.UTC(2026, 9, 19);
  const sara = newPerson({ handle: 'sara', name: 'Sara', cadenceDays: 14, id: 'S' });
  const amir = newPerson({ handle: 'amir', name: 'Amir', id: 'A' });
  const names = { S: 'Sara', A: 'Amir' };
  const it_ = (title: string, o: Partial<ReturnType<typeof newItem>> = {}) => ({ ...newItem({ kind: 'owe', title, now: from }), ...o });
  const empty: ReviewData = { from, to, slipped: [], staleWaits: [], overduePromises: [], offCadence: [], closed: [], dropped: [], created: [], keptRate: { periodDays: 7, onTime: 0, late: 0, total: 0, rate: null } };

  it('an empty review is only the title', () => {
    expect(reviewMarkdown(empty, names)).toBe('## Week of 12 Oct to 18 Oct\n');
  });
  it('uses the given title', () => {
    expect(reviewMarkdown(empty, names, { title: '## My week' })).toBe('## My week\n');
  });
  it('full review: kept rate, done grouped by person, still open, waiting, needs attention', () => {
    const overdue = it_('Send timeline', { personId: 'S', dueAt: Date.UTC(2026, 9, 14) });
    const r: ReviewData = {
      ...empty,
      keptRate: { periodDays: 7, onTime: 11, late: 2, total: 13, rate: 11 / 13 },
      closed: [it_('Ship plan', { personId: 'S' }), it_('Buy cable'), it_('Share spec', { personId: 'A' }), it_('Review RFC', { personId: 'S' })],
      overduePromises: [overdue],
      slipped: [it_('Prep Q4', { snoozeCount: 3 }), overdue], // also slipped: listed once
      staleWaits: [it_('API spec', { kind: 'wait', personId: 'A' })],
      offCadence: [
        { person: sara, lastInteraction: null, openOwe: 0, openWait: 0, daysSinceLast: 23, cadenceOverdue: true },
        { person: amir, lastInteraction: null, openOwe: 0, openWait: 0, daysSinceLast: 1, cadenceOverdue: true },
        { person: { ...amir, id: 'Z', name: 'Zed' }, lastInteraction: null, openOwe: 0, openWait: 0, daysSinceLast: null, cadenceOverdue: true },
      ],
    };
    expect(reviewMarkdown(r, names)).toBe([
      '## Week of 12 Oct to 18 Oct', '',
      'Promises kept on time: 11 of 13 (85%)', '',
      '### Done', '- Share spec (Amir)', '- Ship plan (Sara)', '- Review RFC (Sara)', '- Buy cable', '',
      '### Still open', '- Send timeline (Sara), due 14 Oct', '- Prep Q4', '',
      '### Waiting on others', '- API spec (Amir)', '',
      '### Needs attention', '- Sara: last 1:1 23 days ago', '- Amir: last 1:1 1 day ago', '- Zed: no 1:1 yet', '',
    ].join('\n'));
  });
  it('omits the kept line when nothing was promised and empty sections', () => {
    const md = reviewMarkdown({ ...empty, closed: [it_('x', { personId: 'A' })] }, names);
    expect(md).toBe('## Week of 12 Oct to 18 Oct\n\n### Done\n- x (Amir)\n');
    expect(md).not.toContain('Promises kept');
  });
  it('is deterministic', () => {
    const r = { ...empty, closed: [it_('b', { personId: 'A' }), it_('a', { personId: 'A' })] };
    expect(reviewMarkdown(r, names)).toBe(reviewMarkdown(r, names));
    expect(reviewMarkdown(r, names)).toContain('- b (Amir)\n- a (Amir)');
  });
  it('a window ending mid-day shows that day', () => {
    expect(reviewMarkdown({ ...empty, to: Date.UTC(2026, 9, 15, 10) }, names)).toBe('## Week of 12 Oct to 15 Oct\n');
  });
});
