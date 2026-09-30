import type { AuditEntry } from '../audit/audit.service.js';
import type { DomainEvent } from '../events/domain-events.js';
import type { PlannerEventFieldKey, PlannerEventFields } from './planner.mapper.js';

// Audit actions and domain events of the planner (docs/api/planner.md §5, docs/17 §5).
// Audit rows carry the editable fields; event payloads carry ids only.

export const PLANNER_AUDIT = {
  eventCreated: 'PLANNER_EVENT_CREATED',
  eventUpdated: 'PLANNER_EVENT_UPDATED',
  eventDeleted: 'PLANNER_EVENT_DELETED',
  colorCodeCreated: 'PLANNER_COLOR_CODE_CREATED',
  colorCodeUpdated: 'PLANNER_COLOR_CODE_UPDATED',
  colorCodeDeleted: 'PLANNER_COLOR_CODE_DELETED',
  reset: 'PLANNER_RESET',
} as const;

export interface ColorCodeFields {
  key: string;
  label: string;
  tone: string;
}

export interface ResetCounts {
  eventCount: number;
  colorCodeCount: number;
}

// ─── office events ──────────────────────────────────────────────────────────────────────

export function eventCreatedAudit(id: string, fields: PlannerEventFields): AuditEntry {
  return { action: PLANNER_AUDIT.eventCreated, entityType: 'planner_event', entityId: id, entityLabel: fields.title, next: fields };
}

export function eventCreatedEvent(id: string, fields: PlannerEventFields): DomainEvent {
  return {
    type: 'PlannerEventCreated',
    aggregateType: 'planner_event',
    aggregateId: id,
    payload: { plannerEventId: id, colorCodeId: fields.colorCodeId, startsOn: fields.date },
  };
}

export function eventUpdatedAudit(
  id: string,
  title: string,
  previous: Partial<PlannerEventFields>,
  next: Partial<PlannerEventFields>,
): AuditEntry {
  return { action: PLANNER_AUDIT.eventUpdated, entityType: 'planner_event', entityId: id, entityLabel: title, previous, next };
}

export function eventUpdatedEvent(id: string, changedFields: readonly PlannerEventFieldKey[]): DomainEvent {
  return {
    type: 'PlannerEventUpdated',
    aggregateType: 'planner_event',
    aggregateId: id,
    payload: { plannerEventId: id, changedFields: [...changedFields] },
  };
}

export function eventDeletedAudit(id: string, fields: PlannerEventFields): AuditEntry {
  return { action: PLANNER_AUDIT.eventDeleted, entityType: 'planner_event', entityId: id, entityLabel: fields.title, previous: fields };
}

export function eventDeletedEvent(id: string): DomainEvent {
  return { type: 'PlannerEventDeleted', aggregateType: 'planner_event', aggregateId: id, payload: { plannerEventId: id } };
}

// ─── color codes ────────────────────────────────────────────────────────────────────────

export function colorCodeCreatedAudit(id: string, fields: ColorCodeFields): AuditEntry {
  return {
    action: PLANNER_AUDIT.colorCodeCreated,
    entityType: 'planner_color_code',
    entityId: id,
    entityLabel: fields.label,
    next: fields,
  };
}

export function colorCodeCreatedEvent(id: string): DomainEvent {
  return { type: 'PlannerColorCodeCreated', aggregateType: 'planner_color_code', aggregateId: id, payload: { colorCodeId: id } };
}

export function colorCodeUpdatedAudit(
  id: string,
  label: string,
  previous: Partial<ColorCodeFields>,
  next: Partial<ColorCodeFields>,
): AuditEntry {
  return { action: PLANNER_AUDIT.colorCodeUpdated, entityType: 'planner_color_code', entityId: id, entityLabel: label, previous, next };
}

export function colorCodeUpdatedEvent(id: string, changedFields: readonly string[]): DomainEvent {
  return {
    type: 'PlannerColorCodeUpdated',
    aggregateType: 'planner_color_code',
    aggregateId: id,
    payload: { colorCodeId: id, changedFields: [...changedFields] },
  };
}

export function colorCodeDeletedAudit(
  id: string,
  fields: ColorCodeFields,
  reassignedToColorCodeId: string,
  reassignedEventCount: number,
): AuditEntry {
  return {
    action: PLANNER_AUDIT.colorCodeDeleted,
    entityType: 'planner_color_code',
    entityId: id,
    entityLabel: fields.label,
    previous: fields,
    next: { reassignedToColorCodeId, reassignedEventCount },
  };
}

export function colorCodeDeletedEvent(id: string, reassignedToColorCodeId: string, reassignedEventCount: number): DomainEvent {
  return {
    type: 'PlannerColorCodeDeleted',
    aggregateType: 'planner_color_code',
    aggregateId: id,
    payload: { colorCodeId: id, reassignedToColorCodeId, reassignedEventCount },
  };
}

// ─── reset ──────────────────────────────────────────────────────────────────────────────

export function resetAudit(organizationId: string, organizationName: string, previous: ResetCounts, next: ResetCounts): AuditEntry {
  return {
    action: PLANNER_AUDIT.reset,
    entityType: 'organization',
    entityId: organizationId,
    entityLabel: organizationName,
    previous,
    next,
  };
}

export function resetEvent(organizationId: string, counts: ResetCounts): DomainEvent {
  return {
    type: 'PlannerReset',
    aggregateType: 'organization',
    aggregateId: organizationId,
    payload: { eventCount: counts.eventCount, colorCodeCount: counts.colorCodeCount },
  };
}
