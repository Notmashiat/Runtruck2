import { Logger } from '@nestjs/common';
import type { DomainEventJob } from './domain-events.js';

// A consumer of domain events. Handlers must be idempotent: BullMQ retries a
// failed job, so the same event can be delivered more than once (§23, §24).
export interface DomainEventHandler {
  readonly name: string;
  handles(type: string): boolean;
  handle(event: DomainEventJob): Promise<void>;
}

// Records that each event was processed. Notification, integration and AI
// handlers (Phases 9–15) register alongside it.
export class EventLogHandler implements DomainEventHandler {
  readonly name = 'event-log';
  private readonly logger = new Logger('DomainEvents');

  handles(): boolean {
    return true;
  }

  handle(event: DomainEventJob): Promise<void> {
    this.logger.log({ message: 'Domain event processed', type: event.type, eventId: event.eventId, organizationId: event.organizationId });
    return Promise.resolve();
  }
}

export async function dispatchEvent(handlers: readonly DomainEventHandler[], event: DomainEventJob): Promise<void> {
  for (const handler of handlers) {
    if (handler.handles(event.type)) await handler.handle(event);
  }
}
