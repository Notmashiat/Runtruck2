import { PayrollTab } from '@/components/accounting/PayrollTab';
import { Prefetch } from '@/lib/api/prefetch';
import { getMe } from '@/lib/api/server';
import { currentSettlementsQuery } from '@/lib/api/settlements';

// Accounting › Payroll (implementation-brief §4: prefetched for the first paint). The
// header's "Run settlements" approves the period this cache entry holds.
export default async function PayrollPage() {
  const me = await getMe();
  const queries = me?.permissions.includes('settlements.view') ? [currentSettlementsQuery] : [];
  return (
    <Prefetch queries={queries}>
      <PayrollTab />
    </Prefetch>
  );
}
