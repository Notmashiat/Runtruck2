import type { DraftInvoicesSummary, OverdueInvoicesSummary, PaidInvoicesSummary } from '@runtruck/types';
import type { DraftAggregate, OverdueAggregate, PaidAggregate } from './invoices.repository.js';

// Pure assembly of the status-discriminated meta.summary (docs/api/billing.md §4.4–§4.6)
// from the SQL aggregates. Kept separate so the rounding rules are unit-tested.

// Runtruck1: Math.round(Σ days / Math.max(PAID.length, 1)) over every paid row; a paid
// invoice without a payment contributes 0 days (billing.md §4.5, 01 C48).
export function averageDaysToPay(daysToPaySum: number, rowCount: number): number {
  return Math.round(daysToPaySum / Math.max(rowCount, 1));
}

export function paidSummary(agg: PaidAggregate, monthStart: string): PaidInvoicesSummary {
  return {
    status: 'paid',
    monthStart,
    paidThisMonthCount: agg.paidThisMonthCount,
    collectedThisMonthCents: agg.collectedThisMonthCents,
    avgDaysToPay: averageDaysToPay(agg.daysToPaySum, agg.rowCount),
    factoredCount: agg.factoredCount,
    factoredCents: agg.factoredCents,
    factoringCompanyNames: agg.factoringCompanyNames,
  };
}

export function overdueSummary(agg: OverdueAggregate): OverdueInvoicesSummary {
  return {
    status: 'overdue',
    invoiceCount: agg.rowCount,
    amountCents: agg.amountCents,
    inCollectionsCount: agg.inCollectionsCount,
    oldest: agg.oldest,
    accountsAffected: agg.accountsAffected,
    totalAccounts: agg.totalAccounts,
  };
}

export function draftSummary(agg: DraftAggregate): DraftInvoicesSummary {
  return { status: 'draft', invoiceCount: agg.rowCount, amountCents: agg.amountCents };
}
