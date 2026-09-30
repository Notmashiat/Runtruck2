// payables view-model builders and label/tone maps: turn API DTOs into Runtruck1-shaped
// display rows. Shared by the web (rendering + live search) and the API (server-side q)
// so both match identically (docs/03-database.md §1.11). Specified in docs/api/payables.md.

import type { BillRow, BillsSummary, BillStatus } from '@runtruck/types';
import { EM_DASH, formatMoney, formatShortDate } from '../format.js';
import type { AccountingKpi, AccountingTone } from './billing.js';

export const BILL_STATUS_LABEL: Record<BillStatus, string> = { due: 'Due', overdue: 'Overdue', scheduled: 'Scheduled', paid: 'Paid' };
export const BILL_STATUS_TONE: Record<BillStatus, AccountingTone> = { due: 'amber', overdue: 'amber', scheduled: 'blue', paid: 'green' };

// Bill "Category" (docs/03 §6.0.8): the category, plus " · <description>" when set
// ("Parts · T-118 turbo"). The API composes BillRow.categoryLabel with it.
export function billCategoryLabel(category: string, description: string | null): string {
  return description ? `${category} · ${description}` : category;
}

export interface BillViewRow {
  vendor: string;
  category: string;
  due: string;
  amount: string;
  status: string;
  tone: AccountingTone;
}

export function billViewRow(row: BillRow): BillViewRow {
  return {
    vendor: row.vendorName,
    category: row.categoryLabel,
    due: formatShortDate(row.dueOn),
    amount: formatMoney(row.amountCents),
    status: BILL_STATUS_LABEL[row.status],
    tone: BILL_STATUS_TONE[row.status],
  };
}

// Bills KPI tiles (payables.md §4). `undefined` = pending or refused: labels, "—", no note.
export function billsKpis(summary: BillsSummary | undefined): AccountingKpi[] {
  if (!summary) return ['Due this week', 'Overdue', 'Scheduled', 'Paid this month'].map((label) => ({ label, value: EM_DASH }));
  return [
    { label: 'Due this week', value: String(summary.dueThisWeek.count), note: formatMoney(summary.dueThisWeek.amountCents) },
    { label: 'Overdue', value: String(summary.overdue.count), note: formatMoney(summary.overdue.amountCents) },
    { label: 'Scheduled', value: String(summary.scheduled.count), note: `${formatMoney(summary.scheduled.amountCents)} · auto-pay` },
    { label: 'Paid this month', value: String(summary.paidThisMonth.count), note: formatMoney(summary.paidThisMonth.amountCents) },
  ];
}
