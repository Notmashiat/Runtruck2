import type { AuditEntry } from '../audit/audit.service.js';
import type { DomainEvent } from '../events/domain-events.js';

// Audit action and domain event of the S2 transition, one per approved settlement
// (docs/api/settlements.md §3.4, docs/17-event-architecture.md §5).

export const SETTLEMENT_APPROVED = 'SETTLEMENT_APPROVED';
export const SETTLEMENT_APPROVED_EVENT = 'SettlementApproved';

export interface ApprovedSettlement {
  id: string;
  driverId: string;
  driverName: string;
  periodStart: string;
}

export type SettlementApprovedPayload = { settlementId: string; driverId: string; periodStart: string } & Record<string, unknown>;

// The event carries ids only: no names or money (19 §1).
export function settlementApprovedEvent(s: ApprovedSettlement): DomainEvent<SettlementApprovedPayload> {
  return {
    type: SETTLEMENT_APPROVED_EVENT,
    aggregateType: 'settlement',
    aggregateId: s.id,
    payload: { settlementId: s.id, driverId: s.driverId, periodStart: s.periodStart },
  };
}

// "Marcus Hale · 2026-09-01"; previous/next record the transition and who made it.
export function settlementApprovedAudit(s: ApprovedSettlement, approvedAt: Date, approvedByUserId: string): AuditEntry {
  return {
    action: SETTLEMENT_APPROVED,
    entityType: 'settlement',
    entityId: s.id,
    entityLabel: `${s.driverName} · ${s.periodStart}`,
    previous: { status: 'ready' },
    next: { status: 'approved', approvedAt: approvedAt.toISOString(), approvedByUserId },
    occurredAt: approvedAt,
  };
}
