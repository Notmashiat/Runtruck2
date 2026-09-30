import type {
  InvoiceBatchesMeta,
  InvoiceBatchRow,
  InvoiceListMeta,
  InvoiceRow,
  UninvoicedLoadRow,
  UninvoicedLoadsMeta,
} from '@runtruck/types';
import { useCurrentPathname } from '@/components/accounting/use-current-pathname';
import { useSession } from '@/context/SessionContext';
import { apiQuery, useApiQuery } from './query';

// Receivables reads (docs/api/billing.md §7). Every accounting list asks for one bounded
// page (limit=500) and the screen filters it locally (01 §3).

// Uninvoiced tab and the header's "Invoice N loads" (the same cache entry, §7.1). The
// /app layout prefetches it above the Header on /app/accounting/*.
export const uninvoicedLoadsQuery = apiQuery<UninvoicedLoadRow[], UninvoicedLoadsMeta>(['billing', 'uninvoiced-loads'], '/billing/uninvoiced-loads?limit=500');

export const sentInvoicesQuery = apiQuery<InvoiceRow[], InvoiceListMeta>(['invoices', 'sent'], '/invoices?status=sent&limit=500');

export const overdueInvoicesQuery = apiQuery<InvoiceRow[], InvoiceListMeta>(['invoices', 'overdue'], '/invoices?status=overdue&limit=500');

export const paidInvoicesQuery = apiQuery<InvoiceRow[], InvoiceListMeta>(['invoices', 'paid'], '/invoices?status=paid&limit=500');

export const invoiceBatchesQuery = apiQuery<InvoiceBatchRow[], InvoiceBatchesMeta>(['invoice-batches'], '/invoice-batches?limit=500');

// "Invoice N loads": the uninvoiced count, or undefined while unknown or not permitted
// (the Header then hides the button, so "Invoice  loads" never renders). It fetches only
// on the Uninvoiced tab and only for a member with billing.view; elsewhere it reads what
// the server hydrated above the Header (billing.md §7.1, 01 C50).
export function useUninvoicedCount(): number | undefined {
  const pathname = useCurrentPathname();
  const { can } = useSession();
  const permitted = can('billing.view');
  const { data } = useApiQuery(uninvoicedLoadsQuery, { enabled: permitted && pathname.toLowerCase() === '/app/accounting/uninvoiced' });
  return permitted ? data?.meta.summary.loadCount : undefined;
}
