import type { SettlementsSummary } from '@runtruck/types';
import { isAllApproved } from './settlement-state.js';
import type { PeriodAggregate } from './settlements.repository.js';

// meta.summary of GET /settlements and POST /settlements/approve (docs/api/settlements.md §2.3):
// every settlement of the period, any status, including held and paid ones (12 §6).
export function settlementsSummary(periodStart: string | null, agg: PeriodAggregate): SettlementsSummary {
  return {
    period: periodStart ? { start: periodStart, end: agg.periodEnd } : null,
    driverCount: agg.driverCount,
    readyCount: agg.readyCount,
    approvedCount: agg.approvedCount,
    onHoldCount: agg.onHoldCount,
    paidCount: agg.paidCount,
    grossCents: agg.grossCents,
    deductionsCents: agg.deductionsCents,
    netCents: agg.grossCents + agg.deductionsCents,
    allApproved: isAllApproved(agg.readyCount, agg.approvedCount),
  };
}

export const EMPTY_PERIOD_AGGREGATE: PeriodAggregate = {
  driverCount: 0,
  readyCount: 0,
  approvedCount: 0,
  onHoldCount: 0,
  paidCount: 0,
  grossCents: 0,
  deductionsCents: 0,
  periodEnd: null,
};
