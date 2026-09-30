// Dashboard wire types: GET /api/v1/dashboard (/app/dashboard).
// Specified in docs/api/dashboard.md; every figure is computed from stored rows (D5,
// docs/03-database.md §6.2). Raw values only: the web formats them with
// @runtruck/calculations and maps enums to Runtruck1's labels and chip tones.

import type { ApiSuccess } from './api.js';
import type { DriverDutyStatus } from './fleet.js';

// The `load_status` values Runtruck1 calls ACTIVE_STATUSES (03 §6.0.3). The table
// only ever holds active loads, so the type is narrowed to them.
export type DashboardActiveLoadStatus = 'needs_driver' | 'dispatched' | 'at_pickup' | 'in_transit' | 'delayed';

// The `driver_duty_status` enum (03 §4.3): an alias of the canonical union (fleet.ts).
export type DashboardDriverDutyStatus = DriverDutyStatus;

// One row of the "Active loads" card: a board load in an active status.
export interface DashboardActiveLoad {
  // loads.id; the web links by load number, never shows or searches the UUID.
  id: string;
  // loads.load_number (formatted "L-40218" by the web).
  loadNumber: number;
  // customers.name of loads.customer_id.
  customerName: string;
  // Display-ready route "Fresno, CA → Reno, NV" (03 §6.0.3), identical to GET /loads `route`.
  route: string;
  // loads.line_haul_cents (the "Rate" column).
  lineHaulCents: number;
  status: DashboardActiveLoadStatus;
}

// One bar of "Revenue, last 7 days": a calendar day in the organization's timezone.
export interface DashboardRevenueDay {
  // YYYY-MM-DD, today − 7 … today − 1; the web labels it with its short weekday ("Thu").
  date: string;
  // Σ revenue(l) (line haul + fuel surcharge + accessorials) of loads with delivered_on = date.
  revenueCents: number;
}

// One row of the "Drivers" card.
export interface DashboardDriver {
  // drivers.id (React key only).
  id: string;
  // employees.first_name + " " + employees.last_name.
  name: string;
  dutyStatus: DashboardDriverDutyStatus;
  // drivers.hos_remaining_minutes; null renders "—".
  hosRemainingMinutes: number | null;
}

// "Active loads" KPI.
export interface DashboardActiveLoadsSummary {
  // Board loads (archived_at is null) in an active status.
  count: number;
  // activeOn(today − 7): loads (board or archived) whose first pickup date ≤ D ≤ last delivery date.
  lastWeekCount: number;
  // count − lastWeekCount; the note prints it with a "+" when ≥ 0.
  deltaVsLastWeek: number;
}

// "Revenue this week" KPI.
export interface DashboardRevenueSummary {
  // Σ revenue(l) of loads whose delivered_on is in the org week (Mon–Sun containing today).
  thisWeekCents: number;
  // The same sum over the previous org week.
  previousWeekCents: number;
  // (this − previous) / previous in tenths of a percent, rounded half away from zero
  // (374 = +37.4 %); null when previousWeekCents is 0.
  changeTenthsOfPercent: number | null;
}

// "Deadhead miles" KPI.
export interface DashboardDeadheadSummary {
  // Σ empty_miles / Σ (loaded_miles + empty_miles) × 100 in tenths of a percent (78 = 7.8 %),
  // over loads whose first pickup is in the org week and whose two mile columns are set;
  // null when there is no such load or the mile total is 0.
  percentTenths: number | null;
  // The same over the previous org week.
  previousWeekPercentTenths: number | null;
  // previousWeekPercentTenths − percentTenths (14 = "1.4 pts better"); null when either is null.
  pointsBetterTenths: number | null;
}

// "Unbilled loads" KPI: uninvoiced loads (03 §6.0.4), the same rule as GET /billing/uninvoiced-loads.
export interface DashboardUnbilledSummary {
  count: number;
  // Σ revenue(l) of those loads.
  amountCents: number;
}

// meta.summary: the four KPI tiles. They ignore any search text.
export interface DashboardSummary {
  activeLoads: DashboardActiveLoadsSummary;
  revenueThisWeek: DashboardRevenueSummary;
  deadheadMiles: DashboardDeadheadSummary;
  unbilledLoads: DashboardUnbilledSummary;
}

export interface DashboardData {
  // At most 6 active board loads in board order (created_at DESC, load_number DESC).
  activeLoads: DashboardActiveLoad[];
  // Exactly 7 days, oldest first (today − 7 … today − 1), zero-revenue days included.
  revenueLastSevenDays: DashboardRevenueDay[];
  // Every driver in roster order (drivers.position).
  drivers: DashboardDriver[];
}

export interface DashboardMeta {
  // The organization's business date every figure was computed for (YYYY-MM-DD).
  today: string;
  // First (Monday) and last (Sunday) day of the org week containing today.
  weekStart: string;
  weekEnd: string;
  summary: DashboardSummary;
}

export type DashboardResponse = ApiSuccess<DashboardData, DashboardMeta>;
