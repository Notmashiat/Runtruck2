import { DashboardPage } from '@/components/dashboard/DashboardPage';
import { dashboardQuery } from '@/lib/api/dashboard';
import { loadsBoardQuery } from '@/lib/api/loads';
import { Prefetch } from '@/lib/api/prefetch';
import type { ApiQueryDef } from '@/lib/api/query';
import { getMe } from '@/lib/api/server';

// The operations dashboard. The first paint has the KPIs, table, chart and drivers
// (GET /dashboard with dashboard.view) and the Loads board rows the top-bar search filters
// (GET /loads with loads.view), so the first keystroke already filters (docs/api/dashboard.md
// §5.1, §6 decision 2; implementation-brief §4 rule 1).
export default async function DashboardRoute() {
  const me = await getMe();
  const queries: ApiQueryDef<unknown, object>[] = [];
  if (me?.permissions.includes('dashboard.view')) queries.push(dashboardQuery);
  if (me?.permissions.includes('loads.view')) queries.push(loadsBoardQuery);
  return (
    <Prefetch queries={queries}>
      <DashboardPage />
    </Prefetch>
  );
}
