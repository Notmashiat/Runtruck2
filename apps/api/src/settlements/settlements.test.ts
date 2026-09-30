import { describe, expect, it } from 'vitest';
import { APPROVABLE_STATUS, canTransition, isAllApproved } from './settlement-state.js';
import { settlementApprovedAudit, settlementApprovedEvent } from './settlements.events.js';
import { EMPTY_PERIOD_AGGREGATE, settlementsSummary } from './settlements.summary.js';

describe('settlement state machine (12 §4)', () => {
  it('allows ready → approved and nothing that would undo a payout', () => {
    expect(APPROVABLE_STATUS).toBe('ready');
    expect(canTransition('ready', 'approved')).toBe(true);
    expect(canTransition('approved', 'ready')).toBe(false);
    expect(canTransition('on_hold', 'approved')).toBe(false);
    expect(canTransition('paid', 'ready')).toBe(false);
    expect(canTransition('paid', 'approved')).toBe(false);
  });

  it("derives Runtruck1's approved flag", () => {
    expect(isAllApproved(3, 0)).toBe(false);
    expect(isAllApproved(0, 3)).toBe(true);
    // Only held or paid rows (or none): not approved.
    expect(isAllApproved(0, 0)).toBe(false);
    expect(isAllApproved(1, 2)).toBe(false);
  });
});

describe('settlementsSummary', () => {
  const agg = { driverCount: 5, readyCount: 3, approvedCount: 0, onHoldCount: 1, paidCount: 1, grossCents: 547_700, deductionsCents: -51_200, periodEnd: '2026-09-07' };

  it('matches the seed before approval (settlements.md §2.3)', () => {
    expect(settlementsSummary('2026-09-01', agg)).toEqual({
      period: { start: '2026-09-01', end: '2026-09-07' },
      driverCount: 5,
      readyCount: 3,
      approvedCount: 0,
      onHoldCount: 1,
      paidCount: 1,
      grossCents: 547_700,
      deductionsCents: -51_200,
      netCents: 496_500,
      allApproved: false,
    });
  });

  it('after approval and without a period', () => {
    expect(settlementsSummary('2026-09-01', { ...agg, readyCount: 0, approvedCount: 3 }).allApproved).toBe(true);
    expect(settlementsSummary(null, EMPTY_PERIOD_AGGREGATE)).toMatchObject({ period: null, driverCount: 0, netCents: 0, allApproved: false });
    expect(settlementsSummary('2026-08-25', EMPTY_PERIOD_AGGREGATE).period).toEqual({ start: '2026-08-25', end: null });
  });
});

describe('SettlementApproved audit and event', () => {
  const settlement = { id: 's-1', driverId: 'd-1', driverName: 'Marcus Hale', periodStart: '2026-09-01' };
  const at = new Date('2026-09-03T17:00:00.000Z');

  it('event carries ids only', () => {
    expect(settlementApprovedEvent(settlement)).toEqual({
      type: 'SettlementApproved',
      aggregateType: 'settlement',
      aggregateId: 's-1',
      payload: { settlementId: 's-1', driverId: 'd-1', periodStart: '2026-09-01' },
    });
  });

  it('audit records the transition and the approver', () => {
    expect(settlementApprovedAudit(settlement, at, 'u-1')).toEqual({
      action: 'SETTLEMENT_APPROVED',
      entityType: 'settlement',
      entityId: 's-1',
      entityLabel: 'Marcus Hale · 2026-09-01',
      previous: { status: 'ready' },
      next: { status: 'approved', approvedAt: '2026-09-03T17:00:00.000Z', approvedByUserId: 'u-1' },
      occurredAt: at,
    });
  });
});
