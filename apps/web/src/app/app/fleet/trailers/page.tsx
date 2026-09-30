import { TrailersTab } from '@/components/fleet/TrailersTab';
import { trailersQuery } from '@/lib/api/fleet';
import { Prefetch } from '@/lib/api/prefetch';
import { getMe } from '@/lib/api/server';

// Fleet › Trailers, with the trailers prefetched for the first paint (implementation-brief §4).
export default async function TrailersPage() {
  const me = await getMe();
  return (
    <Prefetch queries={me?.permissions.includes('trailers.view') ? [trailersQuery] : []}>
      <TrailersTab />
    </Prefetch>
  );
}
