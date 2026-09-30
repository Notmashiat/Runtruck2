import { DriverDocumentsTab } from '@/components/safety/DriverDocumentsTab';
import { Prefetch } from '@/lib/api/prefetch';
import { driverDocumentsQuery } from '@/lib/api/safety';
import { getMe } from '@/lib/api/server';

// Safety › Driver Documents, with the qualification files prefetched for the first paint
// (implementation-brief §4). Without compliance.view nothing is requested (safety.md S6).
export default async function DriverDocumentsPage() {
  const me = await getMe();
  return (
    <Prefetch queries={me?.permissions.includes('compliance.view') ? [driverDocumentsQuery] : []}>
      <DriverDocumentsTab />
    </Prefetch>
  );
}
