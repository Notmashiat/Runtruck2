// Domain event contract (architecture §23, docs/17-event-architecture.md).
// Event types are PascalCase past-tense facts; payloads carry ids, not whole rows.

export interface DomainEvent<P extends Record<string, unknown> = Record<string, unknown>> {
  type: string;
  aggregateType: string;
  aggregateId: string;
  payload: P;
}

// Job carried on the BullMQ `domain-events` queue. The job id is the outbox row
// id, so publishing the same event twice is deduplicated by BullMQ.
export interface DomainEventJob {
  eventId: string;
  organizationId: string;
  type: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  occurredAt: string;
}

export const DOMAIN_EVENTS_QUEUE = 'domain-events';
