import type { DashboardActiveLoad, DashboardDriver, DashboardRevenueDay, DashboardSummary } from '@runtruck/types';
import { describe, expect, it } from 'vitest';
import {
  dashboardKpis,
  dashboardRevenueChart,
  formatActiveLoadsNote,
  formatPointsBetter,
  formatSignedTenthsPercent,
  formatTenthsPercent,
  toDashboardDriverRow,
  toDashboardRow,
} from './dashboard.js';

// Runtruck1 display strings for the seeded GET /dashboard response (docs/api/dashboard.md
// §4, §5; core-pages §2.3).

const SEED_SUMMARY: DashboardSummary = {
  activeLoads: { count: 5, lastWeekCount: 3, deltaVsLastWeek: 2 },
  revenueThisWeek: { thisWeekCents: 2_468_000, previousWeekCents: 1_796_000, changeTenthsOfPercent: 374 },
  deadheadMiles: { percentTenths: 78, previousWeekPercentTenths: 92, pointsBetterTenths: 14 },
  unbilledLoads: { count: 11, amountCents: 3_490_000 },
};

const EMPTY_SUMMARY: DashboardSummary = {
  activeLoads: { count: 0, lastWeekCount: 0, deltaVsLastWeek: 0 },
  revenueThisWeek: { thisWeekCents: 0, previousWeekCents: 0, changeTenthsOfPercent: null },
  deadheadMiles: { percentTenths: null, previousWeekPercentTenths: null, pointsBetterTenths: null },
  unbilledLoads: { count: 0, amountCents: 0 },
};

const load = (
  loadNumber: number,
  customerName: string,
  route: string,
  lineHaulCents: number,
  status: DashboardActiveLoad['status'],
): DashboardActiveLoad => ({
  id: `00000000-0000-4000-8000-0000000${loadNumber}`,
  loadNumber,
  customerName,
  route,
  lineHaulCents,
  status,
});

describe('dashboardKpis', () => {
  it('renders the seeded tiles (§4: +2, $25K, +37.4%, 7.8%, 1.4 pts better, 11, $34,900 waiting)', () => {
    expect(dashboardKpis(SEED_SUMMARY)).toEqual([
      { label: 'Active loads', value: '5', note: '+2 vs. last week' },
      { label: 'Revenue this week', value: '$25K', note: '+37.4%' },
      { label: 'Deadhead miles', value: '7.8%', note: '1.4 pts better' },
      { label: 'Unbilled loads', value: '11', note: '$34,900 waiting' },
    ]);
  });

  it('renders an empty organization as §4.1', () => {
    expect(dashboardKpis(EMPTY_SUMMARY)).toEqual([
      { label: 'Active loads', value: '0', note: '+0 vs. last week' },
      { label: 'Revenue this week', value: '$0K', note: '—' },
      { label: 'Deadhead miles', value: '—', note: '—' },
      { label: 'Unbilled loads', value: '0', note: '$0 waiting' },
    ]);
  });

  it('shows "—" and no note while pending or refused', () => {
    expect(dashboardKpis(undefined)).toEqual([
      { label: 'Active loads', value: '—' },
      { label: 'Revenue this week', value: '—' },
      { label: 'Deadhead miles', value: '—' },
      { label: 'Unbilled loads', value: '—' },
    ]);
  });

  it('formats negative and zero deltas', () => {
    expect(formatActiveLoadsNote(-3)).toBe('-3 vs. last week');
    expect(formatActiveLoadsNote(0)).toBe('+0 vs. last week');
    expect(formatSignedTenthsPercent(-1)).toBe('-0.1%');
    expect(formatSignedTenthsPercent(0)).toBe('+0.0%');
    expect(formatSignedTenthsPercent(-1000)).toBe('-100.0%');
    expect(formatTenthsPercent(0)).toBe('0.0%');
    expect(formatPointsBetter(-3)).toBe('0.3 pts worse');
    expect(formatPointsBetter(0)).toBe('0.0 pts better');
    expect(formatPointsBetter(null)).toBe('—');
  });
});

describe('toDashboardRow', () => {
  it('maps the seeded active loads to Runtruck1 rows (core-pages §2.3 B)', () => {
    const rows = [
      load(40218, 'Northgate Foods', 'Fresno, CA → Reno, NV', 245_000, 'in_transit'),
      load(40219, 'Bayline Distribution', 'Stockton, CA → Salt Lake City, UT', 318_000, 'at_pickup'),
      load(40220, 'Cascade Building Supply', 'Sacramento, CA → Boise, ID', 291_000, 'delayed'),
      load(40221, 'Harbor Point Retail', 'Oakland, CA → Portland, OR', 354_000, 'needs_driver'),
      load(40222, 'Cascade Building Supply', 'Redding, CA → Seattle, WA', 276_000, 'dispatched'),
    ].map(toDashboardRow);
    expect(rows).toEqual([
      { id: 'L-40218', customer: 'Northgate Foods', route: 'Fresno, CA → Reno, NV', rate: '$2,450', status: 'In transit', tone: 'blue' },
      {
        id: 'L-40219',
        customer: 'Bayline Distribution',
        route: 'Stockton, CA → Salt Lake City, UT',
        rate: '$3,180',
        status: 'At pickup',
        tone: 'gray',
      },
      {
        id: 'L-40220',
        customer: 'Cascade Building Supply',
        route: 'Sacramento, CA → Boise, ID',
        rate: '$2,910',
        status: 'Delayed',
        tone: 'amber',
      },
      {
        id: 'L-40221',
        customer: 'Harbor Point Retail',
        route: 'Oakland, CA → Portland, OR',
        rate: '$3,540',
        status: 'Needs driver',
        tone: 'amber',
      },
      {
        id: 'L-40222',
        customer: 'Cascade Building Supply',
        route: 'Redding, CA → Seattle, WA',
        rate: '$2,760',
        status: 'Dispatched',
        tone: 'gray',
      },
    ]);
  });

  it('carries no uuid, cents or enum value that search could match', () => {
    const row = toDashboardRow(load(40218, 'Northgate Foods', 'Fresno, CA → Reno, NV', 245_000, 'in_transit'));
    expect(Object.keys(row).sort()).toEqual(['customer', 'id', 'rate', 'route', 'status', 'tone']);
    const values = Object.values(row).join(' ');
    expect(values).not.toContain('00000000');
    expect(values).not.toContain('245000');
    expect(values).not.toContain('in_transit');
  });
});

describe('dashboardRevenueChart', () => {
  it('labels the seeded days Thu … Wed with computed heights, Wed primary (§2.4)', () => {
    const days: DashboardRevenueDay[] = [
      { date: '2026-08-27', revenueCents: 441_000 },
      { date: '2026-08-28', revenueCents: 305_000 },
      { date: '2026-08-29', revenueCents: 276_000 },
      { date: '2026-08-30', revenueCents: 774_000 },
      { date: '2026-08-31', revenueCents: 486_000 },
      { date: '2026-09-01', revenueCents: 930_000 },
      { date: '2026-09-02', revenueCents: 1_052_000 },
    ];
    const soft = 'var(--ui-primary-soft)';
    expect(dashboardRevenueChart(days)).toEqual([
      { day: 'Thu', h: '42%', fill: soft },
      { day: 'Fri', h: '29%', fill: soft },
      { day: 'Sat', h: '26%', fill: soft },
      { day: 'Sun', h: '74%', fill: soft },
      { day: 'Mon', h: '46%', fill: soft },
      { day: 'Tue', h: '88%', fill: soft },
      { day: 'Wed', h: '100%', fill: 'var(--ui-primary)' },
    ]);
  });

  it('highlights every bar equal to the maximum', () => {
    const chart = dashboardRevenueChart([
      { date: '2026-08-31', revenueCents: 500 },
      { date: '2026-09-01', revenueCents: 250 },
      { date: '2026-09-02', revenueCents: 500 },
    ]);
    expect(chart.map((c) => [c.h, c.fill])).toEqual([
      ['100%', 'var(--ui-primary)'],
      ['50%', 'var(--ui-primary-soft)'],
      ['100%', 'var(--ui-primary)'],
    ]);
  });

  it('renders seven 0% primary bars when nothing was delivered (§4.1)', () => {
    const days = ['2026-08-27', '2026-08-28', '2026-08-29', '2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02'].map((date) => ({
      date,
      revenueCents: 0,
    }));
    expect(dashboardRevenueChart(days).map((c) => [c.h, c.fill])).toEqual(days.map(() => ['0%', 'var(--ui-primary)']));
  });
});

describe('toDashboardDriverRow', () => {
  it('renders the seeded roster notes and dots (core-pages §2.3 D)', () => {
    const drivers: DashboardDriver[] = [
      { id: 'a', name: 'Marcus Hale', dutyStatus: 'on_duty', hosRemainingMinutes: 380 },
      { id: 'b', name: 'Dara Whitfield', dutyStatus: 'on_duty', hosRemainingMinutes: 545 },
      { id: 'c', name: 'Ellis Nakamura', dutyStatus: 'on_duty', hosRemainingMinutes: 105 },
      { id: 'd', name: 'Priya Raman', dutyStatus: 'available', hosRemainingMinutes: 660 },
      { id: 'e', name: 'Ana Cortez', dutyStatus: 'available', hosRemainingMinutes: 660 },
      { id: 'f', name: 'Tobias Frey', dutyStatus: 'home_time', hosRemainingMinutes: null },
    ];
    expect(drivers.map(toDashboardDriverRow)).toEqual([
      { id: 'a', name: 'Marcus Hale', note: 'On duty · 6h 20m left', dot: 'var(--ui-primary)' },
      { id: 'b', name: 'Dara Whitfield', note: 'On duty · 9h 05m left', dot: 'var(--ui-primary)' },
      { id: 'c', name: 'Ellis Nakamura', note: 'On duty · 1h 45m left', dot: 'var(--ui-primary)' },
      { id: 'd', name: 'Priya Raman', note: 'Available', dot: 'var(--ui-green)' },
      { id: 'e', name: 'Ana Cortez', note: 'Available', dot: 'var(--ui-green)' },
      { id: 'f', name: 'Tobias Frey', note: 'Home time', dot: 'var(--ui-muted)' },
    ]);
  });

  it('prints "—" for an on-duty driver without HOS data', () => {
    expect(toDashboardDriverRow({ id: 'x', name: 'X', dutyStatus: 'on_duty', hosRemainingMinutes: null }).note).toBe('On duty · — left');
  });
});
