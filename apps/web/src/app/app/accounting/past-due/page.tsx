import { PastDueTab } from '@/components/accounting/PastDueTab';
import { overdueInvoicesQuery } from '@/lib/api/billing';
import { Prefetch } from '@/lib/api/prefetch';
import { getMe } from '@/lib/api/server';

// Accounting › Past Due (implementation-brief §4: prefetched for the first paint).
export default async function PastDuePage() {
  const me = await getMe();
  const queries = me?.permissions.includes('billing.view') ? [overdueInvoicesQuery] : [];
  return (
    <Prefetch queries={queries}>
      <PastDueTab />
    </Prefetch>
  );
}
