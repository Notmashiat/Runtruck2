import { Injectable } from '@nestjs/common';
import { type DbExecutor, schema } from '@runtruck/database';
import type { AuthContext } from '../auth/auth-context.js';
import { currentRequestId } from '../common/request-context/request-context.js';
import type { DomainEvent } from './domain-events.js';

// Records a domain event in the transactional outbox (architecture §23). The
// event row commits with the business change or not at all; the worker then
// publishes it to BullMQ, so a crash between "saved" and "announced" is impossible.
@Injectable()
export class EventsService {
  async emit(tx: DbExecutor, ctx: Pick<AuthContext, 'organizationId' | 'userId'>, event: DomainEvent, occurredAt?: Date): Promise<void> {
    await tx.insert(schema.events).values({
      organizationId: ctx.organizationId,
      type: event.type,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      payload: event.payload,
      actorUserId: ctx.userId,
      requestId: currentRequestId() ?? null,
      ...(occurredAt ? { occurredAt } : {}),
    });
  }
}
