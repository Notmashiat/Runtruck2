import { describe, expect, it } from 'vitest';
import { orgWeek, yearStart } from './business-periods.js';

describe('orgWeek (Monday–Sunday containing today)', () => {
  it('is Aug 31 – Sep 6 for the demo day, Thursday 2026-09-03', () => {
    expect(orgWeek('2026-09-03')).toEqual({ weekStart: '2026-08-31', weekEnd: '2026-09-06' });
  });

  it('includes its own Monday and Sunday', () => {
    expect(orgWeek('2026-08-31')).toEqual({ weekStart: '2026-08-31', weekEnd: '2026-09-06' });
    expect(orgWeek('2026-09-06')).toEqual({ weekStart: '2026-08-31', weekEnd: '2026-09-06' });
    expect(orgWeek('2026-09-07')).toEqual({ weekStart: '2026-09-07', weekEnd: '2026-09-13' });
  });

  it('crosses month and year boundaries', () => {
    expect(orgWeek('2026-01-01')).toEqual({ weekStart: '2025-12-29', weekEnd: '2026-01-04' });
  });
});

describe('yearStart', () => {
  it('is January 1 of the year of today', () => {
    expect(yearStart('2026-09-03')).toBe('2026-01-01');
    expect(yearStart('2026-01-01')).toBe('2026-01-01');
  });
});
