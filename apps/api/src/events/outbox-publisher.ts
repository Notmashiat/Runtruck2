import { Logger } from '@nestjs/common';
import { type Database, schema } from '@runtruck/database';
import type { Queue } from 'bullmq';
import { and, asc, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import type { DomainEventJob } from './domain-events.js';

const { events } = schema;

const BATCH_SIZE = 100;
// After this many failed publish attempts an event is left for an operator
// ("dead-lettered"): it stays in the table, unpublished, with its last error.
export const MAX_PUBLISH_ATTEMPTS = 10;

export interface OutboxPublisherOptions {
  // How long the enqueue may take before the batch counts as failed (default 10 s).
  enqueueTimeoutMs?: number;
  // How long a claimed batch is reserved for this publisher (default 60 s). Must exceed the
  // enqueue timeout, so no other publisher claims a batch that is still being enqueued.
  leaseSeconds?: number;
}

export class EnqueueTimeoutError extends Error {
  constructor(ms: number) {
    super(`Enqueue did not finish within ${ms} ms (Redis unavailable?)`);
    this.name = 'EnqueueTimeoutError';
  }
}

// Moves committed outbox rows onto the BullMQ queue (architecture §23, §24;
// docs/17-event-architecture.md §2). No database transaction is ever held across the
// Redis call: a Redis outage must not keep a connection "idle in transaction" with row
// locks and a pinned vacuum horizon.
//   1. claim: one short statement leases up to 100 due rows (FOR UPDATE SKIP LOCKED in a
//      subquery, `claimed_until = now() + lease`), so several workers never claim the same
//      rows and a crashed worker's rows come back when its lease ends;
//   2. enqueue: `addBulk` outside any transaction, with a deadline;
//   3. settle: one short statement marks the rows published, or counts the failed attempt
//      and releases the lease so the next poll retries them.
// Each job id is the event id, so BullMQ ignores a re-publish (after a crash between
// enqueue and settle, or an enqueue that finished after its deadline).
export class OutboxPublisher {
  private readonly logger = new Logger(OutboxPublisher.name);
  private readonly enqueueTimeoutMs: number;
  private readonly leaseSeconds: number;

  constructor(
    private readonly db: Database,
    private readonly queue: Queue<DomainEventJob>,
    options: OutboxPublisherOptions = {},
  ) {
    this.enqueueTimeoutMs = options.enqueueTimeoutMs ?? 10_000;
    this.leaseSeconds = options.leaseSeconds ?? 60;
    if (this.leaseSeconds * 1_000 <= this.enqueueTimeoutMs) throw new Error('The outbox lease must be longer than the enqueue timeout');
  }

  // Publishes one batch; returns how many events were published.
  async publishBatch(): Promise<number> {
    const rows = await this.claim();
    if (rows.length === 0) return 0;
    const ids = rows.map((e) => e.id);

    try {
      await this.withDeadline(
        this.queue.addBulk(
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
        ),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const deadLettered = rows.filter((e) => e.publishAttempts + 1 >= MAX_PUBLISH_ATTEMPTS).map((e) => e.id);
      this.logger.error({ message: 'Failed to publish outbox batch', error: message, deadLettered });
      await this.db
        .update(events)
        .set({ publishAttempts: sql`${events.publishAttempts} + 1`, lastError: message.slice(0, 1_000), claimedUntil: null })
        .where(inArray(events.id, ids));
      return 0;
    }

    await this.db
      .update(events)
      .set({ publishedAt: new Date(), publishAttempts: sql`${events.publishAttempts} + 1`, lastError: null, claimedUntil: null })
      .where(inArray(events.id, ids));
    return rows.length;
  }

  // Leases the oldest due rows in one autocommitted statement and returns them in
  // occurred_at order.
  private async claim() {
    const due = this.db
      .select({ id: events.id })
      .from(events)
      .where(
        and(
          isNull(events.publishedAt),
          lt(events.publishAttempts, MAX_PUBLISH_ATTEMPTS),
          or(isNull(events.claimedUntil), lt(events.claimedUntil, sql`now()`)),
        ),
      )
      .orderBy(asc(events.occurredAt))
      .limit(BATCH_SIZE)
      .for('update', { skipLocked: true });
    const rows = await this.db
      .update(events)
      .set({ claimedUntil: sql`now() + ${this.leaseSeconds}::int * interval '1 second'` })
      .where(inArray(events.id, due))
      .returning();
    return rows.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  }

  // Settles with the enqueue, or rejects once the deadline passes. A late enqueue is
  // harmless: the rows stay unpublished and their re-publish is deduplicated by job id.
  private async withDeadline<T>(work: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new EnqueueTimeoutError(this.enqueueTimeoutMs));
      }, this.enqueueTimeoutMs);
    });
    try {
      return await Promise.race([work, deadline]);
    } finally {
      clearTimeout(timer);
      // A late rejection of the abandoned enqueue must not surface as unhandled.
      work.catch(() => undefined);
    }
  }
}
