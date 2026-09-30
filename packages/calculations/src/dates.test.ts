import { describe, expect, it } from 'vitest';
import { addDaysIso, calendarDateIn, daysBetween } from './dates.js';

describe('dates', () => {
  it('computes the calendar date in a timezone, not in UTC', () => {
    // 03:30 UTC on Sep 4 is still the evening of Sep 3 in Los Angeles.
    expect(calendarDateIn(new Date('2026-09-04T03:30:00Z'), 'America/Los_Angeles')).toBe('2026-09-03');
    expect(calendarDateIn(new Date('2026-09-04T03:30:00Z'), 'UTC')).toBe('2026-09-04');
  });

  it('counts whole days across month ends', () => {
    expect(daysBetween('2026-08-28', '2026-09-03')).toBe(6);
    expect(daysBetween('2026-09-03', '2026-07-24')).toBe(-41);
  });

  it('adds days', () => {
    expect(addDaysIso('2026-08-30', 3)).toBe('2026-09-02');
  });
});
