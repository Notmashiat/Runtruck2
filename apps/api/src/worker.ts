import { ConsoleLogger } from '@nestjs/common';
import { apiEnvSchema, parseEnv } from '@runtruck/config';
import { createDatabase } from '@runtruck/database';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { DOMAIN_EVENTS_QUEUE, type DomainEventJob } from './events/domain-events.js';
import { dispatchEvent, EventLogHandler, type DomainEventHandler } from './events/event-handlers.js';
import { OutboxPublisher } from './events/outbox-publisher.js';
import { purgeStaleSessions } from './auth/session.service.js';
import { IDLE_IN_TRANSACTION_TIMEOUT_MS } from './database/database.module.js';

// Background worker process (architecture §24): publishes the event outbox to
// BullMQ and consumes domain events. Runs separately from the HTTP API so each
// scales on its own (§37 worker scaling).

const env = parseEnv(apiEnvSchema);
const LEVELS = ['fatal', 'error', 'warn', 'log', 'debug'] as const;
const logger = new ConsoleLogger('runtruck-worker', {
  json: env.NODE_ENV !== 'development',
  logLevels: LEVELS.slice(0, { fatal: 1, error: 2, warn: 3, info: 4, debug: 5 }[env.LOG_LEVEL]),
});
// PostgreSQL ends a transaction left idle this long, releasing its locks and the vacuum
// horizon (docs/17-event-architecture.md §2): no worker transaction waits on anything else.
const database = createDatabase(env.DATABASE_URL, { max: 4, applicationName: 'runtruck-worker', idleInTransactionTimeoutMs: IDLE_IN_TRANSACTION_TIMEOUT_MS });
// The consumer's connection: BullMQ's blocking commands need maxRetriesPerRequest null.
const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
// The publisher's own connection fails fast while Redis is unreachable (no offline queue),
// so a batch records its error and is retried instead of waiting for Redis to return; the
// publisher's enqueue deadline bounds it in any case.
const queueConnection = new Redis(env.REDIS_URL, { enableOfflineQueue: false });

const queue = new Queue<DomainEventJob>(DOMAIN_EVENTS_QUEUE, { connection: queueConnection });
const publisher = new OutboxPublisher(database.db, queue);
const handlers: DomainEventHandler[] = [new EventLogHandler()];

const worker = new Worker<DomainEventJob>(
  DOMAIN_EVENTS_QUEUE,
  async (job) => {
    await dispatchEvent(handlers, job.data);
  },
  { connection, concurrency: 8 },
);
worker.on('failed', (job, err) => {
  logger.error({ message: 'Domain event job failed', jobId: job?.id, type: job?.data.type, attempts: job?.attemptsMade, error: err.message });
});

// Hourly housekeeping: expired/revoked sessions (docs/05-authentication.md).
const purgeTimer = setInterval(() => {
  purgeStaleSessions(database.db)
    .then((n) => {
      if (n > 0) logger.log({ message: 'Purged stale sessions', count: n });
    })
    .catch((err: unknown) => {
      logger.error({ message: 'Session purge failed', error: err instanceof Error ? err.message : String(err) });
    });
}, 3_600_000);

let stopping = false;
async function pollOutbox(): Promise<void> {
  while (!stopping) {
    try {
      const published = await publisher.publishBatch();
      if (published === 0) await sleep(1_000);
    } catch (err) {
      logger.error({ message: 'Outbox poll failed', error: err instanceof Error ? err.message : String(err) });
      await sleep(5_000);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function shutdown(): Promise<void> {
  stopping = true;
  clearInterval(purgeTimer);
  await worker.close();
  await queue.close();
  await Promise.all([connection.quit(), queueConnection.quit()]);
  await database.close();
  logger.log('Worker stopped');
}

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());

logger.log('Worker started');
void pollOutbox();
