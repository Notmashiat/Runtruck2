// safety view-model builders and label/tone maps: turn API DTOs into Runtruck1-shaped
// display rows. Shared by the web (rendering + live search) and the API (server-side q)
// so both match identically (docs/03-database.md §1.11). Specified in docs/api/safety.md §7.
//
// Row convention (safety.md §7): every table row has exactly the Runtruck1 mock row's keys
// (minus tagClass) with the same display strings and raw numbers, plus `ref`, an object
// that matchesQuery never searches (ids, enum values, tones and cents can therefore never
// match). Money Runtruck1 kept as numbers is exposed in whole dollars (searched as digits:
// "4850", never "$4,850" or "485000"); the cells format the cents kept in `ref`.
//
// The Fleet › Drivers watchlist row (safety.md §7.3) is `toDriverWatchlistRow` in fleet.ts.

import type {
  ClaimClaimant,
  ClaimRow,
  ClaimsSummary,
  ClaimStatus,
  ClaimType,
  ComplianceDatePrecision,
  DriverDocumentRow,
  DriverDocumentsSummary,
  DriverDocumentStatus,
  DriverDocumentType,
  SafetyTrailerRef,
  SafetyTruckRef,
  ViolationRow,
  ViolationsSummary,
  ViolationStatus,
  WorkOrderRow,
  WorkOrdersSummary,
  WorkOrderShop,
  WorkOrderStatus,
} from '@runtruck/types';
import { EM_DASH, formatClaimNumber, formatInt, formatMoney, formatMonthYear, formatShortDate } from '../format.js';

// Chip tones of @runtruck/ui's Tag (presentation only).
type Tone = 'blue' | 'gray' | 'amber' | 'green';

// One KPI card (@runtruck/ui Kpi without onClick). While the data is pending or refused
// the value is "—" and there is no note (implementation-brief §4).
interface KpiVm {
  label: string;
  value: string;
  note?: string;
}

const PENDING = EM_DASH;

const pendingKpis = (labels: string[]): KpiVm[] => labels.map((label) => ({ label, value: PENDING }));

// ---------------------------------------------------------------------------
// Label and tone maps (safety.md §7; docs/03-database.md §5.11)

export const WORK_ORDER_STATUS_LABEL: Record<WorkOrderStatus, string> = {
  scheduled: 'Scheduled',
  due: 'Due',
  overdue: 'Overdue',
  in_shop: 'In shop',
  done: 'Done',
};
export const WORK_ORDER_STATUS_TONE: Record<WorkOrderStatus, Tone> = { scheduled: 'blue', due: 'amber', overdue: 'amber', in_shop: 'amber', done: 'gray' };

export const DRIVER_DOCUMENT_TYPE_LABEL: Record<DriverDocumentType, string> = {
  cdl: 'CDL',
  medical_card: 'Medical card',
  mvr: 'MVR',
  annual_review: 'Annual review',
  drug_test: 'Drug test',
  clearinghouse_query: 'Clearinghouse query',
};
export const DRIVER_DOCUMENT_STATUS_LABEL: Record<DriverDocumentStatus, string> = {
  valid: 'Valid',
  expiring: 'Expiring',
  expired: 'Expired',
  missing: 'Missing',
};
export const DRIVER_DOCUMENT_STATUS_TONE: Record<DriverDocumentStatus, Tone> = { valid: 'green', expiring: 'amber', expired: 'amber', missing: 'amber' };

export const VIOLATION_STATUS_LABEL: Record<ViolationStatus, string> = { open: 'Open', contested: 'Contested', closed: 'Closed' };
export const VIOLATION_STATUS_TONE: Record<ViolationStatus, Tone> = { open: 'amber', contested: 'blue', closed: 'gray' };

export const CLAIM_TYPE_LABEL: Record<ClaimType, string> = {
  cargo_damage: 'Cargo damage',
  property_damage: 'Property damage',
  bodily_injury: 'Bodily injury',
  cargo_shortage: 'Cargo shortage',
};
export const CLAIM_STATUS_LABEL: Record<ClaimStatus, string> = { open: 'Open', under_review: 'Under review', settled: 'Settled', denied: 'Denied' };
export const CLAIM_STATUS_TONE: Record<ClaimStatus, Tone> = { open: 'amber', under_review: 'blue', settled: 'green', denied: 'gray' };

// "Sep 20" for a day-precision date, "Apr 2028" for a month-precision one, "—" when there is none.
export function formatComplianceDate(date: string | null, precision: ComplianceDatePrecision): string {
  if (date === null) return EM_DASH;
  return precision === 'day' ? formatShortDate(date) : formatMonthYear(date);
}

// ---------------------------------------------------------------------------
// Safety › Maintenance (safety.md §7.1)

/** Runtruck1 `WorkOrder` row. `estimate` is whole dollars (raw, searched as digits). */
export interface WorkOrderRowVm {
  unit: string;
  item: string;
  due: string;
  shop: string;
  estimate: number;
  status: string;
  ref: { id: string; tone: Tone; estimateCents: number };
}

// "Sep 5", or an odometer reading "529,800 mi" (exactly one is set, work_orders_due_ck).
export function formatWorkOrderDue(dueOn: string | null, dueOdometer: number | null): string {
  if (dueOn !== null) return formatShortDate(dueOn);
  return dueOdometer === null ? EM_DASH : `${formatInt(dueOdometer)} mi`;
}

// "Sunridge shop · Modesto".
export function formatWorkOrderShop(shop: Pick<WorkOrderShop, 'name' | 'city'>): string {
  return `${shop.name} · ${shop.city}`;
}

export function toWorkOrderRow(w: WorkOrderRow): WorkOrderRowVm {
  return {
    unit: w.unit.unitNumber,
    item: w.item,
    due: formatWorkOrderDue(w.dueOn, w.dueOdometer),
    shop: formatWorkOrderShop(w.shop),
    estimate: w.estimateCents / 100,
    status: WORK_ORDER_STATUS_LABEL[w.status],
    ref: { id: w.id, tone: WORK_ORDER_STATUS_TONE[w.status], estimateCents: w.estimateCents },
  };
}

export function workOrderKpis(summary: WorkOrdersSummary | undefined): KpiVm[] {
  if (!summary) return pendingKpis(['Open work orders', 'In shop', 'Overdue', 'Est. cost open']);
  return [
    { label: 'Open work orders', value: String(summary.openCount), note: `${summary.doneLast30dCount} done · last 30 d` },
    { label: 'In shop', value: String(summary.inShopCount), note: summary.inShopShops.map(formatWorkOrderShop).join(', ') || 'None' },
    {
      label: 'Overdue',
      value: String(summary.overdue.length),
      note: summary.overdue.map((o) => `${o.unitNumber} · ${o.item}`).join(', ') || 'None',
    },
    { label: 'Est. cost open', value: formatMoney(summary.openEstimateCents), note: 'Parts & labor, open orders' },
  ];
}

// ---------------------------------------------------------------------------
// Safety › Driver Documents (safety.md §7.2)

/** Runtruck1 `DriverDocument` row. */
export interface DriverDocumentRowVm {
  driver: string;
  document: string;
  expires: string;
  status: string;
  ref: { id: string; tone: Tone };
}

export function toDriverDocumentRow(d: DriverDocumentRow): DriverDocumentRowVm {
  return {
    driver: d.driver.fullName,
    document: DRIVER_DOCUMENT_TYPE_LABEL[d.documentType],
    expires: formatComplianceDate(d.expiresOn, d.expiresPrecision),
    status: DRIVER_DOCUMENT_STATUS_LABEL[d.status],
    ref: { id: d.id, tone: DRIVER_DOCUMENT_STATUS_TONE[d.status] },
  };
}

export function driverDocumentKpis(summary: DriverDocumentsSummary | undefined): KpiVm[] {
  if (!summary) return pendingKpis(['Documents', 'Expiring (60 d)', 'Expired', 'Missing']);
  const note = (entries: DriverDocumentsSummary['expired']) =>
    entries.map((d) => `${d.fullName} · ${DRIVER_DOCUMENT_TYPE_LABEL[d.documentType]}`).join(', ') || 'None';
  return [
    { label: 'Documents', value: String(summary.documentCount), note: `${summary.driverCount} drivers on file` },
    { label: 'Expiring (60 d)', value: String(summary.expiringCount), note: `Renew before ${formatShortDate(summary.expiringWindowEnd)}` },
    { label: 'Expired', value: String(summary.expired.length), note: note(summary.expired) },
    { label: 'Missing', value: String(summary.missing.length), note: note(summary.missing) },
  ];
}

// ---------------------------------------------------------------------------
// Safety › Violations (safety.md §7.4)

/** Runtruck1 `Violation` row. `severityPoints` stays a raw number (searched as its digits). */
export interface ViolationRowVm {
  date: string;
  driver: string;
  unit: string;
  type: string;
  severityPoints: number;
  location: string;
  status: string;
  ref: { id: string; tone: Tone };
}

export function toViolationRow(v: ViolationRow): ViolationRowVm {
  return {
    date: formatShortDate(v.occurredOn),
    driver: v.driver.fullName,
    unit: v.truck.unitNumber,
    type: v.violationType,
    severityPoints: v.severityPoints,
    location: v.location,
    status: VIOLATION_STATUS_LABEL[v.status],
    ref: { id: v.id, tone: VIOLATION_STATUS_TONE[v.status] },
  };
}

export function violationKpis(summary: ViolationsSummary | undefined): KpiVm[] {
  if (!summary) return pendingKpis(['Open', 'Points (12 mo)', 'Contested', 'Closed']);
  return [
    { label: 'Open', value: String(summary.openCount), note: 'Corrective action pending' },
    { label: 'Points (12 mo)', value: String(summary.pointsInWindow), note: `CSA severity · ${summary.violationsInWindowCount} violations` },
    { label: 'Contested', value: String(summary.contestedCount), note: 'DataQ challenge filed' },
    { label: 'Closed', value: String(summary.closedCount), note: 'Resolved, on file' },
  ];
}

// ---------------------------------------------------------------------------
// Safety › Settlements = claims (safety.md §7.5)

/** Runtruck1 `Claim` row. Its `id` key holds the claim number ("CLM-1112"; the uuid is in
 * `ref.id`); `reserved` and `paid` are whole dollars (raw; an unpaid claim's `paid` is 0). */
export interface ClaimRowVm {
  id: string;
  date: string;
  driver: string;
  unit: string;
  type: string;
  claimant: string;
  reserved: number;
  paid: number;
  status: string;
  ref: { id: string; tone: Tone; reservedCents: number; paidCents: number };
}

// "T-121 / FB-12", or the truck alone when the claim has no trailer.
export function formatClaimUnit(truck: SafetyTruckRef, trailer: SafetyTrailerRef | null): string {
  return trailer === null ? truck.unitNumber : `${truck.unitNumber} / ${trailer.unitNumber}`;
}

// The customer's or facility's name, or "Third party · R. Delgado" (03 §5.11.5).
export function formatClaimant(claimant: ClaimClaimant): string {
  return claimant.kind === 'third_party' ? `Third party · ${claimant.name}` : claimant.name;
}

export function toClaimRow(c: ClaimRow): ClaimRowVm {
  return {
    id: formatClaimNumber(c.claimNumber),
    date: formatShortDate(c.occurredOn),
    driver: c.driver.fullName,
    unit: formatClaimUnit(c.truck, c.trailer),
    type: CLAIM_TYPE_LABEL[c.claimType],
    claimant: formatClaimant(c.claimant),
    reserved: c.reservedCents / 100,
    paid: c.paidCents / 100,
    status: CLAIM_STATUS_LABEL[c.status],
    ref: { id: c.id, tone: CLAIM_STATUS_TONE[c.status], reservedCents: c.reservedCents, paidCents: c.paidCents },
  };
}

export function claimKpis(summary: ClaimsSummary | undefined): KpiVm[] {
  if (!summary) return pendingKpis(['Open claims', 'Reserved', 'Paid YTD', 'Settled']);
  return [
    { label: 'Open claims', value: String(summary.openCount), note: `${summary.underReviewCount} under review` },
    { label: 'Reserved', value: formatMoney(summary.openReservedCents), note: 'On open claims' },
    { label: 'Paid YTD', value: formatMoney(summary.paidYtdCents), note: `${summary.paidYtdCount} settlements` },
    { label: 'Settled', value: String(summary.settledCount), note: `${summary.deniedCount} denied` },
  ];
}
