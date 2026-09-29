# 22 — Monitoring

Production systems must provide application logs, error tracking, and performance, database, job and integration monitoring. They must watch latency, error rates, queue failures, CPU and memory, storage and request volume (architecture §35).

**Status (2026-09-29):** the foundations below exist in code. Metrics, tracing, error tracking, dashboards and alerting do not; they come with Phase 16.

## 1. What exists

| Capability                    | Detail                                                                                                                                                                                                                                                                                                                                                               | Code                                          |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Health endpoint               | `GET /api/v1/health` (public). It runs `select 1` on PostgreSQL and `PING` on Redis. It returns `{ data: { status: 'ok', database: 'ok', redis: 'ok' }, meta: {} }`, or `502` `DEPENDENCY_UNAVAILABLE` "A required service is unavailable." It never includes hosts, versions or error text. It serves as a readiness check. There is no separate liveness endpoint. | `apps/api/src/health/health.controller.ts`    |
| Structured logs               | Nest `ConsoleLogger` with **JSON output when `NODE_ENV` is not `development`** (pretty text in development). API context `runtruck-api`, worker context `runtruck-worker`. The API honours `LOG_LEVEL` (`fatal`/`error`/`warn`/`info`/`debug`). The worker does not yet.                                                                                             | `apps/api/src/main.ts`, `worker.ts`           |
| Request correlation           | Every request gets an `x-request-id`: a well-formed incoming id (8–128 characters of `[A-Za-z0-9._-]`) is kept, otherwise a UUID is minted. It is echoed in the response, available through `AsyncLocalStorage`, included in every error body (`error.requestId`) and stored on `audit_logs.request_id` and `events.request_id`.                                     | `common/request-context/request-context.ts`   |
| Error logging                 | Every 5xx is logged once with the message, request id and stack. 4xx responses are not logged.                                                                                                                                                                                                                                                                       | `common/errors/all-exceptions.filter.ts`      |
| Access control failures       | A route missing its permission decorator logs `… declares no permissions; refusing.` at error level.                                                                                                                                                                                                                                                                 | `auth/permissions.guard.ts`                   |
| Job and outbox failures       | The worker logs `Domain event job failed` (job id, type, attempts, error), `Outbox poll failed`, and `Failed to publish outbox batch`. The outbox rows record `publish_attempts` and `last_error`.                                                                                                                                                                   | `worker.ts`, `events/outbox-publisher.ts`     |
| Database connection identity  | Pools set `application_name` (`runtruck-api`, `runtruck-worker`, `runtruck-migrate`), so `pg_stat_activity` shows which process holds each connection.                                                                                                                                                                                                               | `packages/database/src/client.ts` and callers |
| Local container health checks | PostgreSQL (`pg_isready`), Redis (`redis-cli ping`) and SeaweedFS S3 (`/healthz`) in docker-compose.                                                                                                                                                                                                                                                                        | `infrastructure/docker/docker-compose.yml`    |

Useful queries until dashboards exist:

```sql
-- Outbox backlog / stuck events
SELECT count(*), min(occurred_at), max(publish_attempts)
FROM events WHERE published_at IS NULL;

-- Recent sign-ins for one organization
SELECT occurred_at, actor_user_id, next->>'ipAddress' AS ip
FROM audit_logs WHERE organization_id = $1 AND action = 'USER_SIGNED_IN'
ORDER BY occurred_at DESC LIMIT 50;
```

## 2. Gaps

| Missing                                                                                                                        | Why it matters                                                       | Phase |
| ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- | ----- |
| HTTP access log (method, route, status, duration, request id). Nest does not log requests by default.                          | Latency and error-rate visibility                                    | 16    |
| Metrics (Prometheus / OpenTelemetry): request rate, latency percentiles, pool usage, queue depth, job failures, outbox backlog | §35 monitoring list                                                  | 16    |
| Distributed tracing across web → API → worker                                                                                  | Following one request across processes                               | 16    |
| Error tracking service                                                                                                         | Grouping of and alerts on 5xx errors. No vendor chosen; §40 applies. | 16    |
| BullMQ queue dashboard and failed-job replay                                                                                   | Operating the worker                                                 | 16    |
| Worker health endpoint or heartbeat                                                                                            | Detecting a stalled worker                                           | 16    |
| Alerting and on-call runbooks                                                                                                  | Response                                                             | 16    |
| Web (Next.js) server logs in JSON with the request id                                                                          | Correlating page failures                                            | 16    |
