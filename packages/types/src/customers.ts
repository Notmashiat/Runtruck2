// Customers (CRM) wire types — specified in docs/api/customers.md.
// `PaymentTerms` is the canonical wire type of the `payment_terms` enum, which the
// customers schema owns (docs/03-database.md §4.2); loads.ts aliases it (`LoadPaymentTerms`),
// so the union is written once.

import type { ApiSuccess, PageMeta } from './api.js';

/** `customer_standing`: "Key account" / "Growing" / "At risk". */
export type CustomerStanding = 'key_account' | 'growing' | 'at_risk';

/** `payment_terms`: "Net 15" / "Net 30" / "Net 45" / "Net 60" / "Quick pay". */
export type PaymentTerms = 'net_15' | 'net_30' | 'net_45' | 'net_60' | 'quick_pay';

export interface CustomerContactRef {
  id: string;
  fullName: string;
  email: string | null;
}

// ---------------------------------------------------------------------------
// GET /api/v1/customers (docs/api/customers.md §2)

export interface CustomerListItem {
  id: string;
  name: string;
  standing: CustomerStanding;
  /** Default terms; New Load pre-fills "Payment terms" with them. */
  paymentTerms: PaymentTerms;
  /** The is_primary contact ("Primary contact"; the card shows `name · email`). */
  primaryContact: CustomerContactRef | null;
  /** Loads whose load date (first pickup, else first invoice date) is in YTD. */
  loadsYtd: number;
  /** Σ (line haul + fuel surcharge + accessorials) of those loads, cents. */
  revenueYtdCents: number;
  /** round(100 × on-time / loadsYtd); null when loadsYtd = 0. */
  onTimePercent: number | null;
  /** Σ outstanding of sent and overdue invoices, cents. */
  arBalanceCents: number;
}

/** KPI figures and top-account cards for the CRM, over every customer (ignores q). */
export interface CustomerListSummary {
  /** Org business date (YYYY-MM-DD). */
  asOf: string;
  ytdStart: string;
  accountCount: number;
  keyAccountCount: number;
  atRiskCount: number;
  revenueYtdCents: number;
  /** round(100 × three largest revenues / total); 0 when the total is 0. */
  top3SharePercent: number;
  /** Weighted by loads; null when there are no YTD loads. */
  onTimePercent: number | null;
  openArCents: number;
  /** Key accounts, then at-risk accounts, by position; first 3. */
  topAccounts: CustomerListItem[];
}

export interface CustomerListMeta extends PageMeta {
  summary: CustomerListSummary;
}

export type CustomerListResponse = ApiSuccess<CustomerListItem[], CustomerListMeta>;

// ---------------------------------------------------------------------------
// GET /api/v1/customers/options (docs/api/customers.md §2.8): New Load's "Customer" and
// "Bill to" selects. No aggregates: a select list must not pay for the CRM statement.

export interface CustomerOption {
  id: string;
  name: string;
  /** Default terms; New Load pre-fills "Payment terms" with them. */
  paymentTerms: PaymentTerms;
}

export type CustomerOptionsResponse = ApiSuccess<CustomerOption[], PageMeta>;
