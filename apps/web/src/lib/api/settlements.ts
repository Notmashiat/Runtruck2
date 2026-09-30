import type { ApiSuccess, SettlementRow, SettlementsApproveMeta, SettlementsMeta } from '@runtruck/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { api } from './client';
import { apiQuery } from './query';

// Driver payroll (docs/api/settlements.md §5). Without periodStart the API picks the
// current pay period.
export const currentSettlementsQuery = apiQuery<SettlementRow[], SettlementsMeta>(['settlements', 'current'], '/settlements?limit=500');

type CurrentSettlements = ApiSuccess<SettlementRow[], SettlementsMeta>;

// "Approve all" (Payroll card) and "Run settlements" (header): one shared mutation. It
// approves the period on screen (the cached current period); with no period it does
// nothing. On success the response replaces the cached period, so no refetch is needed;
// on error nothing changes. The link stays clickable: a repeat is an idempotent no-op on
// the server, as clicking "Approved" was in Runtruck1.
export function useApproveSettlements(): () => void {
  const queryClient = useQueryClient();
  const { mutate } = useMutation({
    // A read of the period already in flight (e.g. a refetch on mount) may reflect the state
    // before the approval and land after the response, putting "Ready" back on screen.
    onMutate: () => queryClient.cancelQueries({ queryKey: currentSettlementsQuery.queryKey }),
    mutationFn: (periodStart: string) => api.post<SettlementRow[], SettlementsApproveMeta>('/settlements/approve', { periodStart }),
    onSuccess: ({ data, meta }) => {
      const { approvedNow: _approvedNow, ...listMeta } = meta;
      queryClient.setQueryData<CurrentSettlements>(currentSettlementsQuery.queryKey, { data, meta: listMeta });
    },
  });
  return useCallback(() => {
    const current = queryClient.getQueryData<CurrentSettlements>(currentSettlementsQuery.queryKey);
    const periodStart = current?.meta.summary.period?.start;
    if (periodStart) mutate(periodStart);
  }, [queryClient, mutate]);
}
