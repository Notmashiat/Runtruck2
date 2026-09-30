import { describe, expect, it } from 'vitest';
import {
  formatActivityTime,
  formatAge,
  formatDate,
  formatHos,
  formatInt,
  formatLoadNumber,
  formatMmYyyy,
  formatMoney,
  formatMoneyK,
  formatMoneyK1,
  formatMoneyM1,
  formatMoneyOrDash,
  formatMonthYear,
  formatRatePerMile,
  formatShortDate,
  formatSignedMoney,
  parseLoadNumber,
} from './format.js';

// Expected strings are Runtruck1's (docs/reference/runtruck1/data-model.md §2).
describe('money', () => {
  it('matches Runtruck1 money()', () => {
    expect(formatMoney(245_000)).toBe('$2,450');
    expect(formatMoney(3_490_000)).toBe('$34,900');
    expect(formatMoney(245_050)).toBe('$2,450.5'); // Runtruck1 quirk kept (D6)
  });

  it('signs and dashes', () => {
    expect(formatSignedMoney(-14_200)).toBe('-$142');
    expect(formatSignedMoney(0, true)).toBe('—');
    expect(formatMoneyOrDash(null)).toBe('—');
    expect(formatMoneyOrDash(-20_000)).toBe('-$200');
  });

  it('compact forms', () => {
    expect(formatMoneyK(41_200_000)).toBe('$412K');
    expect(formatMoneyK1(9_185_000)).toBe('$91.9K');
    expect(formatMoneyM1(129_500_000)).toBe('$1.3M');
  });

  it('rate per mile', () => {
    expect(formatRatePerMile(513)).toBe('$5.13');
    expect(formatRatePerMile(null)).toBe('—');
  });
});

describe('dates and times', () => {
  it('short and year-aware dates', () => {
    expect(formatShortDate('2026-09-03')).toBe('Sep 3');
    expect(formatDate('2026-01-12', '2026-09-03')).toBe('Jan 12');
    expect(formatDate('2022-03-14', '2026-09-03')).toBe('Mar 14, 2022');
    expect(formatMonthYear('2028-04-30')).toBe('Apr 2028');
    expect(formatMmYyyy('2028-04-30')).toBe('04/2028');
  });

  it('ages, HOS and counts', () => {
    expect(formatAge(41)).toBe('41 d');
    expect(formatAge(null)).toBe('—');
    expect(formatHos(380)).toBe('6h 20m');
    expect(formatHos(545)).toBe('9h 05m');
    expect(formatInt(41_200)).toBe('41,200');
  });

  it('activity time is "Today HH:MM" on the org business day', () => {
    // 07:12 in Los Angeles on Sep 3 = 14:12 UTC.
    expect(formatActivityTime('2026-09-03T14:12:00Z', 'America/Los_Angeles', '2026-09-03')).toBe('Today 07:12');
    expect(formatActivityTime('2026-09-02T21:05:00Z', 'America/Los_Angeles', '2026-09-03')).toBe('Sep 2 14:05');
  });
});

describe('human numbers', () => {
  it('formats and parses load numbers', () => {
    expect(formatLoadNumber(40223)).toBe('L-40223');
    expect(parseLoadNumber('L-40218')).toBe(40218);
    expect(parseLoadNumber('l-40218')).toBe(40218);
    expect(parseLoadNumber('40218')).toBeNull();
  });
});

describe('weekday and pay basis', () => {
  it('labels business dates with their weekday (2026-09-03 is a Thursday)', async () => {
    const { formatWeekdayShort } = await import('./format.js');
    expect(['2026-08-27', '2026-08-31', '2026-09-02', '2026-09-03'].map(formatWeekdayShort)).toEqual(['Thu', 'Mon', 'Wed', 'Thu']);
  });

  it('formats every pay basis like Runtruck1', async () => {
    const { formatPayBasis } = await import('./format.js');
    expect(formatPayBasis('per_mile', 62, null)).toBe('$0.62 / mi');
    expect(formatPayBasis('per_mile', 118, null)).toBe('$1.18 / mi');
    expect(formatPayBasis('percent_of_line_haul', null, 2500)).toBe('25% of line haul');
    expect(formatPayBasis('annual_salary', 6_800_000, null)).toBe('$68,000 / yr');
    expect(formatPayBasis('hourly', 3450, null)).toBe('$34.50 / hr');
  });
});
