import { describe, expect, it } from 'vitest';
import { Fmt, fmtBackLabel, fmtDue, fmtExact, fmtShort } from '../src/core/pure';

const now = Date.UTC(2026, 9, 14, 10); // Wed 14 Oct 2026 10:00
const at = (day: number, h?: number, m = 0) => Date.UTC(2026, 9, day, h ?? 0, m);
const item = (dueAt: number | null, dueHasTime = false) => ({ dueAt, dueHasTime });

describe('Fmt', () => {
  it('due wording', () => {
    expect(fmtDue(item(null), now, 'en-GB')).toBeNull();
    expect(fmtDue(item(at(14)), now, 'en-GB')).toBe('Today');
    expect(fmtDue(item(at(15)), now, 'en-GB')).toBe('Tomorrow');
    expect(fmtDue(item(at(13)), now, 'en-GB')).toBe('Yesterday');
    expect(fmtDue(item(at(16)), now, 'en-GB')).toBe('Fri');
    expect(fmtDue(item(at(20)), now, 'en-GB')).toBe('Tue');      // +6 days
    expect(fmtDue(item(at(21)), now, 'en-GB')).toBe('Oct 21');    // +7 days
    expect(fmtDue(item(at(8)), now, 'en-GB')).toBe('Thu');        // -6 days
    expect(fmtDue(item(at(7)), now, 'en-GB')).toBe('Oct 7');      // -7 days
  });
  it('time follows the locale clock', () => {
    expect(fmtDue(item(at(14, 15, 0), true), now, 'en-GB')).toBe('Today 15:00');
    expect(fmtDue(item(at(15, 9, 5), true), now, 'en-GB')).toBe('Tomorrow 09:05');
    expect(fmtDue(item(at(15, 15, 0), true), now, 'en-US')).toBe('Tomorrow 3:00 PM');
    expect(fmtDue(item(at(16, 0, 30), true), now, 'en-US')).toBe('Fri 12:30 AM');
  });
  it('exact', () => {
    expect(fmtExact(item(null))).toBeNull();
    expect(fmtExact(item(at(16)), 'en-GB')).toBe('Friday 16 October 2026');
    expect(fmtExact(item(at(16, 14, 30), true), 'en-GB')).toBe('Friday 16 October 2026, 14:30');
    expect(fmtExact(item(at(16, 14, 30), true), 'en-US')).toBe('Friday 16 October 2026, 2:30 PM');
  });
  it('back label', () => {
    expect(fmtBackLabel(at(14, 15), now, 'en-GB')).toBe('back 15:00');
    expect(fmtBackLabel(at(15, 9), now, 'en-GB')).toBe('back tomorrow 09:00');
    expect(fmtBackLabel(at(17, 9), now, 'en-GB')).toBe('back Sat');
    expect(fmtBackLabel(at(15, 9), now, 'en-US')).toBe('back tomorrow 9:00 AM');
  });
  it('short patterns', () => {
    expect(fmtShort(at(16, 14, 30), 'd MMM', 'en-GB')).toBe('16 Oct');
    expect(fmtShort(at(16, 14, 30), 'EEEE, d MMMM', 'en-GB')).toBe('Friday, 16 October');
    expect(fmtShort(at(6, 14, 30), 'yyyy-MM-dd')).toBe('2026-10-06');
    expect(fmtShort(at(16, 14, 30), 'd MMM HH:mm', 'en-GB')).toBe('16 Oct 14:30');
    expect(fmtShort(at(16, 14, 30), 'EEE d MMM HH:mm', 'en-US')).toBe('Fri 16 Oct 2:30 PM');
    expect(Fmt.short).toBe(fmtShort);
  });
});
