import { describe, expect, it } from 'vitest';
import { cadenceOverdue, isHidden, isOverdue, isSlipping, isStaleWait, newItem } from '../src/core/pure';

const now = 1_800_000_000_000;
const DAY = 86_400_000;

describe('RulesTests', () => {
  it('slipping', () => {
    const i = newItem({ kind: 'task', title: 'x', now });
    expect(isSlipping(i)).toBe(false); i.snoozeCount = 3; expect(isSlipping(i)).toBe(true);
    i.status = 'done'; expect(isSlipping(i)).toBe(false);
  });
  it('stale wait, dated', () => {
    const due = now - 4 * DAY;
    const i = newItem({ kind: 'wait', title: 'x', dueAt: due, now: now - 10 * DAY });
    expect(isStaleWait(i, now)).toBe(true);
    i.lastTouchedAt = now - 3600_000;
    expect(isStaleWait(i, now), 'recent touch clears staleness').toBe(false);
    const fresh = newItem({ kind: 'wait', title: 'x', dueAt: now - DAY, now: now - 10 * DAY });
    expect(isStaleWait(fresh, now), 'only 1 day past due').toBe(false);
  });
  it('stale wait, undated', () => {
    expect(isStaleWait(newItem({ kind: 'wait', title: 'x', now: now - 6 * DAY }), now)).toBe(true);
    expect(isStaleWait(newItem({ kind: 'wait', title: 'x', now: now - 2 * DAY }), now)).toBe(false);
    expect(isStaleWait(newItem({ kind: 'owe', title: 'x', now: now - 9 * DAY }), now)).toBe(false);
  });
  it('stale wait uses the settings', () => {
    const i = newItem({ kind: 'wait', title: 'x', now: now - 2 * DAY });
    expect(isStaleWait(i, now, { staleDaysAfterDue: 3, staleDaysNoDue: 1 })).toBe(true);
  });
  it('cadence', () => {
    expect(cadenceOverdue(14, now - 23 * DAY, now)).toBe(true);
    expect(cadenceOverdue(14, now - 3 * DAY, now)).toBe(false);
    expect(cadenceOverdue(null, null, now)).toBe(false);
    expect(cadenceOverdue(14, null, now)).toBe(false);
  });
  it('overdue and hidden', () => {
    const noon = Date.UTC(2026, 9, 14, 12);
    expect(isOverdue({ status: 'open', dueAt: Date.UTC(2026, 9, 14), dueHasTime: false }, noon), 'today midnight, no time').toBe(false);
    expect(isOverdue({ status: 'open', dueAt: Date.UTC(2026, 9, 13), dueHasTime: false }, noon)).toBe(true);
    expect(isOverdue({ status: 'open', dueAt: Date.UTC(2026, 9, 14, 11), dueHasTime: true }, noon)).toBe(true);
    expect(isOverdue({ status: 'done', dueAt: Date.UTC(2026, 9, 1), dueHasTime: false }, noon)).toBe(false);
    expect(isHidden({ snoozedUntil: noon + 1 }, noon)).toBe(true);
    expect(isHidden({ snoozedUntil: noon }, noon)).toBe(false);
    expect(isHidden({ snoozedUntil: null }, noon)).toBe(false);
  });
});
