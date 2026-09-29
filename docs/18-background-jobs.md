# 18 — Background Jobs

Asynchronous work runs on **Redis + BullMQ** in a **separate worker process** (architecture §24, §37 worker scaling). Redis is never the source of truth: every job can be rebuilt from PostgreSQL, the outbox in [17](17-event-architecture.md) being the example.

## 1. Status (2026-09-29)

| Item                                                                                                                                                                       | Status                                                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Worker process `apps/api/src/worker.ts`                                                                                                                                    | Built                                                                                             |
| Queue `domain-events` (outbox publisher and consumer)                                                                                                                      | Built                                                                                             |
| Handlers                                                                                                                                                                   | `EventLogHandler` only. It logs `Domain event processed` with type, event id and organization id. |
| Other queues from architecture §24 (document-processing, email, sms, notifications, tracking-sync, integration-sync, invoice-generation, AI-processing, route-calculation) | Not built. Each arrives with its phase (§6).                                                      |
| Scheduled / repeatable jobs                                                                                                                                                | None. Note that `SessionService.purgeStale()` exists but is **not scheduled** (§6).               |
| Queue monitoring UI, dead-letter queue, alerting                                                                                                                           | Not built ([22](22-monitoring.md))                                                                |

## 2. The worker process

`apps/api/src/worker.ts` is a plain Node entry point that does not boot the Nest HTTP app.

| Aspect           | Behaviour                                                                                                                                                                                                             |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Configuration    | `parseEnv(apiEnvSchema)`: the same validated environment as the API. It refuses to start with missing or malformed variables.                                                                                         |
| Logging          | Nest `ConsoleLogger('runtruck-worker')`. JSON when `NODE_ENV` is not `development`. `LOG_LEVEL` is **not** applied to the worker (only `main.ts` reads it).                                                           |
| Database         | Its own pool: `max: 4`, `application_name = runtruck-worker`.                                                                                                                                                         |
| Redis            | One `ioredis` connection with `maxRetriesPerRequest: null`, which BullMQ requires.                                                                                                                                    |
| Outbox poll loop | `publishBatch()` claims up to 100 unpublished events. When nothing was published it sleeps 1 s. When the poll threw it logs `Outbox poll failed` and sleeps 5 s.                                                      |
| Consumer         | `new Worker('domain-events', …, { concurrency: 8 })` calls `dispatchEvent(handlers, job.data)`, which runs every handler whose `handles(type)` is true, one after another.                                            |
| Shutdown         | On `SIGINT` / `SIGTERM` it stops polling, closes the worker (waiting for active jobs), the queue, Redis and the DB pool, then logs `Worker stopped`.                                                                  |
| Running          | `pnpm --filter @runtruck/api start:worker` (built `dist/worker.js`), or `dev:worker` (`node --watch dist/worker.js`). **`pnpm dev` does not start the worker.** Run it in a second terminal ([README](../README.md)). |
| Scaling          | Several worker processes may run at once. Outbox claims use `FOR UPDATE SKIP LOCKED`, and BullMQ distributes jobs.                                                                                                    |

## 3. The `domain-events` queue

The job data is `DomainEventJob`:

- `eventId`
- `organizationId`
- `type`
- `aggregateType`, `aggregateId`
- `payload`
- `occurredAt` (ISO string)

The job name is the event type.

Job options (`outbox-publisher.ts`):

| Option             | Value                                  | Effect                                              |
| ------------------ | -------------------------------------- | --------------------------------------------------- |
| `jobId`            | the event id                           | Deduplicates re-publishes while the job is retained |
| `attempts`         | 5                                      | 1 run + 4 retries                                   |
| `backoff`          | `{ type: 'exponential', delay: 2000 }` | Retries after about 2 s, 4 s, 8 s and 16 s          |
| `removeOnComplete` | 1000                                   | Keeps the latest 1,000 completed jobs               |
| `removeOnFail`     | 5000                                   | Keeps the latest 5,000 failed jobs for inspection   |

Handler contract (`event-handlers.ts`):

```ts
interface DomainEventHandler {
  readonly name: string;
  handles(type: string): boolean;
  handle(event: DomainEventJob): Promise<void>; // must be idempotent (at-least-once delivery)
}
```

To add a handler, implement the interface and add it to the `handlers` array in `worker.ts`. A handler that throws fails the whole job, so every handler for that event runs again on retry. That is one more reason every handler must be idempotent. When handlers of very different cost or risk accumulate (email, integrations), move them to their own queues (§6) so one handler's failures do not replay the others.

## 4. Rules for every job

- **Retries and backoff:** set explicitly, as above. No job runs with default options.
- **Idempotency:** key the effect on a stable id (the event id, or an explicit idempotency key) and check it before acting.
- **Tenant scoping:** jobs carry `organizationId`, and every query inside a job filters by it ([06](06-multi-tenancy.md)).
- **Logging:** log start and failure with the job id, type and organization id. Never log payload secrets or personal data.
- **No authoritative state in Redis:** a job's inputs come from PostgreSQL, and its results are written to PostgreSQL.
- **Big work goes to jobs** (architecture §38): anything that could take long or touch many rows is enqueued, not done inside an HTTP request.

## 5. Failure handling today

| Failure                                     | What happens                                                                                                                                                              | Gap                                                                                                                                 |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| A handler throws                            | BullMQ retries with backoff. Each failure is logged (`Domain event job failed`, with job id, type, attempts and error). After 5 attempts the job stays in the failed set. | No dead-letter processing, no alert, no replay tool.                                                                                |
| Redis unavailable while publishing          | The batch stays unpublished. `events.publish_attempts` is incremented and `last_error` is set. It is retried on the next poll, about 1 s later.                           | No retry cap and no poison-row handling. Stuck rows are only visible by querying `events WHERE published_at IS NULL`.               |
| The poll query itself fails (database down) | Logged as `Outbox poll failed`, then retried after 5 s.                                                                                                                   | —                                                                                                                                   |
| Redis data lost after publish               | Jobs already marked `published_at` are not re-published automatically.                                                                                                    | Recovery means clearing `published_at` for the affected window. Idempotent handlers make that safe ([23](23-disaster-recovery.md)). |

## 6. Planned queues and jobs

| Queue / job                          | Purpose                                                                                               | Phase                                   |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `sessions-purge` (repeatable, daily) | Call `SessionService.purgeStale()`: delete sessions that expired or were revoked more than a day ago. | Phase 2 follow-up (not scheduled today) |
| `notifications`                      | Fan out in-app and push notifications from events ([14](14-notification-system.md))                   | 9                                       |
| `email`, `sms`                       | Deliver through providers behind adapters ([15](15-integration-architecture.md))                      | 2 follow-up (recovery email), 14        |
| `document-processing`                | Thumbnails, OCR, classification of uploaded documents                                                 | 11 follow-up                            |
| `tracking-sync`                      | Pull ELD / GPS positions                                                                              | 10                                      |
| `integration-sync`                   | Accounting and load-board synchronisation                                                             | 14                                      |
| `invoice-generation`                 | Batch invoice creation                                                                                | 12 follow-up                            |
| `ai-processing`                      | Controlled AI tool runs ([16](16-ai-architecture.md))                                                 | 15                                      |
| `route-calculation`                  | Mileage and routes (e.g. PC*Miler)                                                                    | 14                                      |
