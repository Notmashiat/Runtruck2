# 20 — Testing

Every feature has tests appropriate to its risk (architecture §31). A feature is complete only when its tests pass (§45). This document explains how tests are organised and run, and states honestly what exists today (2026-09-29).

## 1. Layers

| Layer       | Tool                         | Scope                                                             | Where                                 | Command                                         |
| ----------- | ---------------------------- | ----------------------------------------------------------------- | ------------------------------------- | ----------------------------------------------- |
| Unit        | Vitest 5                     | Pure functions, guards, pipes, filters, schemas, calculations     | `**/src/**/*.test.ts` in each package | `pnpm test` (Turbo runs every package's `test`) |
| Integration | Vitest 5 + supertest         | The real HTTP app (`createApp`) against real PostgreSQL and Redis | `apps/api/test/**/*.int.test.ts`      | `pnpm test:integration`                         |
| End-to-end  | Playwright                   | Real user workflows in a browser against the seeded demo          | `tests/e2e` (package `@runtruck/e2e`) | `pnpm test:e2e`                                 |
| Parity      | Playwright (+ manual review) | Runtruck2 renders like Runtruck1 (docs/01 R1)                     | `tests/e2e` (parity specs)            | `pnpm test:e2e`                                 |

## 2. Unit tests

**Existing test files** (all passing when last run on 2026-09-29):

| Package                 | Files                                                                                                                                                                                                                                                                                                           |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api`              | `auth/permissions.guard.test.ts` (deny by default, public, authenticated-only, missing permission); `common/errors/all-exceptions.filter.test.ts` (envelope, no leaks); `common/validation/zod-validation.pipe.test.ts` (dotted issue paths); `common/clock/clock.service.test.ts` (org timezone, `DEMO_TODAY`) |
| `packages/config`       | `env.test.ts` (defaults, no secret leakage, `DEMO_TODAY` refused in production)                                                                                                                                                                                                                                 |
| `packages/database`     | `security/password.test.ts` (scrypt format, salt, malformed and dummy hashes)                                                                                                                                                                                                                                   |
| `packages/permissions`  | `permissions.test.ts` (key format, roles only grant catalog keys, `hasPermissions`)                                                                                                                                                                                                                             |
| `packages/validation`   | `auth.test.ts`                                                                                                                                                                                                                                                                                                  |
| `packages/calculations` | `dates.test.ts`, `format.test.ts`                                                                                                                                                                                                                                                                               |

**NestJS and SWC.** Nest's dependency injection needs decorator metadata (`emitDecoratorMetadata`). Vitest's default transformers (esbuild/oxc) do not emit it, so the API's Vitest configs use `unplugin-swc` through `apps/api/vitest.swc.ts`.

On Windows, SWC's native addon checks the permissions of its binding cache directory and refuses a cache under the user profile whose ACL it does not trust. `vitest.swc.ts` therefore sets **`SWC_NATIVE_BINDING_CACHE`** to `<repo>/node_modules/.cache/swc` before `@swc/core` is first loaded, which is why the plugin is imported dynamically. Do not import `unplugin-swc` statically in a Vitest config.

**Known issue.** `apps/web` has a `test` script (`vitest run`) but no test files. Vitest exits with code 1 ("No test files found"), so **`pnpm test` fails at `@runtruck/web`** until a web test is added or the script gets `--passWithNoTests`.

What deserves unit tests:

- Every function in `@runtruck/calculations`: money and date formatting, KPI formulas (D5).
- Every state machine's transition table.
- Zod schemas: accept valid input, reject each invalid field.
- Web presentation mappers: enum → Runtruck1 label and chip tone.

## 3. Integration tests

The configuration is `apps/api/vitest.integration.config.ts`:

- files: `test/**/*.int.test.ts`
- `globalSetup: test/global-setup.ts`
- `fileParallelism: false`, because all files share one database
- 30 s test timeout and 60 s hook timeout

Environment:

- **PostgreSQL**: `TEST_DATABASE_URL` points at `runtruck_test`. `infrastructure/docker/postgres-init/01-create-test-database.sql` creates that database the first time the Postgres container initialises its volume. Tests never touch the development database.
- **Redis**: `REDIS_URL`. Use a separate logical database for tests (e.g. `redis://localhost:6379/1`) so rate-limit counters and queues do not mix with development data.
- **Object storage**: the local S3 (SeaweedFS) bucket `runtruck-documents-test`.
- Start them with `pnpm infra:up` (Docker Desktop required).

How a test works:

1. The global setup applies the migrations to `TEST_DATABASE_URL` and loads the **test fixtures**:
   - the demo organization Sunridge Freight
   - a second organization, **"Test Carrier Co"**
   - users holding the Admin, Dispatcher, Driver and Accounting roles (design brief §3)
2. The test builds the app with **`createApp()`** from `apps/api/src/create-app.ts`, the same function `main.ts` uses, so the guards, filters, interceptors and middleware are the production ones. The API reads `DATABASE_URL` through `ConfigModule`, so the setup must point `DATABASE_URL` at the test database **before** `createApp()` runs.
3. It signs in with `supertest.agent(app.getHttpServer()).post('/api/v1/auth/login')`. The agent keeps the `rt_session` cookie for later calls.

Required cases for **every** endpoint:

| Case                                                                         | Expectation                                                                                                                            |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| No session                                                                   | 401 `UNAUTHORIZED`                                                                                                                     |
| Missing permission (Driver, Dispatcher or Accounting fixture as appropriate) | 403 `FORBIDDEN`                                                                                                                        |
| Another organization's id                                                    | 404 with the entity code, identical to an unknown id ([06](06-multi-tenancy.md) §4)                                                    |
| Invalid body, query or params                                                | 400 `VALIDATION_ERROR` with `issues[].path`                                                                                            |
| Cross-site `Origin` on a write                                               | 403 `CROSS_ORIGIN_REJECTED`                                                                                                            |
| Happy path                                                                   | Correct `{data, meta}`. For lists, the seed's Runtruck1 order and the `meta.summary` figures from the domain's API document.           |
| Writes                                                                       | The row, **one `audit_logs` row and one `events` row** exist with the caller's `organization_id`. None exist after a rejected request. |
| State machines                                                               | An illegal transition gives 409 and changes nothing.                                                                                   |

**Status: built.** `apps/api/test/global-setup.ts` rebuilds `TEST_DATABASE_URL` from the migrations (`0000`–`0003`); `helpers.ts` (`createTestContext`) truncates, seeds `seedTestFixtures` from `@runtruck/database/testing` and signs in fixture users. Suites: `auth.int.test.ts` (sessions, guards, the append-only audit trigger) and `seed.int.test.ts` (the demo seed and the tenancy fixtures). Each domain module adds its `<domain>.int.test.ts` with the cases above.

## 4. End-to-end tests

- **Tool:** Playwright, in the workspace package `tests/e2e` (`@runtruck/e2e`; `pnpm-workspace.yaml` already includes `tests/*`).
- **Target:** the running web app, API and worker against the **seeded demo**. Run `pnpm db:reset` first, with `DEMO_TODAY=2026-09-03`, so every run starts from the same state and the same "today".
- **Sign-in:** as Rosa Medina, with the password from `SEED_DEMO_PASSWORD`, read from the environment and never hard-coded in the test.
- **Critical workflows** (each must have e2e coverage):
  1. Sign in → Dashboard; sign out → `/`. `/app` without a session → `/login`.
  2. Create a load with stops, a rate, an assignment and attached documents → lands on `/app/loads/L-40223`. The load is listed after going Back (gaps §2.5).
  3. Planner: add, edit and delete an event; add, rename and delete a color code; **Reset calendar** restores the defaults.
  4. Payroll: **Approve all** moves the three Ready settlements to Approved. It survives a reload.
  5. Routing: case-insensitive paths, the six legacy redirects, section roots → first tab, unknown path → `/`.
- **Status: built.** `tests/e2e` (`@runtruck/e2e`, `pnpm test:e2e`) runs Playwright against its own database (`runtruck_e2e`, or `E2E_DATABASE_URL`) and bucket with the built API, worker and web on ports 4000/3000. Playwright starts those servers before `globalSetup`, so the API is awaited on its port, and `globalSetup` then creates and migrates the database and loads the demo. Specs: `auth.spec.ts` and `shell.spec.ts` (workflows 1 and 5), `new-load.spec.ts` (workflow 2: Priya Raman, two stops, rates and a PDF; the load on its detail page, the board, the planner and the dashboard; the non-blocking CDL warning on the audit trail), `planner.spec.ts` (workflow 3: add, edit and delete an event, read-only load stops, add, rename and delete a color code, Reset calendar), `payroll.spec.ts` (workflow 4, through "Approve all" and the header's "Run settlements"), and `navigation.spec.ts` (every sidebar section and tab with its seeded KPI tiles). Specs that change data or assert seed figures reload the demo first (`demo-data.ts` `resetDemoData`), so files are independent of their order. Tenant isolation is covered by the API integration tests. The New Load → driver accepts → delivers → POD → invoice chain of architecture §31 is not e2e-tested yet: the driver app and invoicing writes are not built (01 §7).

## 5. Parity checks (docs/01 R1)

Runtruck2 must look and behave like Runtruck1. Parity is checked in three ways:

1. **Text and DOM assertions** in Playwright, taken from each port spec's acceptance checklist (`docs/reference/runtruck1/*.md`): exact strings, class names, element order, and quirks such as "1 loads" and the inert stub buttons (D6).
2. **Screenshots.** Runtruck1 (the prototype source under `Runtruck1/app`, run with Vite) and Runtruck2 are captured at the same viewport, in light and dark mode, with the same pinned date. They are compared visually. Differences are allowed only in:
   - figures that docs/01 **D5** recomputes from records. The formatting and wording must still match.
   - the **D7** stop time line on the 8 board loads' detail pages.
   - the `/login` screen (D2).
3. **Figures.** For D5 metrics, the expected numbers come from the formula in the domain's API document applied to the seed. They do not come from Runtruck1's hard-coded values.

## 6. CI gates

Architecture §32 order for every pull request:

1. `pnpm install --frozen-lockfile`
2. `pnpm format:check`
3. `pnpm lint`
4. `pnpm typecheck`
5. `pnpm test`
6. `pnpm test:integration`, with PostgreSQL 17 and Redis 8 as service containers
7. `pnpm build`
8. `pnpm test:e2e` (main branch, or nightly)

Production deployment requires every gate to pass.

**Status: built** (`.github/workflows/ci.yml`: every gate above, with PostgreSQL, Redis and SeaweedFS service containers). Open: `pnpm format:check` and a dependency-audit gate are not in the workflow, and the "Unit tests" gate currently runs the e2e suite too (§4).

## 7. Rules

- Never weaken or skip a test, guard or tenant filter to make a test pass (architecture §43). A failing test is reported, not hidden.
- Tests are deterministic. Use `ClockService` with a pinned `DEMO_TODAY`, or Vitest fake timers. Never read the wall clock in assertions.
- Test data comes from fixtures or the seed, never from the development database.
- Secrets in tests come from the environment. Test passwords are fixture values, never real credentials.
