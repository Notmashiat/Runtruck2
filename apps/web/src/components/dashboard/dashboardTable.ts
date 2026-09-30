import type { DashboardLoadRowVm } from '@runtruck/calculations';
import { matchesQuery } from '@/lib/search';

// The "Active loads" card's rows (docs/api/dashboard.md §5.3), Runtruck1's
//   rows = (searching ? loads.filter(l => matchesQuery(l, query)) : active).slice(0, 6)
// `activeRows` are the dashboard's own rows (toDashboardRow); `searchRows` are the Loads
// board view-model rows (toLoadSearchRow: every Runtruck1 `Load` key, so hidden fields
// match too), or the active rows for a member without loads.view. Either is undefined
// while its read is pending, refused or failed. The card belongs to GET /dashboard: while
// that read is pending or refused it shows no rows and no empty-state line even during a
// search (dashboard.md §5.1; implementation-brief §4 rules 2–4), and while searching it
// also waits for the board rows.

export const DASHBOARD_TABLE_LIMIT = 6;

export interface DashboardTable<R extends DashboardLoadRowVm> {
  rows: R[];
  // The rows' source has loaded, so an empty result prints "Nothing matches “{query}”.".
  loaded: boolean;
}

export function dashboardTable<R extends DashboardLoadRowVm>(
  query: string,
  activeRows: readonly R[] | undefined,
  searchRows: readonly R[] | undefined,
): DashboardTable<R> {
  const searching = query.trim().length > 0;
  const source = activeRows && (searching ? searchRows : activeRows);
  if (!source) return { rows: [], loaded: false };
  // A search widens the table to every load; otherwise it is the active set.
  const rows = searching ? source.filter((l) => matchesQuery(l, query)) : [...source];
  return { rows: rows.slice(0, DASHBOARD_TABLE_LIMIT), loaded: true };
}
