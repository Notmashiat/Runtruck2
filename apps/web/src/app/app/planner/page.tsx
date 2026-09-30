import { DEFAULT_PREFS } from '@/components/planner/planner-data';
import { PlannerPage } from '@/components/planner/PlannerPage';
import { plannerColorCodesQuery, plannerEventsQuery, plannerRange, plannerStopValuesQuery } from '@/lib/api/planner';
import { Prefetch } from '@/lib/api/prefetch';
import type { ApiQueryDef } from '@/lib/api/query';
import { getMe } from '@/lib/api/server';
import { fromIso } from '@/lib/dates';

// The Planner (docs/api/planner.md §7). The first paint has the calendar: the events of the
// default view (Week from Monday around the organization's today), the color codes and the
// stop values are prefetched when the member holds planner.view (implementation-brief §4
// rule 1). View preferences live in the browser, so a member whose saved view differs
// fetches that range after hydration.
export default async function PlannerRoute() {
  const me = await getMe();
  const queries: ApiQueryDef<unknown, object>[] = [];
  if (me?.permissions.includes('planner.view')) {
    const { from, to } = plannerRange(DEFAULT_PREFS.view, fromIso(me.today), DEFAULT_PREFS.weekStart);
    queries.push(plannerEventsQuery(from, to), plannerColorCodesQuery, plannerStopValuesQuery);
  }
  return (
    <Prefetch queries={queries}>
      <PlannerPage />
    </Prefetch>
  );
}
