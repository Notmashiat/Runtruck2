import { InvoicedTab } from '@/components/accounting/InvoicedTab';
import { sentInvoicesQuery } from '@/lib/api/billing';
import { Prefetch } from '@/lib/api/prefetch';
import { getMe } from '@/lib/api/server';

// Accounting › Invoiced (implementation-brief §4: prefetched for the first paint).
export default async function InvoicedPage() {
  const me = await getMe();
  const queries = me?.permissions.includes('billing.view') ? [sentInvoicesQuery] : [];
  return (
    <Prefetch queries={queries}>
      <InvoicedTab />
    </Prefetch>
  );
}
