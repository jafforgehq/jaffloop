// 0.5.0 sync health: per source_label counts over all items, and the last write by Claude from the audit log.
import { beforeEach, describe, expect, it } from 'vitest';
import { newItem, openMemoryDatabase, Store } from '../src/core';

const NOW = Date.UTC(2026, 9, 15, 9, 0, 0);
const DAY = 86_400_000;
let store: Store;
beforeEach(() => { store = new Store(openMemoryDatabase()); });

const add = (label: string | null, ago: number, o: { status?: 'done' | 'dropped'; proposed?: boolean } = {}): void => {
  const i = newItem({ kind: 'owe', title: `${label}-${ago}-${Math.random()}`, sourceLabel: label, now: NOW - ago, proposed: o.proposed ?? false });
  if (o.status) i.status = o.status;
  store.insertOnce(i);
};

describe('syncHealth', () => {
  it('is empty with no sources and no Claude write', () => {
    store.capture('todo plain');
    expect(store.syncHealth(NOW)).toEqual({ sources: [], lastClaudeWriteAt: null });
  });
  it('counts per label over every status, 7 days by created_at, newest source first', () => {
    add('outlook', 1 * DAY); add('outlook', 3 * DAY, { status: 'done' }); add('outlook', 20 * DAY, { status: 'dropped' });
    add('teams', 2 * DAY, { proposed: true });
    add('jira', 30 * DAY); add('jira', 40 * DAY);
    add(null, DAY);
    expect(store.syncHealth(NOW).sources).toEqual([
      { source: 'outlook', total: 3, last7Days: 2, lastAt: NOW - 1 * DAY },
      { source: 'teams', total: 1, last7Days: 1, lastAt: NOW - 2 * DAY },
      { source: 'jira', total: 2, last7Days: 0, lastAt: NOW - 30 * DAY },
    ]);
  });
  it('the 7 day window includes exactly 7 days back', () => {
    add('a', 7 * DAY); add('b', 7 * DAY + 1);
    const rows = store.syncHealth(NOW).sources;
    expect(rows.find((r) => r.source === 'a')!.last7Days).toBe(1);
    expect(rows.find((r) => r.source === 'b')!.last7Days).toBe(0);
  });
  it('lastClaudeWriteAt is the latest audited write, ignoring reads and blocked calls', () => {
    store.audit('list_items', 'x', false, NOW - 100);
    expect(store.syncHealth(NOW).lastClaudeWriteAt).toBeNull();
    store.audit('add_item', 'x', true, NOW - 5000);
    store.audit('add_items', 'y', true, NOW - 3000);
    store.audit('capture', 'blocked', false, NOW - 10);
    expect(store.syncHealth(NOW).lastClaudeWriteAt).toBe(NOW - 3000);
  });
});
