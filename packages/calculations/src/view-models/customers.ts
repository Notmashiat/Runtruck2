// customers view-model builders and label/tone maps: turn API DTOs into Runtruck1-shaped
// display rows. Shared by the web (rendering + live search) and the API (server-side q)
// so both match identically (docs/03-database.md §1.11). Specified in docs/api/customers.md.

import type { CustomerListItem, CustomerListSummary, CustomerStanding, PaymentTerms } from '@runtruck/types';
import { EM_DASH, formatInt, formatMoney, formatMoneyK, formatMoneyK1, formatMoneyM1 } from '../format.js';

// Chip tones of @runtruck/ui's Tag (presentation only).
type Tone = 'blue' | 'gray' | 'amber' | 'green';

// One KPI card (@runtruck/ui Kpi without onClick); "—" and no note while pending or refused.
interface KpiVm {
  label: string;
  value: string;
  note?: string;
}

// ---------------------------------------------------------------------------
// Label and tone maps (customers.md §3.1)

export const CUSTOMER_STANDING_LABEL: Record<CustomerStanding, string> = {
  key_account: 'Key account',
  growing: 'Growing',
  at_risk: 'At risk',
};
export const CUSTOMER_STANDING_TONE: Record<CustomerStanding, Tone> = { key_account: 'blue', growing: 'gray', at_risk: 'amber' };

export const PAYMENT_TERMS_LABEL: Record<PaymentTerms, string> = {
  net_15: 'Net 15',
  net_30: 'Net 30',
  net_45: 'Net 45',
  net_60: 'Net 60',
  quick_pay: 'Quick pay',
};

// "100%", or "—" when the customer has no YTD loads (decision CU3).
export function formatOnTimePercent(percent: number | null): string {
  return percent === null ? EM_DASH : `${percent}%`;
}

// ---------------------------------------------------------------------------
// CRM "All accounts" (customers.md §3.1)

/** Runtruck1 `Customer` row. */
export interface CustomerRowVm {
  name: string;
  contact: string;
  loads: string;
  revenue: string;
  onTime: string;
  terms: string;
  ar: string;
  tier: string;
  ref: { id: string; tone: Tone };
}

export function toCustomerRow(c: CustomerListItem): CustomerRowVm {
  return {
    name: c.name,
    contact: c.primaryContact?.fullName ?? EM_DASH,
    loads: formatInt(c.loadsYtd),
    revenue: formatMoneyK(c.revenueYtdCents),
    onTime: formatOnTimePercent(c.onTimePercent),
    terms: PAYMENT_TERMS_LABEL[c.paymentTerms],
    ar: formatMoney(c.arBalanceCents),
    tier: CUSTOMER_STANDING_LABEL[c.standing],
    ref: { id: c.id, tone: CUSTOMER_STANDING_TONE[c.standing] },
  };
}

// ---------------------------------------------------------------------------
// CRM top-account cards (customers.md §3.1)

/** Runtruck1 `TopAccount` card. */
export interface TopAccountVm {
  tier: string;
  name: string;
  contact: string;
  loads: string;
  revenue: string;
  onTime: string;
  ref: { id: string };
}

// "Dana Ruiz · dana@northgate.com"; the name alone without an e-mail; "—" without a primary contact.
export function formatTopAccountContact(contact: CustomerListItem['primaryContact']): string {
  if (contact === null) return EM_DASH;
  return contact.email ? `${contact.fullName} · ${contact.email}` : contact.fullName;
}

export function toTopAccount(c: CustomerListItem): TopAccountVm {
  return {
    tier: CUSTOMER_STANDING_LABEL[c.standing],
    name: c.name,
    contact: formatTopAccountContact(c.primaryContact),
    loads: formatInt(c.loadsYtd),
    revenue: formatMoneyK(c.revenueYtdCents),
    onTime: formatOnTimePercent(c.onTimePercent),
    ref: { id: c.id },
  };
}

// ---------------------------------------------------------------------------
// CRM KPI row (customers.md §3.1)

export function customerKpis(summary: CustomerListSummary | undefined): KpiVm[] {
  if (!summary) {
    return ['Accounts', 'Revenue YTD', 'On time', 'Open AR'].map((label) => ({ label, value: EM_DASH }));
  }
  return [
    { label: 'Accounts', value: String(summary.accountCount), note: `${summary.keyAccountCount} key accounts` },
    { label: 'Revenue YTD', value: formatMoneyM1(summary.revenueYtdCents), note: `Top 3 accounts = ${summary.top3SharePercent}%` },
    { label: 'On time', value: formatOnTimePercent(summary.onTimePercent), note: 'Weighted by loads' },
    // "account", never pluralised (Runtruck1 wording, D6).
    { label: 'Open AR', value: formatMoneyK1(summary.openArCents), note: `${summary.atRiskCount} account at risk` },
  ];
}
