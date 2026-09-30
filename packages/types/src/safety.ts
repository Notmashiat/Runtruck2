// Safety & compliance wire types — specified in docs/api/safety.md.
// Endpoints: GET /work-orders (maintenance.view), GET /driver-documents, GET /compliance-reminders,
// GET /violations (compliance.view), GET /claims (claims.view).
// Money is integer cents, business dates are YYYY-MM-DD. Labels, chip tones and every
// display string are web presentation (docs/api/safety.md §7).

import type { ApiSuccess, PageMeta } from './api.js';

// A driver as a list shows them: the employee's first_name + " " + last_name.
export interface SafetyDriverRef {
  id: string;
  fullName: string;
}

export interface SafetyTruckRef {
  id: string;
  unitNumber: string;
}

export interface SafetyTrailerRef {
  id: string;
  unitNumber: string;
}

// ─── GET /work-orders ────────────────────────────────────────────────────

// Stored lifecycle status. Runtruck1 labels: Scheduled / Due / Overdue / In shop / Done.
export type WorkOrderStatus = 'scheduled' | 'due' | 'overdue' | 'in_shop' | 'done';

// The unit is a truck or a trailer (exactly one).
export interface WorkOrderUnit {
  kind: 'truck' | 'trailer';
  id: string;
  unitNumber: string;
}

// The shop facility; the web shows "<name> · <city>".
export interface WorkOrderShop {
  facilityId: string;
  name: string;
  city: string;
}

export interface WorkOrderRow {
  id: string;
  unit: WorkOrderUnit;
  item: string;
  // Exactly one of the two dues is set: a day, or an odometer reading in miles.
  dueOn: string | null;
  dueOdometer: number | null;
  shop: WorkOrderShop;
  estimateCents: number;
  status: WorkOrderStatus;
  // Set iff done.
  completedOn: string | null;
}

export interface WorkOrderOverdueEntry {
  workOrderId: string;
  unitNumber: string;
  item: string;
}

// Computed over every work order of the organization; never filtered by q or status.
export interface WorkOrdersSummary {
  asOf: string;
  // asOf − 30 days: done orders completed on or after it count as "done · last 30 d".
  doneWindowStart: string;
  workOrderCount: number;
  // status ≠ done.
  openCount: number;
  doneLast30dCount: number;
  inShopCount: number;
  // Shops of in-shop orders, distinct by facility, in list order.
  inShopShops: WorkOrderShop[];
  // status overdue, in list order.
  overdue: WorkOrderOverdueEntry[];
  // Σ estimateCents with status ≠ done.
  openEstimateCents: number;
}

export interface WorkOrdersMeta extends PageMeta {
  summary: WorkOrdersSummary;
}

export type WorkOrdersResponse = ApiSuccess<WorkOrderRow[], WorkOrdersMeta>;

// ─── GET /driver-documents ───────────────────────────────────────────────

// Runtruck1 labels: CDL / Medical card / MVR / Annual review / Drug test / Clearinghouse query.
export type DriverDocumentType = 'cdl' | 'medical_card' | 'mvr' | 'annual_review' | 'drug_test' | 'clearinghouse_query';

// Stored lifecycle status. Runtruck1 labels: Valid / Expiring / Expired / Missing.
export type DriverDocumentStatus = 'valid' | 'expiring' | 'expired' | 'missing';

// 'day' renders "Sep 20", 'month' renders "Apr 2028" (the date is the month's last day).
export type ComplianceDatePrecision = 'day' | 'month';

export interface DriverDocumentRow {
  id: string;
  driver: SafetyDriverRef;
  documentType: DriverDocumentType;
  // Null = missing (status missing).
  expiresOn: string | null;
  expiresPrecision: ComplianceDatePrecision;
  status: DriverDocumentStatus;
}

// One document named in a KPI note ("Priya Raman · CDL").
export interface DriverDocumentKpiEntry {
  driverDocumentId: string;
  driverId: string;
  fullName: string;
  documentType: DriverDocumentType;
}

// Computed over every driver document of the organization; never filtered by q or status.
export interface DriverDocumentsSummary {
  asOf: string;
  // asOf + 60 days ("Renew before Nov 2").
  expiringWindowEnd: string;
  documentCount: number;
  // Distinct drivers with at least one document.
  driverCount: number;
  expiringCount: number;
  // status expired / missing, in list order.
  expired: DriverDocumentKpiEntry[];
  missing: DriverDocumentKpiEntry[];
}

export interface DriverDocumentsMeta extends PageMeta {
  summary: DriverDocumentsSummary;
}

export type DriverDocumentsResponse = ApiSuccess<DriverDocumentRow[], DriverDocumentsMeta>;

// ─── GET /compliance-reminders ───────────────────────────────────────────

// The Fleet › Drivers "Compliance watchlist" (stored records, design brief §2).
export interface ComplianceReminderRow {
  id: string;
  driver: SafetyDriverRef;
  // "CDL renewal", "Medical card", "Annual MVR review", "Clearinghouse query".
  itemLabel: string;
  dueOn: string;
  duePrecision: ComplianceDatePrecision;
}

export interface ComplianceRemindersSummary {
  asOf: string;
  // Every reminder of the organization; never filtered by q.
  reminderCount: number;
}

export interface ComplianceRemindersMeta extends PageMeta {
  summary: ComplianceRemindersSummary;
}

export type ComplianceRemindersResponse = ApiSuccess<ComplianceReminderRow[], ComplianceRemindersMeta>;

// ─── GET /violations ─────────────────────────────────────────────────────

// Stored lifecycle status. Runtruck1 labels: Open / Contested / Closed.
export type ViolationStatus = 'open' | 'contested' | 'closed';

export interface ViolationRow {
  id: string;
  occurredOn: string;
  driver: SafetyDriverRef;
  truck: SafetyTruckRef;
  // "Log form & manner".
  violationType: string;
  // CSA severity weight.
  severityPoints: number;
  // "I-70 POE · Loma, CO".
  location: string;
  status: ViolationStatus;
}

// Computed over every violation of the organization; never filtered by q or status.
export interface ViolationsSummary {
  asOf: string;
  // First day of the 12-month window, (asOf − 1 year) + 1 day: the window is occurredOn > asOf − 1 year.
  pointsWindowStart: string;
  violationCount: number;
  openCount: number;
  contestedCount: number;
  closedCount: number;
  // Σ severityPoints / count of violations with occurredOn ≥ pointsWindowStart.
  pointsInWindow: number;
  violationsInWindowCount: number;
}

export interface ViolationsMeta extends PageMeta {
  summary: ViolationsSummary;
}

export type ViolationsResponse = ApiSuccess<ViolationRow[], ViolationsMeta>;

// ─── GET /claims ─────────────────────────────────────────────────────────

// Runtruck1 labels: Cargo damage / Property damage / Bodily injury / Cargo shortage.
export type ClaimType = 'cargo_damage' | 'property_damage' | 'bodily_injury' | 'cargo_shortage';

// Stored lifecycle status. Runtruck1 labels: Open / Under review / Settled / Denied.
export type ClaimStatus = 'open' | 'under_review' | 'settled' | 'denied';

export type ClaimantKind = 'customer' | 'facility' | 'third_party';

// Who claims: a customer or facility of the organization, or a named third party.
export type ClaimClaimant =
  | { kind: 'customer'; customerId: string; name: string }
  | { kind: 'facility'; facilityId: string; name: string }
  | { kind: 'third_party'; name: string };

export interface ClaimLoadRef {
  id: string;
  loadNumber: number;
}

export interface ClaimRow {
  id: string;
  // Human number; the web shows "CLM-1112".
  claimNumber: number;
  occurredOn: string;
  driver: SafetyDriverRef;
  truck: SafetyTruckRef;
  trailer: SafetyTrailerRef | null;
  load: ClaimLoadRef | null;
  claimType: ClaimType;
  claimant: ClaimClaimant;
  reservedCents: number;
  // 0 until paid; the web shows "—" for 0.
  paidCents: number;
  status: ClaimStatus;
}

// Computed over every claim of the organization; never filtered by q or status.
export interface ClaimsSummary {
  asOf: string;
  // January 1 of asOf's year.
  ytdStart: string;
  claimCount: number;
  // status open or under_review.
  openCount: number;
  underReviewCount: number;
  // Σ reservedCents of open and under_review claims.
  openReservedCents: number;
  // Σ paidCents / count of claims with paidCents > 0 and occurredOn in ytdStart…asOf.
  paidYtdCents: number;
  paidYtdCount: number;
  settledCount: number;
  deniedCount: number;
}

export interface ClaimsMeta extends PageMeta {
  summary: ClaimsSummary;
}

export type ClaimsResponse = ApiSuccess<ClaimRow[], ClaimsMeta>;
