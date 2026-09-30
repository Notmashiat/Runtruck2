import type { SettlementStatus } from '@runtruck/types';

// Settlement state machine (docs/12-settlement-lifecycle.md §4, architecture §18). Only S2
// (ready → approved, "Approve all" / "Run settlements") is built in this release; the other
// edges are the contract for later work and are listed so a new transition must be added here.
export const SETTLEMENT_TRANSITIONS: Readonly<Record<SettlementStatus, readonly SettlementStatus[]>> = {
  ready: ['approved', 'on_hold'],
  on_hold: ['ready'],
  approved: ['paid'],
  paid: [],
};

export function canTransition(from: SettlementStatus, to: SettlementStatus): boolean {
  return SETTLEMENT_TRANSITIONS[from].includes(to);
}

// The bulk approval moves exactly the settlements in this state; held, approved and paid
// rows are skipped, never an error (12 §4 S2).
export const APPROVABLE_STATUS: SettlementStatus = 'ready';

// Runtruck1's "approved" flag: no settlement left to approve and at least one approved
// (docs/api/settlements.md §2.3). A period with only held or paid rows is not "approved".
export function isAllApproved(readyCount: number, approvedCount: number): boolean {
  return readyCount === 0 && approvedCount > 0;
}
