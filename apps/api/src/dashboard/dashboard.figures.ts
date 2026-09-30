import { addDaysIso, daysBetween } from '@runtruck/calculations';
import type { DashboardActiveLoadsSummary, DashboardDeadheadSummary, DashboardRevenueDay, DashboardRevenueSummary } from '@runtruck/types';

// Pure rules behind GET /dashboard (docs/api/dashboard.md §2.2, §2.5; 03 §6.2). The
// repository returns raw set-based aggregates; these functions turn them into the wire
// figures. Dates are YYYY-MM-DD business days; nothing here reads a clock or a local Date.

// A known Monday, so the ISO weekday of a date is plain day arithmetic (03 §1.5).
const A_MONDAY = '1970-01-05';

export interface DashboardPeriods {
  // ClockService.today(ctx.timezone) (D4).
  today: string;
  // The org week: Monday–Sunday containing today.
  weekStart: string;
  weekEnd: string;
  // The org week before it.
  previousWeekStart: string;
  previousWeekEnd: string;
  // today − 7 … today − 1, oldest first (the revenue chart).
  chartDays: string[];
  // today − 7 (activeOn reference day of the "vs. last week" note).
  lastWeekDay: string;
}

// ISO weekday: Monday 1 … Sunday 7.
export function isoWeekday(date: string): number {
  return (((daysBetween(A_MONDAY, date) % 7) + 7) % 7) + 1;
}

export function dashboardPeriods(today: string): DashboardPeriods {
  const weekStart = addDaysIso(today, -((isoWeekday(today) + 6) % 7));
  const previousWeekStart = addDaysIso(weekStart, -7);
  return {
    today,
    weekStart,
    weekEnd: addDaysIso(weekStart, 6),
    previousWeekStart,
    previousWeekEnd: addDaysIso(weekStart, -1),
    chartDays: [7, 6, 5, 4, 3, 2, 1].map((n) => addDaysIso(today, -n)),
    lastWeekDay: addDaysIso(today, -7),
  };
}

// n / d rounded half away from zero, in exact integer arithmetic (d > 0):
// sign(n) × floor((2·|n| + d) / (2·d)).
export function roundHalfAwayFromZero(n: bigint, d: bigint): bigint {
  if (d <= 0n) throw new RangeError('The divisor must be positive');
  const abs = n < 0n ? -n : n;
  const q = (2n * abs + d) / (2n * d);
  return n < 0n ? -q : q;
}

// A bigint aggregate as a JSON number; sums of cents and miles stay far below 2^53.
export function toSafeNumber(value: bigint): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new Error('Aggregate out of the safe integer range');
  return n;
}

// "Active loads": the board count against activeOn(today − 7).
export function activeLoadsSummary(count: number, lastWeekCount: number): DashboardActiveLoadsSummary {
  return { count, lastWeekCount, deltaVsLastWeek: count - lastWeekCount };
}

// (this − previous) / previous in tenths of a percent, half away from zero; null without a base.
export function revenueChangeTenths(thisWeekCents: bigint, previousWeekCents: bigint): number | null {
  if (previousWeekCents === 0n) return null;
  return toSafeNumber(roundHalfAwayFromZero((thisWeekCents - previousWeekCents) * 1000n, previousWeekCents));
}

export interface RevenueDayTotal {
  // delivered_on (YYYY-MM-DD).
  day: string;
  revenueCents: bigint;
}

// The seven chart bars (zero days included) and the two week totals, from the per-day
// revenue sums of [previousWeekStart, weekEnd] (dashboard.md §2.7 query 3).
export function revenueFigures(
  days: readonly RevenueDayTotal[],
  periods: DashboardPeriods,
): { chart: DashboardRevenueDay[]; summary: DashboardRevenueSummary } {
  const byDay = new Map<string, bigint>();
  for (const d of days) byDay.set(d.day, (byDay.get(d.day) ?? 0n) + d.revenueCents);

  const sumBetween = (from: string, to: string): bigint => {
    let total = 0n;
    for (const [day, cents] of byDay) if (day >= from && day <= to) total += cents;
    return total;
  };
  const thisWeek = sumBetween(periods.weekStart, periods.weekEnd);
  const previousWeek = sumBetween(periods.previousWeekStart, periods.previousWeekEnd);

  return {
    chart: periods.chartDays.map((date) => ({ date, revenueCents: toSafeNumber(byDay.get(date) ?? 0n) })),
    summary: {
      thisWeekCents: toSafeNumber(thisWeek),
      previousWeekCents: toSafeNumber(previousWeek),
      changeTenthsOfPercent: revenueChangeTenths(thisWeek, previousWeek),
    },
  };
}

// Σ empty / Σ (loaded + empty) × 100 in tenths of a percent, rounded half up (both ≥ 0);
// null when there is no load or no mileage.
export function deadheadPercentTenths(emptyMiles: bigint, totalMiles: bigint): number | null {
  if (totalMiles === 0n) return null;
  return toSafeNumber(roundHalfAwayFromZero(1000n * emptyMiles, totalMiles));
}

export interface DeadheadWeekTotals {
  emptyMiles: bigint;
  totalMiles: bigint;
}

export function deadheadSummary(thisWeek: DeadheadWeekTotals | null, previousWeek: DeadheadWeekTotals | null): DashboardDeadheadSummary {
  const percentTenths = thisWeek ? deadheadPercentTenths(thisWeek.emptyMiles, thisWeek.totalMiles) : null;
  const previousWeekPercentTenths = previousWeek ? deadheadPercentTenths(previousWeek.emptyMiles, previousWeek.totalMiles) : null;
  return {
    percentTenths,
    previousWeekPercentTenths,
    pointsBetterTenths: percentTenths === null || previousWeekPercentTenths === null ? null : previousWeekPercentTenths - percentTenths,
  };
}
