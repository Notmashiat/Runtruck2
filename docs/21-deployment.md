# 21 — Deployment

The architecture requires separate **Development, Staging and Production** environments. Production credentials are never used locally, destructive migrations are never tested against production, and production deployment requires passing CI (architecture §32, §33).

**Status (2026-09-29): only local development and CI exist.** There are no Dockerfiles for the apps, no `infrastructure/terraform`, no `infrastructure/deployment` and no staging or production environment. CI runs on GitHub Actions (`.github/workflows/ci.yml`, [20](20-testing.md) §6). Production deployment is out of this release (docs/01 §5, Phase 16).

## 1. What exists

| Item                 | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local infrastructure | `infrastructure/docker/docker-compose.yml` (project `runtruck`): <br>• PostgreSQL 17 (`5432`; the init script also creates `runtruck_test`) <br>• Redis 8 with AOF persistence (`6379`) <br>• SeaweedFS S3 (`9000`; replaces MinIO, which stopped publishing community images) <br>• a one-shot `s3-init` (AWS CLI) that creates the private buckets `runtruck-documents` and `runtruck-documents-test` <br>All use named volumes and health checks. The credentials are throwaway local values. |
| Commands             | `pnpm infra:up` / `pnpm infra:down`                                                                                                                                                                                                                                                                                                                                                                                                         |
| Build outputs        | API: `nest build` (tsc) → `apps/api/dist/main.js` and `dist/worker.js`. Web: `next build` → `.next`. Packages: `tsc` → `dist`. Orchestrated by `pnpm build` (Turbo, `dependsOn: ^build`).                                                                                                                                                                                                                                                   |
| Start commands       | API: `node dist/main.js` (`pnpm --filter @runtruck/api start`). Worker: `node dist/worker.js` (`start:worker`). Web: `next start --port 3000`.                                                                                                                                                                                                                                                                                              |
| Configuration        | Environment variables only, validated at boot by `@runtruck/config`: `NODE_ENV`, `API_PORT`, `DATABASE_URL`, `DATABASE_POOL_MAX`, `REDIS_URL`, `WEB_ORIGIN`, `SESSION_TTL_HOURS`, `DEMO_TODAY` (refused when `NODE_ENV=production`), `LOG_LEVEL`. The web reads `API_ORIGIN`. The `S3_*` variables (`S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE`) and `TRUST_PROXY` are validated too.                                                                                      |
| Migrations           | `pnpm db:migrate` applies the SQL in `packages/database/drizzle` with Drizzle's migrator. Migrations `0000`–`0003` exist ([03 §9.1](03-database.md)); new ones are generated from the schema by `pnpm db:generate`, custom SQL with `--custom`.                                                                                                                                                                                                                                                       |

## 2. Target topology (to build in Phase 16)

```
Internet ──HTTPS──▶ Load balancer / CDN (TLS, HSTS)
                        │
                        ▼
                 Web (Next.js, N instances)  ──/api/v1 rewrite──▶  API (NestJS, N instances, private network)
                                                                      │
                 Worker (N instances, no inbound port) ───────────────┤
                                                                      ▼
                                       PostgreSQL (managed, backups)  Redis (managed)  S3 bucket (private)
```

Requirements carried from the code:

- **The API is not publicly reachable.** Only the web tier, or a load balancer that sets `X-Forwarded-For`, may reach it. `trust proxy` must equal the real number of proxy hops ([19](19-security.md) G4).
- `WEB_ORIGIN` equals the public web origin exactly (scheme, host and port). The Origin check depends on it.
- `NODE_ENV=production` or `staging`, which turns on the `Secure` cookie flag. Do not set `DEMO_TODAY`: production refuses it, and staging should use the real clock unless it is a demo environment.
- API, web and worker are deployed as separate processes and scaled independently (architecture §37). The worker must run for events to be delivered.
- Each process sizes its connection pool: `DATABASE_POOL_MAX` for the API (default 10). The worker uses 4.
- **Migrations run once per release**, as a separate step before the new API version receives traffic, and are backward-compatible with the version still running. The seed (`db:seed`, `db:reset`) never runs in production; it refuses `NODE_ENV=production`.
- Secrets come from a secrets manager, injected as environment variables (§34). No `.env` files on servers.
- Object storage uses a bucket-scoped access key, not root credentials.
- **Two database roles.** Migrations run as an owner role. The API and the worker connect (`DATABASE_URL`) as a separate application role that owns no table, is not a superuser, has no DDL rights, no `TRUNCATE` and cannot set `session_replication_role`; it holds `SELECT, INSERT, UPDATE, DELETE` on the tables it uses and only `SELECT, INSERT` on `audit_logs` (`REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs`). Only then is the audit trail append-only against the application ([03 §9.2](03-database.md), [19](19-security.md) G1).

## 3. To build (Phase 16, except CI)

| Item                                                                                         | Phase                                    |
| -------------------------------------------------------------------------------------------- | ---------------------------------------- |
| CI pipeline with the gates in [20](20-testing.md) §6                                         | This release (docs/01 §5); **built** (`.github/workflows/ci.yml`); a dependency-audit gate is still missing ([19](19-security.md) G9) |
| Container images for web, API and worker                                                     | 16                                       |
| Infrastructure as code (`infrastructure/terraform`) for staging and production               | 16                                       |
| Deployment pipeline: build once, migrate, roll out, smoke-test `/api/v1/health`              | 16                                       |
| Environment promotion (develop → staging → main → production) following the Git policy (§41) | 16                                       |
