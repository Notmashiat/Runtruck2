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
    await this.emitMany(tx, ctx, [event], occurredAt);
  }

  // Several events of one change in ONE multi-row INSERT (architecture §38: no N+1 writes).
  // Nothing is written for [].
  async emitMany(
    tx: DbExecutor,
    ctx: Pick<AuthContext, 'organizationId' | 'userId'>,
    events: readonly DomainEvent[],
    occurredAt?: Date,
  ): Promise<void> {
    if (events.length === 0) return;
    const requestId = currentRequestId() ?? null;
    await tx.insert(schema.events).values(
      events.map((event) => ({
        organizationId: ctx.organizationId,
        type: event.type,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        payload: event.payload,
        actorUserId: ctx.userId,
        requestId,
        ...(occurredAt ? { occurredAt } : {}),
      })),
    );
  }
}
