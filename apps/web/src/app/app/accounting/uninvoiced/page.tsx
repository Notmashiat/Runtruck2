import { UninvoicedTab } from '@/components/accounting/UninvoicedTab';
import { uninvoicedLoadsQuery } from '@/lib/api/billing';
import { Prefetch } from '@/lib/api/prefetch';
import { getMe } from '@/lib/api/server';

// Accounting › Uninvoiced. The first paint has the data (implementation-brief §4 rule 1);
// the same cache entry feeds the header's "Invoice N loads".
export default async function UninvoicedPage() {
  const me = await getMe();
  const queries = me?.permissions.includes('billing.view') ? [uninvoicedLoadsQuery] : [];
  return (
    <Prefetch queries={queries}>
      <UninvoicedTab />
    </Prefetch>
  );
}
