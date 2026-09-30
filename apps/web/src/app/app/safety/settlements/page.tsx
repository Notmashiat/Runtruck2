import { ClaimSettlementsTab } from '@/components/safety/ClaimSettlementsTab';
import { Prefetch } from '@/lib/api/prefetch';
import { claimsQuery } from '@/lib/api/safety';
import { getMe } from '@/lib/api/server';

// Safety › Settlements = cargo and liability claims, prefetched for the first paint
// (implementation-brief §4). Without claims.view nothing is requested (safety.md S6).
export default async function SafetySettlementsPage() {
  const me = await getMe();
  return (
    <Prefetch queries={me?.permissions.includes('claims.view') ? [claimsQuery] : []}>
      <ClaimSettlementsTab />
    </Prefetch>
  );
}
