import { BillsTab } from '@/components/accounting/BillsTab';
import { billsQuery } from '@/lib/api/payables';
import { Prefetch } from '@/lib/api/prefetch';
import { getMe } from '@/lib/api/server';

// Accounting › Bills (implementation-brief §4: prefetched for the first paint).
export default async function BillsPage() {
  const me = await getMe();
  const queries = me?.permissions.includes('payables.view') ? [billsQuery] : [];
  return (
    <Prefetch queries={queries}>
      <BillsTab />
    </Prefetch>
  );
}
