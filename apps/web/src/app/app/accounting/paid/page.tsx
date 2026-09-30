import { PaidTab } from '@/components/accounting/PaidTab';
import { paidInvoicesQuery } from '@/lib/api/billing';
import { Prefetch } from '@/lib/api/prefetch';
import { getMe } from '@/lib/api/server';

// Accounting › Paid (implementation-brief §4: prefetched for the first paint).
export default async function PaidPage() {
  const me = await getMe();
  const queries = me?.permissions.includes('billing.view') ? [paidInvoicesQuery] : [];
  return (
    <Prefetch queries={queries}>
      <PaidTab />
    </Prefetch>
  );
}
