import { describe, expect, it } from 'vitest';
import { newItem } from '../src/core/pure';
import { nextTrayText } from '../src/main/tray-text';

// TZ=UTC. Wed 2026-10-14 10:00
const at = (d: string, h = 0, m = 0) => new Date(`${d}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`).getTime();
const NOW = at('2026-10-14', 10);
const people = new Map([['p1', 'Sara Lindqvist'], ['p2', 'Amir Haddad']]);
const text = (items: ReturnType<typeof newItem>[]) => nextTrayText(items, people, NOW, 'en-GB');
const mk = (o: Partial<Parameters<typeof newItem>[0]>) => newItem({ kind: 'owe', title: 't', now: NOW, ...o });

describe('nextTrayText', () => {
  it('names kind, first name and the day', () => {
    expect(text([mk({ personId: 'p1', dueAt: at('2026-10-16') })])).toBe('owe Sara · Fri');
    expect(text([mk({ personId: 'p1', dueAt: at('2026-10-15') })])).toBe('owe Sara · Tomorrow');
    expect(text([mk({ kind: 'wait', personId: 'p2', dueAt: at('2026-10-14') })])).toBe('wait Amir · Today');
  });
  it('shows the time for a timed item due today', () => {
    expect(text([mk({ personId: 'p1', dueAt: at('2026-10-14', 15), dueHasTime: true })])).toBe('owe Sara · 15:00');
  });
  it('uses the title without a person, cut at 24 characters with an ellipsis', () => {
    expect(text([mk({ kind: 'task', title: 'Book flights', dueAt: at('2026-10-15') })])).toBe('task Book flights');
    const t = text([mk({ kind: 'task', title: 'Write the quarterly planning document', dueAt: at('2026-10-15') })])!;
    expect(t).toHaveLength(24);
    expect(t.endsWith('…')).toBe(true);
  });
  it('picks overdue first, then the earliest due; ignores undated, snoozed and closed items', () => {
    const soon = mk({ personId: 'p2', dueAt: at('2026-10-14') });
    const late = mk({ personId: 'p1', dueAt: at('2026-10-12') });
    const timedOverdue = mk({ personId: 'p1', title: 'x', dueAt: at('2026-10-14', 9), dueHasTime: true });
    expect(text([soon, late])).toBe('owe Sara · Mon');
    expect(text([soon, timedOverdue])).toBe('owe Sara · 09:00');
    const undated = mk({ personId: 'p1' });
    const snoozed = mk({ personId: 'p1', dueAt: at('2026-10-11'), snoozedUntil: NOW + 3600_000 });
    const done = mk({ personId: 'p1', dueAt: at('2026-10-11'), status: 'done' });
    expect(text([undated, snoozed, done])).toBeNull();
    expect(text([undated, snoozed, done, soon])).toBe('owe Amir · Today');
  });
});
