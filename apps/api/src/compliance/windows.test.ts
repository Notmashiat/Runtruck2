import { describe, expect, it } from 'vitest';
import { doneWindowStart, expiringWindowEnd, oneYearBefore, orgWeek, pointsWindowStart, quarterStart, yearStart } from './windows.js';

// docs/api/hr.md §1.1 and docs/api/safety.md §1.1, against the pinned demo day and edges.

describe('business windows', () => {
  it('computes the seed windows for 2026-09-03', () => {
    const today = '2026-09-03';
    expect(orgWeek(today)).toEqual({ weekStart: '2026-08-31', weekEnd: '2026-09-06' });
    expect(quarterStart(today)).toBe('2026-07-01');
    expect(yearStart(today)).toBe('2026-01-01');
    expect(doneWindowStart(today)).toBe('2026-08-04');
    expect(expiringWindowEnd(today)).toBe('2026-11-02');
    expect(pointsWindowStart(today)).toBe('2025-09-04');
  });

  it('keeps the org week Monday–Sunday on its edges', () => {
    expect(orgWeek('2026-08-31')).toEqual({ weekStart: '2026-08-31', weekEnd: '2026-09-06' }); // Monday
    expect(orgWeek('2026-09-06')).toEqual({ weekStart: '2026-08-31', weekEnd: '2026-09-06' }); // Sunday
    expect(orgWeek('2026-09-07')).toEqual({ weekStart: '2026-09-07', weekEnd: '2026-09-13' }); // next Monday
    expect(orgWeek('2027-01-01')).toEqual({ weekStart: '2026-12-28', weekEnd: '2027-01-03' }); // across a year
  });

  it('starts each quarter on its first month', () => {
    expect(['2026-01-01', '2026-03-31', '2026-04-01', '2026-06-30', '2026-07-01', '2026-10-15', '2026-12-31'].map(quarterStart)).toEqual([
      '2026-01-01',
      '2026-01-01',
      '2026-04-01',
      '2026-04-01',
      '2026-07-01',
      '2026-10-01',
      '2026-10-01',
    ]);
  });

  it('steps a year back, turning Feb 29 into Feb 28', () => {
    expect(oneYearBefore('2026-09-03')).toBe('2025-09-03');
    expect(oneYearBefore('2028-02-29')).toBe('2027-02-28');
    expect(pointsWindowStart('2028-02-29')).toBe('2027-03-01');
    expect(oneYearBefore('2027-03-01')).toBe('2026-03-01');
  });

  it('crosses month and year boundaries', () => {
    expect(doneWindowStart('2026-01-15')).toBe('2025-12-16');
    expect(expiringWindowEnd('2026-12-15')).toBe('2027-02-13');
  });
});
