import { BatchesTab } from '@/components/accounting/BatchesTab';
import { invoiceBatchesQuery } from '@/lib/api/billing';
import { Prefetch } from '@/lib/api/prefetch';
import { getMe } from '@/lib/api/server';

// Accounting › Batches (implementation-brief §4: prefetched for the first paint).
export default async function BatchesPage() {
  const me = await getMe();
  const queries = me?.permissions.includes('billing.view') ? [invoiceBatchesQuery] : [];
  return (
    <Prefetch queries={queries}>
      <BatchesTab />
    </Prefetch>
  );
}
