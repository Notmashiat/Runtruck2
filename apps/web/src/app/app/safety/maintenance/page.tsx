import { MaintenanceTab } from '@/components/safety/MaintenanceTab';
import { Prefetch } from '@/lib/api/prefetch';
import { workOrdersQuery } from '@/lib/api/safety';
import { getMe } from '@/lib/api/server';

// Safety › Maintenance, with the work orders prefetched for the first paint (implementation-brief §4).
export default async function MaintenancePage() {
  const me = await getMe();
  return (
    <Prefetch queries={me?.permissions.includes('maintenance.view') ? [workOrdersQuery] : []}>
      <MaintenanceTab />
    </Prefetch>
  );
}
