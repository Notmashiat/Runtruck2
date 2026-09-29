import { Logger } from '@nestjs/common';
import { type Database, schema } from '@runtruck/database';
import type { Queue } from 'bullmq';
import { and, asc, inArray, isNull, lt, sql } from 'drizzle-orm';
import type { DomainEventJob } from './domain-events.js';

const BATCH_SIZE = 100;
// After this many failed publish attempts an event is left for an operator
// ("dead-lettered"): it stays in the table, unpublished, with its last error.
export const MAX_PUBLISH_ATTEMPTS = 10;

// Moves committed outbox rows onto the BullMQ queue (architecture §23, §24).
// Rows are claimed with FOR UPDATE SKIP LOCKED so several workers can run at
// once without double-publishing, and each job id is the event id, so BullMQ
// ignores a re-publish after a crash between enqueue and marking published.
export class OutboxPublisher {
  private readonly logger = new Logger(OutboxPublisher.name);

  constructor(
    private readonly db: Database,
    private readonly queue: Queue<DomainEventJob>,
  ) {}

  // Publishes one batch; returns how many events were published.
  async publishBatch(): Promise<number> {
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(schema.events)
        .where(and(isNull(schema.events.publishedAt), lt(schema.events.publishAttempts, MAX_PUBLISH_ATTEMPTS)))
        .orderBy(asc(schema.events.occurredAt))
        .limit(BATCH_SIZE)
        .for('update', { skipLocked: true });
      if (rows.length === 0) return 0;

      try {
        await this.queue.addBulk(
          rows.map((e) => ({
            name: e.type,
            data: {
              eventId: e.id,
              organizationId: e.organizationId,
              type: e.type,
              aggregateType: e.aggregateType,
              aggregateId: e.aggregateId,
              payload: e.payload as Record<string, unknown>,
              occurredAt: e.occurredAt.toISOString(),
            },
            opts: { jobId: e.id, attempts: 5, backoff: { type: 'exponential', delay: 2_000 }, removeOnComplete: 1_000, removeOnFail: 5_000 },
          })),
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const deadLettered = rows.filter((e) => e.publishAttempts + 1 >= MAX_PUBLISH_ATTEMPTS).map((e) => e.id);
        this.logger.error({ message: 'Failed to publish outbox batch', error: message, deadLettered });
        await tx
          .update(schema.events)
          .set({ publishAttempts: sql`${schema.events.publishAttempts} + 1`, lastError: message.slice(0, 1_000) })
          .where(inArray(schema.events.id, rows.map((e) => e.id)));
        return 0;
      }

      await tx
        .update(schema.events)
        .set({ publishedAt: new Date(), publishAttempts: sql`${schema.events.publishAttempts} + 1`, lastError: null })
        .where(inArray(schema.events.id, rows.map((e) => e.id)));
      return rows.length;
    });
  }
}
