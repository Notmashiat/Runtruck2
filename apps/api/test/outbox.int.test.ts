import { randomUUID } from 'node:crypto';
import { schema } from '@runtruck/database';
import { Queue } from 'bullmq';
import { eq, inArray, isNull, sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { DomainEventJob } from '../src/events/domain-events.js';
import { MAX_PUBLISH_ATTEMPTS, OutboxPublisher } from '../src/events/outbox-publisher.js';
import { createTestContext, type TestContext } from './helpers.js';

// OutboxPublisher (docs/17-event-architecture.md §2): it claims a batch in one short
// statement, enqueues outside any transaction with a deadline, then settles the rows. A
// Redis that never answers must not keep a PostgreSQL session "idle in transaction".

let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
});
afterAll(async () => {
  await t.close();
});

beforeEach(async () => {
  // Only this file's rows are due.
  await t.db.db.update(schema.events).set({ publishedAt: new Date() }).where(isNull(schema.events.publishedAt));
});

async function insertEvents(n: number): Promise<string[]> {
  const rows = await t.db.db
    .insert(schema.events)
    .values(
      Array.from({ length: n }, (_, i) => ({
        organizationId: t.orgs.demoOrganizationId,
        type: 'OutboxProbe',
        aggregateType: 'organization',
        aggregateId: t.orgs.demoOrganizationId,
        payload: { n: i },
        occurredAt: new Date(Date.UTC(2026, 8, 3, 12, 0, i)),
      })),
    )
    .returning({ id: schema.events.id });
  return rows.map((r) => r.id);
}

async function eventRows(ids: string[]) {
  return t.db.db
    .select({
      id: schema.events.id,
      publishedAt: schema.events.publishedAt,
      publishAttempts: schema.events.publishAttempts,
      lastError: schema.events.lastError,
      claimedUntil: schema.events.claimedUntil,
    })
    .from(schema.events)
    .where(inArray(schema.events.id, ids));
}

// A queue whose enqueue never settles: a Redis that accepted the connection and went silent.
function silentQueue(): Queue<DomainEventJob> & { calls: number } {
  const queue = { calls: 0, addBulk: () => ((queue.calls += 1), new Promise<never>(() => undefined)) };
  return queue as unknown as Queue<DomainEventJob> & { calls: number };
}

describe('OutboxPublisher', () => {
  it('publishes due events to BullMQ with the event id as job id, then marks them published', async () => {
    const ids = await insertEvents(3);
    const connection = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', { enableOfflineQueue: false });
    const queue = new Queue<DomainEventJob>(`outbox-test-${randomUUID()}`, { connection });
    try {
      const published = await new OutboxPublisher(t.db.db, queue).publishBatch();
      expect(published).toBe(3);
      for (const id of ids) {
        const job = await queue.getJob(id);
        expect(job?.data).toMatchObject({ eventId: id, type: 'OutboxProbe', organizationId: t.orgs.demoOrganizationId });
      }
      const rows = await eventRows(ids);
      expect(rows.every((r) => r.publishedAt !== null && r.publishAttempts === 1 && r.lastError === null && r.claimedUntil === null)).toBe(
        true,
      );
      // Nothing is due any more.
      expect(await new OutboxPublisher(t.db.db, queue).publishBatch()).toBe(0);
    } finally {
      await queue.obliterate({ force: true });
      await queue.close();
      await connection.quit();
    }
  });

  it('never holds a transaction while the enqueue hangs, and counts the attempt once the deadline passes', async () => {
    const ids = await insertEvents(2);
    const queue = silentQueue();
    const publisher = new OutboxPublisher(t.db.db, queue, { enqueueTimeoutMs: 400, leaseSeconds: 30 });

    const started = Date.now();
    const pending = publisher.publishBatch();
    await new Promise((resolve) => setTimeout(resolve, 150));
    // While the enqueue hangs, the rows are only leased: no session of this pool is inside a
    // transaction, so no row lock or vacuum horizon is held.
    const sessions = await t.db.db.execute<{ state: string }>(
      sql`select state from pg_stat_activity where datname = current_database() and application_name = 'runtruck-test'
          and pid <> pg_backend_pid() and state like 'idle in transaction%'`,
    );
    expect(sessions.rows).toEqual([]);
    const leased = await eventRows(ids);
    expect(leased.every((r) => r.claimedUntil !== null && r.publishedAt === null)).toBe(true);

    expect(await pending).toBe(0);
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(queue.calls).toBe(1);
    const rows = await eventRows(ids);
    for (const r of rows) {
      expect(r.publishedAt).toBeNull();
      expect(r.publishAttempts).toBe(1);
      expect(r.lastError).toMatch(/within 400 ms/);
      // The lease is released, so the next poll retries at once.
      expect(r.claimedUntil).toBeNull();
    }
  });

  it('skips rows another publisher holds under a live lease, and reclaims them once it expired', async () => {
    const [held] = await insertEvents(1);
    if (!held) throw new Error('no event');
    await t.db.db
      .update(schema.events)
      .set({ claimedUntil: sql`now() + interval '1 minute'` })
      .where(eq(schema.events.id, held));
    const queue = silentQueue();
    const publisher = new OutboxPublisher(t.db.db, queue, { enqueueTimeoutMs: 100, leaseSeconds: 30 });
    expect(await publisher.publishBatch()).toBe(0);
    expect(queue.calls).toBe(0);

    await t.db.db
      .update(schema.events)
      .set({ claimedUntil: sql`now() - interval '1 second'` })
      .where(eq(schema.events.id, held));
    expect(await publisher.publishBatch()).toBe(0);
    expect(queue.calls).toBe(1);
    const [row] = await eventRows([held]);
    expect(row?.publishAttempts).toBe(1);
  });

  it('claims disjoint batches when publishers run concurrently, and leaves dead-lettered rows alone', async () => {
    const ids = await insertEvents(150);
    const dead = await insertEvents(1);
    await t.db.db.update(schema.events).set({ publishAttempts: MAX_PUBLISH_ATTEMPTS }).where(inArray(schema.events.id, dead));
    const claimed: string[][] = [];
    const recording = (): Queue<DomainEventJob> =>
      ({
        addBulk: (jobs: { opts: { jobId: string } }[]) => {
          claimed.push(jobs.map((j) => j.opts.jobId));
          return Promise.resolve([]);
        },
      }) as unknown as Queue<DomainEventJob>;
    const [a, b] = await Promise.all([
      new OutboxPublisher(t.db.db, recording()).publishBatch(),
      new OutboxPublisher(t.db.db, recording()).publishBatch(),
    ]);
    expect(a + b).toBe(150);
    const all = claimed.flat();
    expect(new Set(all).size).toBe(all.length);
    expect(new Set(all)).toEqual(new Set(ids));
    const [deadRow] = await eventRows(dead);
    expect(deadRow?.publishedAt).toBeNull();
  });
});
