// dashboard view-model builders and label/tone maps: turn API DTOs into Runtruck1-shaped
// display rows. Shared by the web (rendering + live search) and the API (server-side q)
// so both match identically (docs/03-database.md §1.11). Specified in docs/api/dashboard.md.
//
// The Dashboard's table search runs over the Loads board rows (toLoadSearchRow, loads.ts);
// the dashboard's own table rows carry exactly the Runtruck1 `Load` keys the card shows, so
// matchesQuery over them can never match a uuid, cents or an enum value (dashboard.md §5.6).

import type {
  DashboardActiveLoad,
  DashboardDriver,
  DashboardDriverDutyStatus,
  DashboardRevenueDay,
  DashboardSummary,
} from '@runtruck/types';
import { EM_DASH, formatHos, formatLoadNumber, formatMoney, formatMoneyK, formatWeekdayShort } from '../format.js';
import { DUTY_LABEL } from './fleet.js';
import { LOAD_STATUS_LABEL, LOAD_STATUS_TONE, type LoadTone } from './loads.js';

// ---------------------------------------------------------------------------
// KPI row (dashboard.md §5.2)

export type DashboardKpiLabel = 'Active loads' | 'Revenue this week' | 'Deadhead miles' | 'Unbilled loads';

// One KPI tile without its click handler (the web adds navigation). While the data is
// pending or refused the value is "—" and there is no note (implementation-brief §4).
export interface DashboardKpiVm {
  label: DashboardKpiLabel;
  value: string;
  note?: string;
}

export const DASHBOARD_KPI_LABELS: readonly DashboardKpiLabel[] = ['Active loads', 'Revenue this week', 'Deadhead miles', 'Unbilled loads'];

// "+2 vs. last week" / "-3 vs. last week" / "+0 vs. last week".
export function formatActiveLoadsNote(deltaVsLastWeek: number): string {
  return `${deltaVsLastWeek >= 0 ? '+' : ''}${deltaVsLastWeek} vs. last week`;
}

// Tenths of a percent → "+37.4%" / "-0.1%"; "—" without a base.
export function formatSignedTenthsPercent(tenths: number | null): string {
  return tenths === null ? EM_DASH : `${tenths >= 0 ? '+' : ''}${(tenths / 10).toFixed(1)}%`;
}

// Tenths of a percent → "7.8%"; "—" without data.
export function formatTenthsPercent(tenths: number | null): string {
  return tenths === null ? EM_DASH : `${(tenths / 10).toFixed(1)}%`;
}

// Deadhead delta → "1.4 pts better" / "0.3 pts worse"; "—" when either week lacks data.
export function formatPointsBetter(tenths: number | null): string {
  return tenths === null ? EM_DASH : `${(Math.abs(tenths) / 10).toFixed(1)} pts ${tenths >= 0 ? 'better' : 'worse'}`;
}

export function dashboardKpis(summary: DashboardSummary | undefined): DashboardKpiVm[] {
  if (!summary) return DASHBOARD_KPI_LABELS.map((label) => ({ label, value: EM_DASH }));
  const { activeLoads, revenueThisWeek, deadheadMiles, unbilledLoads } = summary;
  return [
    { label: 'Active loads', value: String(activeLoads.count), note: formatActiveLoadsNote(activeLoads.deltaVsLastWeek) },
    {
      label: 'Revenue this week',
      value: formatMoneyK(revenueThisWeek.thisWeekCents),
      note: formatSignedTenthsPercent(revenueThisWeek.changeTenthsOfPercent),
    },
    {
      label: 'Deadhead miles',
      value: formatTenthsPercent(deadheadMiles.percentTenths),
      note: formatPointsBetter(deadheadMiles.pointsBetterTenths),
    },
    { label: 'Unbilled loads', value: String(unbilledLoads.count), note: `${formatMoney(unbilledLoads.amountCents)} waiting` },
  ];
}

// ---------------------------------------------------------------------------
// "Active loads" card (dashboard.md §5.3, §5.6)

// Runtruck1 `Load` keys of the fields the card shows (tone replaces tagClass). The same
// keys exist on the Loads board rows, so the card renders either kind of row.
export interface DashboardLoadRowVm {
  id: string;
  customer: string;
  route: string;
  rate: string;
  status: string;
  tone: LoadTone;
}

export function toDashboardRow(a: DashboardActiveLoad): DashboardLoadRowVm {
  return {
    id: formatLoadNumber(a.loadNumber),
    customer: a.customerName,
    route: a.route,
    rate: formatMoney(a.lineHaulCents),
    status: LOAD_STATUS_LABEL[a.status],
    tone: LOAD_STATUS_TONE[a.status],
  };
}

// ---------------------------------------------------------------------------
// "Revenue, last 7 days" card (dashboard.md §5.4). Heights and highlight are presentation.

export interface DashboardRevenueBarVm {
  // "Thu" … "Wed".
  day: string;
  // "42%"; every bar is "0%" when no day has revenue (Runtruck1 would render NaN%).
  h: string;
  // The maximum day(s) are primary, the others soft.
  fill: 'var(--ui-primary)' | 'var(--ui-primary-soft)';
}

export function dashboardRevenueChart(days: readonly DashboardRevenueDay[]): DashboardRevenueBarVm[] {
  const max = Math.max(...days.map((d) => d.revenueCents));
  return days.map((d) => ({
    day: formatWeekdayShort(d.date),
    h: `${max === 0 ? 0 : Math.round((d.revenueCents / max) * 100)}%`,
    fill: d.revenueCents === max ? 'var(--ui-primary)' : 'var(--ui-primary-soft)',
  }));
}

// ---------------------------------------------------------------------------
// "Drivers" card (dashboard.md §5.5)

export const DASHBOARD_DUTY_DOT: Readonly<Record<DashboardDriverDutyStatus, string>> = {
  on_duty: 'var(--ui-primary)',
  available: 'var(--ui-green)',
  home_time: 'var(--ui-muted)',
};

// Runtruck1 DRIVER_ROWS ({ name, note, dot }) plus the driver id as the React key.
export interface DashboardDriverRowVm {
  id: string;
  name: string;
  note: string;
  dot: string;
}

// "On duty · 6h 20m left" (HOS "—" when unknown) / "Available" / "Home time".
export function formatDashboardDriverNote(d: Pick<DashboardDriver, 'dutyStatus' | 'hosRemainingMinutes'>): string {
  return d.dutyStatus === 'on_duty' ? `On duty · ${formatHos(d.hosRemainingMinutes)} left` : DUTY_LABEL[d.dutyStatus];
}

export function toDashboardDriverRow(d: DashboardDriver): DashboardDriverRowVm {
  return { id: d.id, name: d.name, note: formatDashboardDriverNote(d), dot: DASHBOARD_DUTY_DOT[d.dutyStatus] };
}
