// billing view-model builders and label/tone maps: turn API DTOs into Runtruck1-shaped
// display rows. Shared by the web (rendering + live search) and the API (server-side q)
// so both match identically (docs/03-database.md §1.11). Specified in docs/api/billing.md.

import type {
  ArAging,
  InvoiceBatchRecipientKind,
  InvoiceBatchRow,
  InvoiceBatchesSummary,
  InvoiceBatchStatus,
  InvoiceRow,
  InvoiceStatus,
  OverdueInvoicesSummary,
  PaidInvoicesSummary,
  PaymentMethod,
  UninvoicedLoadRow,
  UninvoicedLoadsSummary,
  UninvoicedPodStatus,
} from '@runtruck/types';
import { EM_DASH, formatAge, formatBatchNumber, formatInvoiceNumber, formatLoadNumber, formatMoney, formatShortDate } from '../format.js';

// Chip tones of the accounting screens: the @runtruck/ui Tag tones, matching Runtruck1's
// tagClass mapping (tag-accent → blue, tag-neutral → gray, tag-outline → amber, tag-green → green).
export type AccountingTone = 'blue' | 'gray' | 'amber' | 'green';

// A KPI tile as the web's <Kpis> renders it. A pending or refused read has no note
// (implementation-brief §4 rule 2).
export interface AccountingKpi {
  label: string;
  value: string;
  note?: string;
}

// ---------------------------------------------------------------------------
// Label and tone maps (billing.md §1.1)
// ---------------------------------------------------------------------------

export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = { draft: 'Draft', sent: 'Sent', overdue: 'Overdue', paid: 'Paid' };
export const INVOICE_STATUS_TONE: Record<InvoiceStatus, AccountingTone> = { draft: 'amber', sent: 'blue', overdue: 'amber', paid: 'green' };

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = { ach: 'ACH', check: 'Check', factoring: 'Factoring' };
export const PAYMENT_METHOD_TONE: Record<PaymentMethod, AccountingTone> = { ach: 'gray', check: 'gray', factoring: 'blue' };

export const INVOICE_BATCH_STATUS_LABEL: Record<InvoiceBatchStatus, string> = { ready: 'Ready', sent: 'Sent', settled: 'Settled' };
export const INVOICE_BATCH_STATUS_TONE: Record<InvoiceBatchStatus, AccountingTone> = { ready: 'blue', sent: 'blue', settled: 'green' };

export const POD_STATUS_LABEL: Record<UninvoicedPodStatus, string> = { attached: 'Attached', missing: 'Missing' };
export const POD_STATUS_TONE: Record<UninvoicedPodStatus, AccountingTone> = { attached: 'green', missing: 'amber' };

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// 'September' for any YYYY-MM-DD in September (en-US, long). Paid tab "Paid this month" note.
export function formatMonthName(date: string): string {
  const month = Number(date.slice(5, 7));
  return MONTH_NAMES[month - 1] ?? '';
}

// Batch "Sent to" (docs/03 §6.0.8): the customer name, or "<factor> (factoring)".
export function invoiceBatchSentTo(kind: InvoiceBatchRecipientKind, name: string): string {
  return kind === 'factoring_company' ? `${name} (factoring)` : name;
}

// ---------------------------------------------------------------------------
// View rows: exactly Runtruck1's row keys and display strings, plus a `tone`
// that search skips. No UUID is a view-row property (billing.md §7.0).
// ---------------------------------------------------------------------------

export interface UninvoicedViewRow {
  id: string;
  customer: string;
  route: string;
  delivered: string;
  pod: string;
  amount: string;
  tone: AccountingTone;
}

export function uninvoicedViewRow(row: UninvoicedLoadRow): UninvoicedViewRow {
  return {
    id: formatLoadNumber(row.loadNumber),
    customer: row.customerName,
    route: row.route ?? EM_DASH,
    delivered: row.deliveredOn ? formatShortDate(row.deliveredOn) : EM_DASH,
    pod: POD_STATUS_LABEL[row.podStatus],
    amount: formatMoney(row.amountCents),
    tone: POD_STATUS_TONE[row.podStatus],
  };
}

export interface InvoiceViewRow {
  id: string;
  customer: string;
  load: string;
  issued: string;
  amount: string;
  age: string;
  status: string;
  tone: AccountingTone;
}

// Invoiced and Past Due rows (Runtruck1 Invoice).
export function invoiceViewRow(row: InvoiceRow): InvoiceViewRow {
  return {
    id: formatInvoiceNumber(row.invoiceNumber),
    customer: row.customerName,
    load: row.loadNumber === null ? EM_DASH : formatLoadNumber(row.loadNumber),
    issued: row.issuedOn ? formatShortDate(row.issuedOn) : EM_DASH,
    amount: formatMoney(row.amountCents),
    age: formatAge(row.ageDays),
    status: INVOICE_STATUS_LABEL[row.status],
    tone: INVOICE_STATUS_TONE[row.status],
  };
}

export interface PaidInvoiceViewRow extends Omit<InvoiceViewRow, 'tone'> {
  paid: string;
  via: string;
  // A number, as Runtruck1's `days` (p ? daysBetween(issued, paid) : 0).
  days: number;
  // Tone of the "Via" chip.
  tone: AccountingTone;
}

// Paid rows: Runtruck1's {...invoice, paid, via, days}. `age` and `status` are searched
// though not displayed (q=paid matches every row, q=29 d matches INV-8823).
export function paidInvoiceViewRow(row: InvoiceRow): PaidInvoiceViewRow {
  const { tone: _statusTone, ...invoice } = invoiceViewRow(row);
  const payment = row.latestPayment;
  return {
    ...invoice,
    paid: payment ? formatShortDate(payment.paidOn) : EM_DASH,
    via: payment ? PAYMENT_METHOD_LABEL[payment.method] : EM_DASH,
    days: row.daysToPay ?? 0,
    tone: payment ? PAYMENT_METHOD_TONE[payment.method] : 'gray',
  };
}

export interface InvoiceBatchViewRow {
  id: string;
  created: string;
  // A number, as in Runtruck1.
  invoices: number;
  total: string;
  sentTo: string;
  status: string;
  tone: AccountingTone;
}

export function invoiceBatchViewRow(row: InvoiceBatchRow): InvoiceBatchViewRow {
  return {
    id: formatBatchNumber(row.batchNumber),
    created: formatShortDate(row.createdOn),
    invoices: row.invoiceCount,
    total: formatMoney(row.totalCents),
    sentTo: row.sentTo,
    status: INVOICE_BATCH_STATUS_LABEL[row.status],
    tone: INVOICE_BATCH_STATUS_TONE[row.status],
  };
}

// ---------------------------------------------------------------------------
// KPI tiles (billing.md §7). `undefined` = the read is pending or refused: the
// tiles keep their labels, show "—" and no note (implementation-brief §4).
// ---------------------------------------------------------------------------

const pending = (labels: string[]): AccountingKpi[] => labels.map((label) => ({ label, value: EM_DASH }));

export function uninvoicedKpis(summary: UninvoicedLoadsSummary | undefined): AccountingKpi[] {
  if (!summary) return pending(['Loads', 'Amount waiting', 'Missing POD', 'Oldest (days)']);
  const { oldest } = summary;
  return [
    { label: 'Loads', value: String(summary.loadCount), note: 'Delivered, not yet invoiced' },
    { label: 'Amount waiting', value: formatMoney(summary.amountCents), note: `Across ${summary.customerCount} customers` },
    { label: 'Missing POD', value: String(summary.missingPodCount), note: 'Cannot invoice until attached' },
    // Empty list: "—" / "None" instead of Runtruck1's crash (01 C47).
    oldest
      ? { label: 'Oldest (days)', value: String(oldest.ageDays), note: `${formatLoadNumber(oldest.loadNumber)} · delivered ${formatShortDate(oldest.deliveredOn)}` }
      : { label: 'Oldest (days)', value: EM_DASH, note: 'None' },
  ];
}

// Invoiced tab: AR aging tiles (billing.md §7.2).
export function arAgingKpis(arAging: ArAging | undefined): AccountingKpi[] {
  if (!arAging) return pending(['Current', '1–30 days', '31–60 days', '60+ days']);
  return [
    { label: 'Current', value: formatMoney(arAging.current.amountCents), note: `${arAging.current.invoiceCount} invoices` },
    { label: '1–30 days', value: formatMoney(arAging.days1To30.amountCents), note: `${arAging.days1To30.invoiceCount} invoices` },
    { label: '31–60 days', value: formatMoney(arAging.days31To60.amountCents), note: `${arAging.days31To60.invoiceCount} invoices` },
    { label: '60+ days', value: formatMoney(arAging.days60Plus.amountCents), note: `${arAging.days60Plus.invoiceCount} invoices · collections` },
  ];
}

export function invoiceBatchesKpis(summary: InvoiceBatchesSummary | undefined): AccountingKpi[] {
  if (!summary) return pending(['Batches', 'Ready to send', 'Sent this week', 'Total batched']);
  return [
    { label: 'Batches', value: String(summary.batchCount), note: `${summary.invoiceCount} invoices` },
    { label: 'Ready to send', value: String(summary.readyCount), note: `${formatMoney(summary.readyTotalCents)} to go out` },
    { label: 'Sent this week', value: String(summary.sentThisWeekCount), note: 'Last 7 days' },
    { label: 'Total batched', value: formatMoney(summary.totalCents), note: 'Ready, sent and settled' },
  ];
}

export function pastDueKpis(summary: OverdueInvoicesSummary | undefined): AccountingKpi[] {
  if (!summary) return pending(['Overdue invoices', 'Amount overdue', 'Oldest', 'Accounts affected']);
  const { oldest } = summary;
  return [
    { label: 'Overdue invoices', value: String(summary.invoiceCount), note: 'Past terms' },
    { label: 'Amount overdue', value: formatMoney(summary.amountCents), note: `${summary.inCollectionsCount} in collections (60+ days)` },
    // Empty list: "—" / "None" instead of Runtruck1's crash (01 C47).
    oldest
      ? { label: 'Oldest', value: formatAge(oldest.ageDays), note: `${formatInvoiceNumber(oldest.invoiceNumber)} · ${oldest.customerName}` }
      : { label: 'Oldest', value: EM_DASH, note: 'None' },
    { label: 'Accounts affected', value: String(summary.accountsAffected), note: `of ${summary.totalAccounts} accounts` },
  ];
}

export function paidKpis(summary: PaidInvoicesSummary | undefined): AccountingKpi[] {
  if (!summary) return pending(['Paid this month', 'Amount', 'Avg days to pay', 'Paid via factoring']);
  const factors = summary.factoringCompanyNames.length ? summary.factoringCompanyNames.join(', ') : EM_DASH;
  return [
    { label: 'Paid this month', value: String(summary.paidThisMonthCount), note: formatMonthName(summary.monthStart) },
    { label: 'Amount', value: formatMoney(summary.collectedThisMonthCents), note: 'Collected this month' },
    { label: 'Avg days to pay', value: String(summary.avgDaysToPay), note: 'Issued to paid' },
    { label: 'Paid via factoring', value: String(summary.factoredCount), note: `${factors} · ${formatMoney(summary.factoredCents)}` },
  ];
}
