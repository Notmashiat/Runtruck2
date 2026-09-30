import { EmployeeContractsTab } from '@/components/hr/EmployeeContractsTab';
import { employeeContractsQuery } from '@/lib/api/hr';
import { Prefetch } from '@/lib/api/prefetch';
import { getMe } from '@/lib/api/server';

// HR › Employee Contracts, with the contracts prefetched for the first paint (implementation-brief §4).
export default async function EmployeeContractsPage() {
  const me = await getMe();
  return (
    <Prefetch queries={me?.permissions.includes('hr.view') ? [employeeContractsQuery] : []}>
      <EmployeeContractsTab />
    </Prefetch>
  );
}
