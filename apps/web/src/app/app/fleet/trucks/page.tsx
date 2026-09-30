import { TrucksTab } from '@/components/fleet/TrucksTab';
import { trucksQuery } from '@/lib/api/fleet';
import { Prefetch } from '@/lib/api/prefetch';
import { getMe } from '@/lib/api/server';

// Fleet › Trucks, with the power units prefetched for the first paint (implementation-brief §4).
export default async function TrucksPage() {
  const me = await getMe();
  return (
    <Prefetch queries={me?.permissions.includes('trucks.view') ? [trucksQuery] : []}>
      <TrucksTab />
    </Prefetch>
  );
}
