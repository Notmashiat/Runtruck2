import type { CustomerListItem, CustomerListSummary } from '@runtruck/types';
import type { CustomerSqlRow } from './customers.repository.js';

// Pure mapping and aggregation for GET /customers (docs/api/customers.md §2).

// A CRM item plus the facts the summary needs but the item does not carry.
export interface CustomerRecord {
  item: CustomerListItem;
  lateYtd: number;
}

// round(100 × on-time / n); null without YTD loads (decision CU3).
export function onTimePercent(loads: number, late: number): number | null {
  return loads === 0 ? null : Math.round((100 * (loads - late)) / loads);
}

export function toCustomerRecord(row: CustomerSqlRow): CustomerRecord {
  const loadsYtd = row.loads_ytd;
  const lateYtd = row.late_ytd;
  return {
    lateYtd,
    item: {
      id: row.id,
      name: row.name,
      standing: row.standing,
      paymentTerms: row.payment_terms,
      primaryContact:
        row.contact_id !== null && row.contact_name !== null
          ? { id: row.contact_id, fullName: row.contact_name, email: row.contact_email }
          : null,
      loadsYtd,
      // bigint sums of cents stay far below 2^53.
      revenueYtdCents: Number(row.revenue_ytd),
      onTimePercent: onTimePercent(loadsYtd, lateYtd),
      arBalanceCents: Number(row.ar_balance),
    },
  };
}

// Top-account cards (§2.3): key accounts, then at-risk accounts, each in list (position)
// order; the first three. Growing accounts never appear.
export function selectTopAccounts(items: readonly CustomerListItem[]): CustomerListItem[] {
  return [...items.filter((c) => c.standing === 'key_account'), ...items.filter((c) => c.standing === 'at_risk')].slice(0, 3);
}

// "Top 3 accounts = N%" (§2.5): the three largest revenues over the total, whatever the
// standing; ties keep list (position, id) order. 0 when there is no revenue.
export function top3SharePercent(items: readonly CustomerListItem[]): number {
  const total = items.reduce((sum, c) => sum + c.revenueYtdCents, 0);
  if (total === 0) return 0;
  // Array.prototype.sort is stable, so equal revenues stay in list order.
  const top3 = [...items]
    .sort((a, b) => b.revenueYtdCents - a.revenueYtdCents)
    .slice(0, 3)
    .reduce((sum, c) => sum + c.revenueYtdCents, 0);
  return Math.round((100 * top3) / total);
}

// KPI figures and top-account cards over every customer of the organization (never q).
export function summarizeCustomers(
  records: readonly CustomerRecord[],
  period: Pick<CustomerListSummary, 'asOf' | 'ytdStart'>,
): CustomerListSummary {
  const items = records.map((r) => r.item);
  const loads = items.reduce((sum, c) => sum + c.loadsYtd, 0);
  const late = records.reduce((sum, r) => sum + r.lateYtd, 0);
  return {
    ...period,
    accountCount: items.length,
    keyAccountCount: items.filter((c) => c.standing === 'key_account').length,
    atRiskCount: items.filter((c) => c.standing === 'at_risk').length,
    revenueYtdCents: items.reduce((sum, c) => sum + c.revenueYtdCents, 0),
    top3SharePercent: top3SharePercent(items),
    // Weighted by loads.
    onTimePercent: onTimePercent(loads, late),
    openArCents: items.reduce((sum, c) => sum + c.arBalanceCents, 0),
    topAccounts: selectTopAccounts(items),
  };
}
