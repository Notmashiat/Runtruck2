import { describe, expect, it } from 'vitest';
import {
  activeLoadsSummary,
  dashboardPeriods,
  deadheadPercentTenths,
  deadheadSummary,
  isoWeekday,
  revenueChangeTenths,
  revenueFigures,
  roundHalfAwayFromZero,
  toSafeNumber,
} from '../dashboard.figures.js';

// docs/api/dashboard.md §2.2 (periods), §2.5 (summary rules), §2.11 item 6.

describe('dashboardPeriods', () => {
  it('derives the seed periods for Thursday 2026-09-03 (§2.2)', () => {
    expect(dashboardPeriods('2026-09-03')).toEqual({
      today: '2026-09-03',
      weekStart: '2026-08-31',
      weekEnd: '2026-09-06',
      previousWeekStart: '2026-08-24',
      previousWeekEnd: '2026-08-30',
      chartDays: ['2026-08-27', '2026-08-28', '2026-08-29', '2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02'],
      lastWeekDay: '2026-08-27',
    });
  });

  it('puts every weekday of a week in the same Monday–Sunday org week', () => {
    const days = ['2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06'];
    days.forEach((day, i) => {
      expect(isoWeekday(day)).toBe(i + 1);
      const p = dashboardPeriods(day);
      expect([p.weekStart, p.weekEnd, p.previousWeekStart, p.previousWeekEnd]).toEqual([
        '2026-08-31',
        '2026-09-06',
        '2026-08-24',
        '2026-08-30',
      ]);
    });
    expect(dashboardPeriods('2026-09-07').weekStart).toBe('2026-09-07');
  });

  it('crosses month and year boundaries, and handles dates before the reference Monday', () => {
    expect(dashboardPeriods('2027-01-01')).toMatchObject({
      weekStart: '2026-12-28',
      weekEnd: '2027-01-03',
      previousWeekStart: '2026-12-21',
    });
    expect(dashboardPeriods('2028-03-01')).toMatchObject({ weekStart: '2028-02-28', weekEnd: '2028-03-05' });
    expect(isoWeekday('1969-12-31')).toBe(3);
    expect(dashboardPeriods('1900-01-01').weekStart).toBe('1900-01-01');
  });

  it('labels the chart range Thu … Wed for the seed day', () => {
    const labels = dashboardPeriods('2026-09-03').chartDays.map((d) =>
      new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`)),
    );
    expect(labels).toEqual(['Thu', 'Fri', 'Sat', 'Sun', 'Mon', 'Tue', 'Wed']);
  });
});

describe('roundHalfAwayFromZero', () => {
  it('rounds halves away from zero on both sides', () => {
    expect(roundHalfAwayFromZero(5n, 10n)).toBe(1n);
    expect(roundHalfAwayFromZero(-5n, 10n)).toBe(-1n);
    expect(roundHalfAwayFromZero(4n, 10n)).toBe(0n);
    expect(roundHalfAwayFromZero(-4n, 10n)).toBe(0n);
    expect(roundHalfAwayFromZero(15n, 10n)).toBe(2n);
    expect(roundHalfAwayFromZero(-15n, 10n)).toBe(-2n);
    expect(roundHalfAwayFromZero(0n, 7n)).toBe(0n);
  });

  it('refuses a non-positive divisor', () => {
    expect(() => roundHalfAwayFromZero(1n, 0n)).toThrow(RangeError);
  });
});

describe('revenueChangeTenths', () => {
  it('gives +37.4 % for the seed weeks (§2.5)', () => {
    expect(revenueChangeTenths(2_468_000n, 1_796_000n)).toBe(374);
  });

  it('rounds −0.05 % to −1 tenth and +0.05 % to +1 tenth (half away from zero)', () => {
    expect(revenueChangeTenths(99_950n, 100_000n)).toBe(-1);
    expect(revenueChangeTenths(100_050n, 100_000n)).toBe(1);
    expect(revenueChangeTenths(99_960n, 100_000n)).toBe(0);
  });

  it('gives negative changes and −100 % for an empty week', () => {
    expect(revenueChangeTenths(1_796_000n, 2_468_000n)).toBe(-272);
    expect(revenueChangeTenths(0n, 500n)).toBe(-1000);
  });

  it('is null when the previous week had no revenue', () => {
    expect(revenueChangeTenths(0n, 0n)).toBeNull();
    expect(revenueChangeTenths(441_000n, 0n)).toBeNull();
  });
});

describe('revenueFigures', () => {
  const periods = dashboardPeriods('2026-09-03');
  const seedDays = [
    ['2026-08-27', 441_000n],
    ['2026-08-28', 305_000n],
    ['2026-08-29', 276_000n],
    ['2026-08-30', 774_000n],
    ['2026-08-31', 486_000n],
    ['2026-09-01', 930_000n],
    ['2026-09-02', 1_052_000n],
  ] as const;

  it('builds the seven bars and both week totals of the seed (§2.4, §2.5)', () => {
    const { chart, summary } = revenueFigures(
      seedDays.map(([day, revenueCents]) => ({ day, revenueCents })),
      periods,
    );
    expect(chart).toEqual(seedDays.map(([date, cents]) => ({ date, revenueCents: Number(cents) })));
    expect(summary).toEqual({ thisWeekCents: 2_468_000, previousWeekCents: 1_796_000, changeTenthsOfPercent: 374 });
  });

  it('fills days without deliveries with 0 and counts days outside the chart in their week', () => {
    const { chart, summary } = revenueFigures(
      [
        { day: '2026-08-24', revenueCents: 100n },
        { day: '2026-09-01', revenueCents: 250n },
        { day: '2026-09-05', revenueCents: 50n },
      ],
      periods,
    );
    expect(chart.map((d) => d.revenueCents)).toEqual([0, 0, 0, 0, 0, 250, 0]);
    expect(summary).toEqual({ thisWeekCents: 300, previousWeekCents: 100, changeTenthsOfPercent: 2000 });
  });

  it('gives seven zero days and a null change for an organization without deliveries (§2.8)', () => {
    const { chart, summary } = revenueFigures([], periods);
    expect(chart).toEqual(periods.chartDays.map((date) => ({ date, revenueCents: 0 })));
    expect(summary).toEqual({ thisWeekCents: 0, previousWeekCents: 0, changeTenthsOfPercent: null });
  });
});

describe('deadhead', () => {
  it('gives 7.8 % this week, 9.2 % last week and 1.4 pts better for the seed (§2.5)', () => {
    expect(deadheadPercentTenths(258n, 3_312n)).toBe(78);
    expect(deadheadPercentTenths(116n, 1_258n)).toBe(92);
    expect(deadheadSummary({ emptyMiles: 258n, totalMiles: 3_312n }, { emptyMiles: 116n, totalMiles: 1_258n })).toEqual({
      percentTenths: 78,
      previousWeekPercentTenths: 92,
      pointsBetterTenths: 14,
    });
  });

  it('rounds half up', () => {
    expect(deadheadPercentTenths(1n, 2_000n)).toBe(1);
    expect(deadheadPercentTenths(1n, 2_001n)).toBe(0);
  });

  it('is null without loads or mileage, and the delta is null when either week is null', () => {
    expect(deadheadPercentTenths(0n, 0n)).toBeNull();
    expect(deadheadSummary(null, null)).toEqual({ percentTenths: null, previousWeekPercentTenths: null, pointsBetterTenths: null });
    expect(deadheadSummary({ emptyMiles: 20n, totalMiles: 260n }, null)).toEqual({
      percentTenths: 77,
      previousWeekPercentTenths: null,
      pointsBetterTenths: null,
    });
    expect(deadheadSummary(null, { emptyMiles: 116n, totalMiles: 1_258n })).toEqual({
      percentTenths: null,
      previousWeekPercentTenths: 92,
      pointsBetterTenths: null,
    });
  });

  it('gives a negative delta when this week is worse', () => {
    expect(deadheadSummary({ emptyMiles: 116n, totalMiles: 1_258n }, { emptyMiles: 258n, totalMiles: 3_312n }).pointsBetterTenths).toBe(
      -14,
    );
  });
});

describe('activeLoadsSummary', () => {
  it('computes the delta against last week, negative included', () => {
    expect(activeLoadsSummary(5, 3)).toEqual({ count: 5, lastWeekCount: 3, deltaVsLastWeek: 2 });
    expect(activeLoadsSummary(1, 4)).toEqual({ count: 1, lastWeekCount: 4, deltaVsLastWeek: -3 });
    expect(activeLoadsSummary(0, 0)).toEqual({ count: 0, lastWeekCount: 0, deltaVsLastWeek: 0 });
  });
});

describe('toSafeNumber', () => {
  it('converts safe integers and refuses anything larger', () => {
    expect(toSafeNumber(3_490_000n)).toBe(3_490_000);
    expect(() => toSafeNumber(2n ** 60n)).toThrow();
  });
});
