import { CustomersPage } from '@/components/crm/CustomersPage';
import { customersQuery } from '@/lib/api/customers';
import { Prefetch } from '@/lib/api/prefetch';
import { getMe } from '@/lib/api/server';

// CRM, with the accounts prefetched for the first paint (implementation-brief §4).
export default async function CrmPage() {
  const me = await getMe();
  return (
    <Prefetch queries={me?.permissions.includes('customers.view') ? [customersQuery] : []}>
      <CustomersPage />
    </Prefetch>
  );
}
