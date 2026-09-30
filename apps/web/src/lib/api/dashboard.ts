import type { DashboardData, DashboardMeta } from '@runtruck/types';
import { apiQuery, useApiQuery } from './query';

// Dashboard read (docs/api/dashboard.md §5.1). The key is ['dashboard']: New Load and
// document uploads invalidate it (§5.7, LOAD_WRITE_INVALIDATES in ./loads). The table's
// search rows come from the Loads board query (loadsBoardQuery in ./loads, shared cache).

export const dashboardQuery = apiQuery<DashboardData, DashboardMeta>(['dashboard'], '/dashboard');

// A refetch keeps the previous figures on screen (implementation-brief §4 rule 2).
export const useDashboard = (enabled = true) => useApiQuery(dashboardQuery, { enabled });
