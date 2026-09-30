import { ViolationsTab } from '@/components/safety/ViolationsTab';
import { Prefetch } from '@/lib/api/prefetch';
import { violationsQuery } from '@/lib/api/safety';
import { getMe } from '@/lib/api/server';

// Safety › Violations, with the violations prefetched for the first paint (implementation-brief §4).
export default async function ViolationsPage() {
  const me = await getMe();
  return (
    <Prefetch queries={me?.permissions.includes('compliance.view') ? [violationsQuery] : []}>
      <ViolationsTab />
    </Prefetch>
  );
}
