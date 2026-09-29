# 23 — Disaster Recovery

PostgreSQL must have automated backups. The backup frequency, retention, recovery procedure, **RPO** and **RTO** must be defined, and production recovery must be documented and tested (architecture §36).

**Status (2026-09-29): no backups are configured.** Only local development exists ([21](21-deployment.md)). RPO and RTO have not been set by the product owner. Everything below is the plan, not something that runs today. Recovery testing is a Phase 16 item.

## 1. What holds state

| Store                       | Contents                                                           | Authoritative?             | Loss impact                                                                                                               |
| --------------------------- | ------------------------------------------------------------------ | -------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| PostgreSQL                  | All business data, users, sessions, roles, audit log, event outbox | **Yes** (Rule 1)           | Total. Must be restorable.                                                                                                |
| Object storage (S3; SeaweedFS locally) | Document binaries. Metadata is in PostgreSQL.                      | Yes, for the file contents | Documents become unreadable. The metadata rows would then point at missing objects.                                       |
| Redis                       | BullMQ queues and sign-in rate-limit counters                      | No                         | Rate limits reset (acceptable). Jobs that were **already published** from the outbox but not yet processed are lost (§3). |
| Browser `localStorage`      | Theme, planner view preferences                                    | No (presentation only)     | Preferences reset                                                                                                         |

Locally, the data lives in the docker volumes `postgres-data`, `redis-data` (AOF on) and `s3-data`. `pnpm infra:down` keeps the volumes. Deleting them loses local data. The demo can be rebuilt at any time with `pnpm db:reset` (docs/01 §4).

## 2. Plan for production (Phase 16)

| Item               | Plan                                                                                                                                 | Decision needed                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| PostgreSQL backups | Managed service with continuous WAL archiving (point-in-time recovery) plus daily snapshots, stored in a separate region and account | RPO / RTO targets and retention (product owner) |
| Object storage     | Bucket versioning, a lifecycle policy for old versions, cross-region replication                                                     | Retention (product owner, legal)                |
| Redis              | Managed, with persistence. It is treated as rebuildable.                                                                             | —                                               |
| Secrets            | Held in the secrets manager with its own backup and recovery                                                                         | —                                               |
| Restore drills     | Scheduled restores into an isolated environment, checked with the integration suite and `/api/v1/health`. Results are recorded.      | Frequency                                       |

## 3. Recovery procedures

**Restore PostgreSQL (point in time)**

1. Stop the worker and put the API in maintenance, so nothing writes to the old primary.
2. Restore to a new instance at the chosen time.
3. Run `pnpm db:migrate` to confirm the schema matches the deployed code.
4. Point `DATABASE_URL` at the restored instance. Start the API and check `/api/v1/health`.
5. Start the worker. Events committed before the restore point but not yet published have `published_at IS NULL` and are published automatically.

**Recover from Redis data loss**

Events published shortly before the loss may never have been processed. Handlers are idempotent on the event id ([17](17-event-architecture.md) §4), so it is safe to republish a window:

```sql
UPDATE events SET published_at = NULL
WHERE published_at >= $lossWindowStart;   -- then let the worker re-publish
```

**Reconcile object storage with metadata**

A document metadata row without its object, or an object without its row, is found by a reconciliation job that is planned but not built. Until it exists, the check is manual.

## 4. Open decisions (for the product owner)

- RPO and RTO for production.
- Backup retention for the database, documents and audit log (legal or contractual requirements for financial records).
- Whether audit logs are also exported to write-once storage.
