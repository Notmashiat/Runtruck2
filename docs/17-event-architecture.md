# 17 — Event Architecture

Important business actions produce **domain events** (architecture §23). Events decouple a change from what reacts to it: notifications, integrations, AI and analytics. Those reactions run in the background ([18-background-jobs.md](18-background-jobs.md)) and never block the request.

## 1. Status (2026-09-29)

| Piece                                | Status                                                                                                                                                                | Code                                                 |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Outbox table `events`                | Built: created by migration `0000_init` (migrations `0000`–`0004` exist and are applied by `pnpm db:migrate`, `db:reset` and the integration-test setup, [03 §9.1](03-database.md)). | `packages/database/src/schema/platform.ts`, `packages/database/drizzle/` |
| `EventsService.emit(tx, ctx, event)` | Built                                                                                                                                                                 | `apps/api/src/events/events.service.ts`              |
| Outbox publisher (to BullMQ)         | Built                                                                                                                                                                 | `apps/api/src/events/outbox-publisher.ts`            |
| Worker and handler registry          | Built. The only handler is `EventLogHandler`, which logs each event.                                                                                                  | `apps/api/src/worker.ts`, `events/event-handlers.ts` |
| Events emitted by any endpoint       | **None yet.** Sign-in and sign-out are audited, not emitted (§5).                                                                                                     | —                                                    |
| Parity-slice event catalogue         | **Specified** in §5. Each event is emitted when its domain module is built.                                                                                           | —                                                    |

## 2. Transactional outbox

A business change and its event must commit together or not at all. Publishing to Redis directly from the request would risk a "saved but never announced" gap if the process crashed in between. Runtruck avoids that with an outbox:

```
HTTP request
  └─ db.transaction(tx):
       1. change business rows
       2. AuditService.record(tx, ctx, {...})       → audit_logs
       3. EventsService.emit(tx, ctx, {...})        → events (published_at NULL)
     COMMIT  (all three, or none)

Worker process (poll loop)
  └─ OutboxPublisher.publishBatch():                 (no transaction spans these steps)
       1 claim (one autocommitted statement):
         UPDATE events SET claimed_until = now() + 60 s
         WHERE id IN (SELECT id FROM events
                      WHERE published_at IS NULL AND publish_attempts < 10
                        AND (claimed_until IS NULL OR claimed_until < now())
                      ORDER BY occurred_at LIMIT 100 FOR UPDATE SKIP LOCKED)
         RETURNING *
       2 queue.addBulk(jobs with jobId = event id)   → Redis / BullMQ "domain-events"
         with a 10 s deadline
       3 settle (one statement):
         ok:     UPDATE events SET published_at = now(), publish_attempts += 1,
                                   last_error = NULL, claimed_until = NULL
         failed: UPDATE events SET publish_attempts += 1, last_error = <message>,
                                   claimed_until = NULL
  └─ BullMQ Worker → dispatchEvent(handlers, job.data)
```

`events` columns:

- `id` (uuid)
- `organization_id`
- `type`
- `aggregate_type`, `aggregate_id`
- `payload` (jsonb)
- `actor_user_id`
- `request_id` (from the request context, for correlation)
- `occurred_at`
- `published_at`, `publish_attempts`, `last_error`
- `claimed_until` (the publisher's lease, migration `0004`)

Two indexes support it:

- `events_unpublished_idx`: a partial index on `occurred_at` where `published_at IS NULL`, for the poller.
- `events_org_aggregate_idx`: `(organization_id, aggregate_type, aggregate_id)`.

Rules:

- `EventsService.emit` **must be called with the transaction (`tx`)** that makes the change. Calling it with the root `db` outside a transaction defeats the outbox.
- `occurred_at` defaults to the database's `now()`, which is the transaction's start time. Pass `occurredAt` explicitly when the instant is shown to users and must follow the demo clock (`ClockService.now(tz)`, docs/01 D4).
- **No transaction is held across Redis** (01 C87). A Redis that accepts the connection and never answers must not keep a PostgreSQL session "idle in transaction" with row locks and a pinned vacuum horizon, so the claim and the settle are short statements and the enqueue runs between them. The publisher's Redis connection has no offline queue (a command fails at once while Redis is unreachable), and the enqueue has a deadline (`enqueueTimeoutMs`, 10 s) in any case. As a backstop the worker's and the API's sessions run with `idle_in_transaction_session_timeout = 60s`.
- The claim's `FOR UPDATE SKIP LOCKED` and the lease let several worker processes publish in parallel without claiming the same rows. A worker that dies after claiming leaves its rows leased; they become due again when the lease (60 s, longer than the enqueue deadline) ends.
- If `addBulk` fails or misses its deadline (Redis unavailable), the batch is not marked published: `publish_attempts` is incremented, `last_error` records the message (up to 1,000 characters), the lease is released and the batch is retried on the next poll. After `MAX_PUBLISH_ATTEMPTS` (10) failed attempts a row is no longer claimed (dead-lettered: it stays with its last error for an operator, [18](18-background-jobs.md) §5). An enqueue that finishes after its deadline is harmless: the job id is the event id, so the retry is deduplicated.
- `apps/api/test/outbox.int.test.ts` proves it: a hanging enqueue leaves no session idle in transaction and counts one attempt after the deadline; leased rows are skipped until the lease ends; concurrent publishers claim disjoint batches.

## 3. Naming and payload rules

- **Type:** PascalCase, past tense, `<Aggregate><Verb>`, e.g. `LoadCreated`, `SettlementApproved`. An event is a fact that already happened, never a command.
- **Aggregate:** `aggregateType` is the lower-snake-case entity (`load`, `settlement`, `planner_event`, `planner_color_code`, `document`, `organization`). `aggregateId` is that row's UUID. Use `organization` with the organization id for organization-wide events such as `PlannerReset`.
- **Payload:** ids and the small scalars a consumer needs to route or filter. It is **not** a copy of the row. Consumers read current state through services, applying the same tenant scoping.
  - No secrets and no password material.
  - Keep personal data out: use ids, not names, emails or addresses.
  - Money only as integer cents and only when a consumer needs it.
  - The payload must be JSON-serialisable and stable. Adding fields is fine. Renaming or removing a field means a new event version (`…V2`) until every consumer has moved.
- **Audit is separate.** Every write also records an `audit_logs` row, with action names in SCREAMING_SNAKE_CASE (`LOAD_CREATED`). Audit is the append-only history for people. Events are the integration contract for code. A write normally produces one of each.

## 4. Delivery semantics and idempotency

- **At least once.** An event can reach a handler more than once:
  - BullMQ retries a failed job.
  - The publisher can re-enqueue a batch if its settle statement fails after `addBulk` succeeded, or when an enqueue finishes after its deadline.
- **Deduplication at enqueue.** The job id is the event id, so BullMQ ignores a second `add` while the first job is still stored. Completed jobs are kept up to the most recent 1,000 and failed jobs up to 5,000. After a job is pruned, a re-publish would run again.
- **Handlers must therefore be idempotent**, keyed by `eventId`. They check before acting ("notification for event X already sent?") or use an upsert or unique constraint on the event id.
- **No ordering guarantee.** The publisher enqueues in `occurred_at` order, but the worker runs 8 jobs concurrently and several publishers may run at once. Handlers must not assume that event A for an aggregate is processed before event B. Re-read the current state instead.
- **Tenant context.** Every job carries `organizationId`. A handler that reads or writes business data must scope by it, exactly as an HTTP request does ([06](06-multi-tenancy.md) §3).

## 5. Event catalogue (parity slice)

"Specified" means the event must be emitted by the endpoint named, in the same transaction as the change. The domain API documents (`docs/api/*.md`) list the same events. No event is emitted yet (2026-09-29).

| Event                            | Aggregate            | Emitted by                                                                                                                                                                                               | Payload (minimum)                                                | Audit action                        | Status             |
| -------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------- | ------------------ |
| `LoadCreated`                    | `load`               | `POST /loads` ([api/loads.md §6.4](api/loads.md), 08 T0a/T0b)                                                                                                                                                | `loadId`, `loadNumber`, `status`                                 | `LOAD_CREATED`                      | Specified          |
| `LoadAssigned`                   | `load`               | `POST /loads` when the new load has a driver, truck, trailer or partner carrier (in the same transaction as `LoadCreated`; [09 §4](09-dispatch-lifecycle.md))                                            | `loadId`, `dispatchId`, `carrierId`, `driverId`, `truckId`, `trailerId` (null when not set) | `LOAD_ASSIGNED`                     | Specified          |
| `LoadDispatched`                 | `load`               | `POST /loads` when the created load's status is `dispatched` (08 T0b: partner carrier, or own fleet with a driver); later also T1 (`POST /loads/:id/assign`, not built)                                    | `loadId`, `loadNumber`                                           | none of its own: the creation is audited by `LOAD_CREATED` (with `status`) and the assignment by `LOAD_ASSIGNED` | Specified          |
| `LoadStatusChanged`              | `load`               | Every load status transition after creation (08 §3). In this release only T12: `POST /loads/:id/documents` when a proof of delivery moves a `needs_pod` load to `delivered` and the uploader holds `loads.update` | `loadId`, `loadNumber`, `from`, `to`                             | `LOAD_STATUS_CHANGED`               | Specified          |
| `DocumentUploaded`               | `document`           | `POST /loads/:id/documents`, one per stored version ([13 §5](13-document-system.md))                                                                                                                      | `loadId`, `documentId`, `documentVersionId`, `documentType`, `versionNumber` | `DOCUMENT_UPLOADED`                 | Specified          |
| `PODUploaded`                    | `document`           | `POST /loads/:id/documents` when the version is a `proof_of_delivery`, in addition to `DocumentUploaded` (architecture §23; 08 T12)                                                                      | `loadId`, `documentId`, `documentVersionId`                      | none of its own (`DOCUMENT_UPLOADED`) | Specified          |
| `SettlementApproved`             | `settlement`         | `POST /settlements/approve`: **one event per settlement** moved Ready → Approved. A settlement already approved produces nothing, so a repeat call is a no-op.                                           | `settlementId`, `driverId`, `periodStart`                        | `SETTLEMENT_APPROVED`               | Specified          |
| `PlannerEventCreated`            | `planner_event`      | `POST /planner/events`                                                                                                                                                                                   | `plannerEventId`, `colorCodeId`, `startsOn`                      | `PLANNER_EVENT_CREATED`             | Specified          |
| `PlannerEventUpdated`            | `planner_event`      | `PATCH /planner/events/:id`                                                                                                                                                                              | `plannerEventId`, `changedFields[]`                              | `PLANNER_EVENT_UPDATED`             | Specified          |
| `PlannerEventDeleted`            | `planner_event`      | `DELETE /planner/events/:id`                                                                                                                                                                             | `plannerEventId`                                                 | `PLANNER_EVENT_DELETED`             | Specified          |
| `PlannerColorCodeCreated`        | `planner_color_code` | `POST /planner/color-codes`                                                                                                                                                                              | `colorCodeId`                                                    | `PLANNER_COLOR_CODE_CREATED`        | Specified          |
| `PlannerColorCodeUpdated`        | `planner_color_code` | `PATCH /planner/color-codes/:id`                                                                                                                                                                         | `colorCodeId`, `changedFields[]`                                 | `PLANNER_COLOR_CODE_UPDATED`        | Specified          |
| `PlannerColorCodeDeleted`        | `planner_color_code` | `DELETE /planner/color-codes/:id` (its events are reassigned first)                                                                                                                                      | `colorCodeId`, `reassignedToColorCodeId`, `reassignedEventCount` | `PLANNER_COLOR_CODE_DELETED`        | Specified          |
| `PlannerReset`                   | `organization`       | `POST /planner/reset` (D8)                                                                                                                                                                               | `eventCount`, `colorCodeCount` (after the reset)                 | `PLANNER_RESET`                     | Specified          |
| `UserSignedIn` / `UserSignedOut` | —                    | Not emitted. Sign-in and sign-out write the audit actions `USER_SIGNED_IN` / `USER_SIGNED_OUT` only. No consumer needs them as events.                                                                   | —                                                                | `USER_SIGNED_IN`, `USER_SIGNED_OUT` | Audit only (built) |

Architecture §23 also names `LoadPickedUp`, `LoadDelivered`, `InvoiceCreated` and `InvoicePaid`. No parity-slice action produces them: pickup and delivery status changes, invoicing and payments are not built (docs/01 §7). They arrive with Phases 8, 9, 11 and 12, together with the specified-only load events of 08 §3 and 09 (`LoadUnassigned`, `LoadArrivedAtPickup`, `LoadPickedUp`, `LoadDelayed`, `LoadDelayCleared`, `LoadDelivered`), each emitted with `LoadStatusChanged`.

The payloads above are exactly those of the emitting endpoint documents ([api/loads.md §6.4](api/loads.md), [api/documents.md §3](api/documents.md), [13 §5](13-document-system.md), [api/planner.md §5](api/planner.md), [api/settlements.md](api/settlements.md)). The version id is always named `documentVersionId`. The `document_type` value of a proof of delivery is `proof_of_delivery`.

## 6. Adding an event

1. Add a row to §5 and to the domain's API document: type, aggregate, emitter, payload and audit action.
2. Emit it with `this.events.emit(tx, ctx, { type, aggregateType, aggregateId, payload })` inside the write transaction, next to `this.audit.record(tx, ctx, …)`.
3. If something must react, add a `DomainEventHandler` (`handles(type)`, idempotent `handle(event)`) and register it in `worker.ts` ([18](18-background-jobs.md) §3).
4. Integration test: after the request, the `events` row exists with the caller's `organization_id`, and it does not exist when the request fails validation or authorization.
