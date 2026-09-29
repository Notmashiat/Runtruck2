# Runtruck

Runtruck is a multi-tenant **Transportation Management System (TMS)** for trucking companies, carriers, dispatchers, drivers and accounting teams. It covers loads, dispatch, fleet, customers, documents, billing and settlements.

This repository, Runtruck2, re-implements the **Runtruck1** prototype on a production architecture. The web app looks and behaves like Runtruck1. Underneath, every screen is served by a NestJS API backed by PostgreSQL, with authentication, multi-tenancy, permissions, validation, audit logging and domain events ([docs/01-product-requirements.md](docs/01-product-requirements.md)).

**Stack:**

- TypeScript throughout, in a pnpm + Turborepo monorepo
- Next.js 16 / React 19 (`apps/web`)
- NestJS (`apps/api`)
- PostgreSQL 17 + Drizzle (`packages/database`)
- Redis 8 + BullMQ (worker)
- S3-compatible object storage (SeaweedFS locally)

## Prerequisites

- **Node.js 24** (see `.nvmrc`; `package.json` requires `>=24 <25`)
- **pnpm 10** (`packageManager: pnpm@10.34.6`)
- **Docker Desktop**, for PostgreSQL, Redis and SeaweedFS (S3)

## Setup

```sh
cp .env.example .env     # local, throwaway values; never commit .env
pnpm install
pnpm infra:up            # PostgreSQL :5432, Redis :6379, S3 (SeaweedFS) :9000
pnpm build               # packages must be built before migrate/seed (they run from dist/)
pnpm db:migrate          # apply the database migrations
pnpm db:seed             # load the Runtruck1 demo data (Sunridge Freight)
```

`pnpm db:reset` rebuilds the demo database from scratch. The seed refuses to run when `NODE_ENV=production`.

## Running

```sh
pnpm dev                                   # web (http://localhost:3000) + API (http://localhost:4000) + package watchers
pnpm --filter @runtruck/api dev:worker     # background worker, in a second terminal
```

- The **web app** is at <http://localhost:3000>. The browser calls `/api/v1/*` on the web origin, and Next.js forwards it to the API (`API_ORIGIN`, default `http://localhost:4000`).
- The **API** listens on `API_PORT` (4000) under `/api/v1`. Check it with `GET http://localhost:4000/api/v1/health`.
- The **worker** publishes the event outbox to BullMQ and processes domain events. `pnpm dev` does not start it, and without it domain events are not processed.
- "Today" is pinned to **2026-09-03** by `DEMO_TODAY` in `.env`, so the demo matches Runtruck1. Remove the variable to use the real date.

### Demo sign-in

Open <http://localhost:3000/login> and sign in as **Rosa Medina** (Sunridge Freight, role Admin):

- **Email:** `rosa.medina@sunridgefreight.com`
- **Password:** the value of `SEED_DEMO_PASSWORD` in your `.env`

## Tests

| Command                        | What it runs                                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `pnpm lint` · `pnpm typecheck` | ESLint (strict, type-aware) and `tsc --noEmit` in every workspace                                      |
| `pnpm test`                    | Vitest unit tests in every workspace                                                                   |
| `pnpm test:integration`        | API tests through HTTP against real PostgreSQL (`TEST_DATABASE_URL`) and Redis. Needs `pnpm infra:up`. |
| `pnpm test:e2e`                | Playwright tests (`tests/e2e`) against the seeded demo                                                 |
| `pnpm format:check`            | Prettier                                                                                               |

See [docs/20-testing.md](docs/20-testing.md) for the strategy and the current status of each layer.

## Repository layout

```
apps/
  api/            NestJS API (auth, audit, events, worker, domain modules) — src/main.ts, src/worker.ts
  web/            Next.js app: marketing page, /login, /app shell and screens
packages/
  calculations/   shared formulas and formatters (dates, money)
  config/         environment schemas (Zod), validated at boot
  database/       Drizzle schema, migrations, client, seed, password hashing
  eslint-config/  shared lint rules
  permissions/    permission catalog and default roles
  types/          API wire types (DTOs)
  ui/             shared React components and Runtruck1 CSS
  validation/     Zod input schemas shared by API and web
infrastructure/
  docker/         docker-compose for local PostgreSQL, Redis, SeaweedFS (S3)
docs/             product requirements, architecture and specifications (below)
```

## Project status

This release covers Phases 1–4 and a Runtruck1-parity slice of Phases 5–8 and 11–13. See [docs/24-development-phases.md](docs/24-development-phases.md) for what is built, what is in progress and what is missing. Runtruck1's inert stub buttons are listed as not implemented in docs/01 §7.

## Documentation

| Document                                                           | Contents                                                                 |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| [01 Product requirements](docs/01-product-requirements.md)         | Goal, product decisions D1–D8, scope, open conflicts. **Rank 1.**        |
| [02 Development architecture](docs/02-development-architecture.md) | The master rule set                                                      |
| [03 Database](docs/03-database.md)                                 | Tables, columns, indexes                                                 |
| [04 API](docs/04-api.md)                                           | REST conventions, envelopes, errors; per-domain endpoints in `docs/api/` |
| [05 Authentication](docs/05-authentication.md)                     | Sessions, sign-in and sign-out, password hashing                         |
| [06 Multi-tenancy](docs/06-multi-tenancy.md)                       | Tenant model and isolation rules                                         |
| [07 Roles and permissions](docs/07-roles-permissions.md)           | Permission catalog, default roles, screen and action matrix              |
| [08 Load lifecycle](docs/08-load-lifecycle.md)                     | Load statuses and state machine                                          |
| [09 Dispatch lifecycle](docs/09-dispatch-lifecycle.md)             | Assignment and dispatch rules                                            |
| [10 Driver lifecycle](docs/10-driver-lifecycle.md)                 | Driver stages, driver app prerequisites                                  |
| [11 Billing lifecycle](docs/11-billing-lifecycle.md)               | Invoices, batches, payments                                              |
| [12 Settlement lifecycle](docs/12-settlement-lifecycle.md)         | Driver pay and approval                                                  |
| [13 Document system](docs/13-document-system.md)                   | Object storage and document metadata                                     |
| [14 Notification system](docs/14-notification-system.md)           | Channels and event-driven delivery (planned)                             |
| [15 Integration architecture](docs/15-integration-architecture.md) | Adapters and planned providers                                           |
| [16 AI architecture](docs/16-ai-architecture.md)                   | Controlled AI tools (planned)                                            |
| [17 Event architecture](docs/17-event-architecture.md)             | Outbox, naming, idempotency, event catalogue                             |
| [18 Background jobs](docs/18-background-jobs.md)                   | Worker, BullMQ queues, retries                                           |
| [19 Security](docs/19-security.md)                                 | Threat model, controls, known gaps                                       |
| [20 Testing](docs/20-testing.md)                                   | Unit, integration, e2e, parity, CI                                       |
| [21 Deployment](docs/21-deployment.md)                             | Environments and target topology                                         |
| [22 Monitoring](docs/22-monitoring.md)                             | Health, logs, request ids, gaps                                          |
| [23 Disaster recovery](docs/23-disaster-recovery.md)               | Backups, recovery procedures                                             |
| [24 Development phases](docs/24-development-phases.md)             | Phase-by-phase status                                                    |
| [25 Claude development rules](docs/25-claude-development-rules.md) | Working rules and how to add a domain module                             |
| [Design brief](docs/reference/design-brief.md)                     | Binding resolutions for the Runtruck1 port                               |
| [Runtruck1 port specs](docs/reference/runtruck1/)                  | What each Runtruck1 screen shows and does                                |

Contributors, including AI assistants, must follow [CLAUDE.md](CLAUDE.md) and the architecture.
