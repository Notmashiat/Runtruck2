// Billing (receivables) wire types — specified in docs/api/billing.md.
// Endpoints: GET /billing/uninvoiced-loads, GET /invoices?status=…, GET /invoice-batches.
// Money is integer cents, business dates are YYYY-MM-DD, instants are UTC ISO strings
// (docs/04-api.md §6). The web formats every value (docs/api/billing.md "Web mapping").

import type { PageMeta } from './api.js';

// ---------------------------------------------------------------------------
// Enums (docs/03-database.md §4.5; labels and chip tones are web presentation)
// ---------------------------------------------------------------------------

export type InvoiceStatus = 'draft' | 'sent' | 'overdue' | 'paid';

export type PaymentMethod = 'ach' | 'check' | 'factoring';

export type InvoiceBatchStatus = 'ready' | 'sent' | 'settled';

// Uninvoiced "POD" chip: 'attached' when an attached proof_of_delivery document exists.
export type UninvoicedPodStatus = 'attached' | 'missing';

export type InvoiceBatchRecipientKind = 'customer' | 'factoring_company';

// ---------------------------------------------------------------------------
// GET /billing/uninvoiced-loads
// ---------------------------------------------------------------------------

export interface UninvoicedLoadRow {
  loadId: string;
  loadNumber: number;
  customerId: string;
  customerName: string;
  // "Fresno, CA → Reno, NV" (first pickup → last delivery, docs/03 §6.0.3); null when the load has no stops.
  route: string | null;
  // Org/stop-local date of the last delivery (docs/03 §6.0.3 delivered_on); null when the load has no stops.
  deliveredOn: string | null;
  podStatus: UninvoicedPodStatus;
  // revenue(l) = line haul + fuel surcharge + accessorials.
  amountCents: number;
}

export interface UninvoicedOldestLoad {
  loadId: string;
  loadNumber: number;
  deliveredOn: string;
  // today − deliveredOn, whole days.
  ageDays: number;
}

export interface UninvoicedLoadsSummary {
  loadCount: number;
  amountCents: number;
  customerCount: number;
  missingPodCount: number;
  // Null when no uninvoiced load has a delivery date (empty list).
  oldest: UninvoicedOldestLoad | null;
}

export interface UninvoicedLoadsMeta extends PageMeta {
  summary: UninvoicedLoadsSummary;
}

// ---------------------------------------------------------------------------
// GET /invoices?status=…
// ---------------------------------------------------------------------------

// The invoice's most recent payment (received_at DESC, id DESC).
export interface InvoiceLatestPayment {
  paymentId: string;
  receivedAt: string;
  // Org-local calendar date of receivedAt ("Paid" column).
  paidOn: string;
  method: PaymentMethod;
  factoringCompanyId: string | null;
  factoringCompanyName: string | null;
  amountCents: number;
}

export interface InvoiceRow {
  id: string;
  invoiceNumber: number;
  customerId: string;
  customerName: string;
  // Load of the item at position 1 ("Load" column); null when that item has no load.
  loadId: string | null;
  loadNumber: number | null;
  status: InvoiceStatus;
  // Null while draft.
  issuedOn: string | null;
  dueOn: string | null;
  // today − issuedOn; null while draft.
  ageDays: number | null;
  // today − dueOn; null while draft.
  daysPastDue: number | null;
  // Σ invoice_items.amount_cents.
  amountCents: number;
  // Σ payments.amount_cents.
  paidCents: number;
  // amountCents − paidCents.
  outstandingCents: number;
  latestPayment: InvoiceLatestPayment | null;
  // latestPayment.paidOn − issuedOn; null without a payment or an issue date.
  daysToPay: number | null;
}

export interface ArAgingBucket {
  invoiceCount: number;
  // Σ outstanding of the bucket's invoices.
  amountCents: number;
}

// Invoiced tab KPI tiles: AR aging over sent + overdue invoices by days past due.
export interface ArAging {
  current: ArAgingBucket;
  days1To30: ArAgingBucket;
  days31To60: ArAgingBucket;
  days60Plus: ArAgingBucket;
}

export interface SentInvoicesSummary {
  status: 'sent';
  arAging: ArAging;
}

export interface OverdueOldestInvoice {
  invoiceId: string;
  invoiceNumber: number;
  customerName: string;
  ageDays: number;
}

export interface OverdueInvoicesSummary {
  status: 'overdue';
  invoiceCount: number;
  // Σ outstanding.
  amountCents: number;
  // Rows with ageDays > 60 (age from issue, Runtruck1's rule).
  inCollectionsCount: number;
  oldest: OverdueOldestInvoice | null;
  // Distinct customers of the rows.
  accountsAffected: number;
  // Count of the organization's customers.
  totalAccounts: number;
}

export interface PaidInvoicesSummary {
  status: 'paid';
  // First day of the current org month ("September" note).
  monthStart: string;
  // Rows whose latestPayment.paidOn is in the current month.
  paidThisMonthCount: number;
  // Σ payments received in the current month (org timezone), any invoice.
  collectedThisMonthCents: number;
  // round(Σ coalesce(daysToPay, 0) / max(rows, 1)) over every row.
  avgDaysToPay: number;
  // Rows whose latest payment method is factoring.
  factoredCount: number;
  // Σ amountCents of those rows.
  factoredCents: number;
  // Distinct factoring company names of those rows, sorted by name.
  factoringCompanyNames: string[];
}

export interface DraftInvoicesSummary {
  status: 'draft';
  invoiceCount: number;
  amountCents: number;
}

export type InvoiceListSummary = DraftInvoicesSummary | SentInvoicesSummary | OverdueInvoicesSummary | PaidInvoicesSummary;

export interface InvoiceListMeta extends PageMeta {
  summary: InvoiceListSummary;
}

// ---------------------------------------------------------------------------
// GET /invoice-batches
// ---------------------------------------------------------------------------

export interface InvoiceBatchRecipient {
  kind: InvoiceBatchRecipientKind;
  id: string;
  name: string;
}

export interface InvoiceBatchRow {
  id: string;
  batchNumber: number;
  createdOn: string;
  status: InvoiceBatchStatus;
  recipient: InvoiceBatchRecipient;
  // "Northgate Foods" or "TriPoint Capital (factoring)" (docs/03 §6.0.8).
  sentTo: string;
  // Count of the batch's invoice_batch_items.
  invoiceCount: number;
  // Σ invoice totals of the member invoices.
  totalCents: number;
}

export interface InvoiceBatchesSummary {
  batchCount: number;
  // Σ invoiceCount over every batch.
  invoiceCount: number;
  readyCount: number;
  readyTotalCents: number;
  // status 'sent' and today − createdOn < 7.
  sentThisWeekCount: number;
  // Σ totalCents over every batch.
  totalCents: number;
}

export interface InvoiceBatchesMeta extends PageMeta {
  summary: InvoiceBatchesSummary;
}
