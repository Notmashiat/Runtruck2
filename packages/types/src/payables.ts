// Payables (vendor bills) wire types — specified in docs/api/payables.md.
// Endpoint: GET /bills. Money is integer cents, business dates are YYYY-MM-DD.

import type { PageMeta } from './api.js';

// docs/03-database.md §4.5; labels and chip tones are web presentation.
export type BillStatus = 'due' | 'overdue' | 'scheduled' | 'paid';

export interface BillRow {
  id: string;
  vendorId: string;
  vendorName: string;
  category: string;
  description: string | null;
  // "Parts · T-118 turbo": category, plus " · " + description when set (docs/03 §6.0.8).
  categoryLabel: string;
  dueOn: string;
  amountCents: number;
  status: BillStatus;
  // Auto-pay date; set when scheduled.
  scheduledOn: string | null;
  // Set iff paid.
  paidOn: string | null;
}

export interface BillsKpi {
  count: number;
  amountCents: number;
}

export interface BillsSummary {
  // status 'due' and dueOn − today ≤ 7 (no lower bound, Runtruck1's rule).
  dueThisWeek: BillsKpi;
  overdue: BillsKpi;
  scheduled: BillsKpi;
  // status 'paid' and paidOn in the current org month.
  paidThisMonth: BillsKpi;
}

export interface BillsMeta extends PageMeta {
  summary: BillsSummary;
}
