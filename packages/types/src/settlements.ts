// Settlements (driver payroll) wire types — specified in docs/api/settlements.md.
// Endpoints: GET /settlements?periodStart=…, POST /settlements/approve.
// Money is integer cents, business dates are YYYY-MM-DD, instants are UTC ISO strings.

import type { PageMeta } from './api.js';
import type { EmployeeContractPayBasis } from './hr.js';

// docs/03-database.md §4.5; labels and chip tones are web presentation.
export type SettlementStatus = 'ready' | 'approved' | 'on_hold' | 'paid';

// docs/03-database.md §4.3 pay_basis: an alias of the canonical union (hr.ts), one enum.
export type SettlementPayBasis = EmployeeContractPayBasis;

export interface SettlementRow {
  id: string;
  driverId: string;
  // Employee first_name + " " + last_name.
  driverName: string;
  periodStart: string;
  periodEnd: string;
  payBasis: SettlementPayBasis;
  payRateCents: number | null;
  payPercentBp: number | null;
  // "$0.62 / mi", "25% of line haul" (docs/03 §6.0.6).
  payBasisLabel: string;
  // Count of line_pay items.
  loadCount: number;
  // Σ miles of line_pay items.
  miles: number;
  // Σ line_pay amounts (≥ 0).
  grossCents: number;
  // Σ deduction amounts (≤ 0).
  deductionsCents: number;
  // grossCents + deductionsCents.
  netCents: number;
  status: SettlementStatus;
  // Set iff on_hold ("fuel").
  holdReason: string | null;
  approvedAt: string | null;
}

export interface SettlementPeriod {
  start: string;
  // Latest period_end of the period's settlements; null when the period has none.
  end: string | null;
}

export interface SettlementsSummary {
  // Null only when no periodStart was given and the organization has no settlement period yet.
  period: SettlementPeriod | null;
  driverCount: number;
  readyCount: number;
  approvedCount: number;
  onHoldCount: number;
  paidCount: number;
  // Every row, any status.
  grossCents: number;
  deductionsCents: number;
  netCents: number;
  // Runtruck1's "approved" flag: readyCount === 0 && approvedCount > 0.
  allApproved: boolean;
}

export interface SettlementsMeta extends PageMeta {
  summary: SettlementsSummary;
}

// POST /settlements/approve returns the period's list plus how many rows this call moved.
export interface SettlementsApproveMeta extends SettlementsMeta {
  // Settlements moved ready → approved by this request (0 on a repeat call).
  approvedNow: number;
}
