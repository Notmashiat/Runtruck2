# 25 — Claude Development Rules

Rules for Claude, and any other contributor, working in this repository. The master rules are [02-development-architecture.md](02-development-architecture.md); this document condenses §39–§45 and adds the practices specific to this repository. When documents conflict, follow the hierarchy in architecture §49. **Never choose silently:** name the conflict and ask, or record it in [01-product-requirements.md](01-product-requirements.md) §6.

## 1. Code quality (§39)

- Strict TypeScript everywhere. `no-explicit-any` is an error; an `any` needs a comment explaining why.
- Keep functions small and names clear. Do not duplicate business logic: shared formulas go in `@runtruck/calculations`, shared schemas in `@runtruck/validation`, shared wire types in `@runtruck/types`.
- Prefer existing services such as `AuditService`, `EventsService`, `ClockService`, `AppError` and `withMeta` to new abstractions. Add no abstraction without a second use.
- Comment the _why_ of complex logic, including every reproduced Runtruck1 quirk (cite the port spec or the D-number).

## 2. Dependencies (§40)

Before adding a package, state:

1. why it is needed
2. why existing dependencies or Node built-ins cannot do the job
3. that it is maintained
4. its security and licence status
5. its architectural cost

Native install scripts must be allow-listed in `pnpm-workspace.yaml` (`onlyBuiltDependencies`).

## 3. Git (§41)

- Branches: `main`, `develop`, `feature/*`, `fix/*`.
- Conventional commits: `feat:`, `fix:`, `test:`, `docs:`, `chore:`.
- Never commit `.env` or secrets.
- In a multi-agent session, sub-agents do **not** commit. The orchestrator commits.

## 4. Workflow for every change (§42)

Read the docs → understand the architecture → inspect the existing code → identify the affected modules → plan → make the smallest correct change → typecheck → lint → run the relevant tests → run broader tests → review security, tenant isolation, permissions and database impact → report what changed, which tests ran and what remains.

Never go straight from request to code.

## 5. Never (§43)

- Rewrite the app, change the stack, replace PostgreSQL or add microservices without approval.
- Delete working functionality or change unrelated modules.
- Disable a security check, the Origin check, a permission decorator or a tenant filter, even to make a test pass or to reproduce a quirk (docs/01 D6).
- Give AI unrestricted database access.
- Store secrets in source code.
- Ignore failing tests, hide errors or **mark incomplete work as complete**. Stub controls are tracked as _not implemented_ (docs/01 §7).
- Invent external API behaviour or assume an integration works without verifying it.
- Make destructive production changes without explicit approval.

## 6. Feature template and done criteria (§44, §45)

Every feature is specified with the §44 template:

FEATURE, PURPOSE, USERS, PERMISSIONS, DATABASE TABLES/CHANGES, API ENDPOINTS, BUSINESS RULES, STATE CHANGES, EVENTS, BACKGROUND JOBS, NOTIFICATIONS, INTEGRATIONS, AI, SECURITY REQUIREMENTS, ERROR CASES, TESTS, ACCEPTANCE CRITERIA.

It is **done** only when all of these hold: requirements implemented, security implemented, tenant isolation verified, permissions verified, validation implemented, tests passing, build passing, no known critical errors, acceptance criteria met.

## 7. Repository practices

### 7.1 File ownership

- In a multi-agent session each agent edits **only the files it was assigned**. When another file must change, say so in the final report instead of editing it.
- Shared index files re-export every domain already (`packages/types/src/index.ts`, `packages/validation/src/index.ts`). Edit only your domain's `<domain>.ts`.
- `packages/permissions`, `docs/07-roles-permissions.md` and `docs/01 §6` have single owners. Propose changes to them, and do not make the changes yourself unless you own the file.

### 7.2 Commands

On Windows (Git Bash), put Node and pnpm on `PATH` first:

```sh
export PATH="/c/Program Files/nodejs:/c/Users/mashi/AppData/Roaming/npm:$PATH"
cd C:/Users/mashi/Runtruck2
```

| Task                                                                  | Command                                                            |
| --------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Install                                                               | `pnpm install`                                                     |
| Build everything (packages must be built before dependants typecheck) | `pnpm build`                                                       |
| Lint / typecheck / unit tests                                         | `pnpm lint` · `pnpm typecheck` · `pnpm test`                       |
| One package                                                           | `pnpm --filter @runtruck/api test` (or `typecheck`, `lint`)        |
| Integration tests (needs Docker)                                      | `pnpm infra:up` then `pnpm test:integration`                       |
| Generate a migration after a schema change                            | `pnpm db:generate` (builds first; drizzle-kit reads `dist/schema`) |
| Apply migrations / seed / rebuild the demo                            | `pnpm db:migrate` · `pnpm db:seed` · `pnpm db:reset`               |
| Format                                                                | `pnpm format` / `pnpm format:check`                                |

Do not try to run PostgreSQL or Redis where Docker is not available. Say what was not verified.

### 7.3 Adding a domain module (checklist)

1. **Specify first.**
   - Tables in [03-database.md](03-database.md).
   - Endpoints, DTOs, ordering, `meta.summary` formulas, errors, audit actions and events in `docs/api/<domain>.md`.
   - Permissions from [07](07-roles-permissions.md) §6.
   - The state machine in the lifecycle doc (08, 09, 11, 12…).
2. **Schema** in `packages/database/src/schema/<domain>.ts`:
   - `id()`, `organizationId()`, `...timestamps()`.
   - Every tenant index leads with `organization_id`.
   - Money in integer cents, business days as `date`, instants as `timestamptz`.
   - Export it from `schema/index.ts`.
   - Run `pnpm db:generate`. Never edit a migration that has been applied.
3. **Contracts:**
   - DTO types in `packages/types/src/<domain>.ts`.
   - Zod input schemas in `packages/validation/src/<domain>.ts` (reuse `pageQuerySchema`, `isoDateSchema`, `uuidSchema`, `timeOfDaySchema`).
   - Human numbers are integers, and the web adds prefixes such as `L-`.
4. **Permissions:** use catalog keys. A genuinely new key goes into `catalog.ts`, `roles.ts`, `permissions.test.ts` and the 07 change log, with the reason.
5. **API module** in `apps/api/src/<domain>/`:
   - `<domain>.controller.ts`: every handler has `@RequirePermissions(...)`, `@AuthenticatedOnly()` or `@Public()`. Take `@Auth() ctx: AuthContext` and validate `@Body`/`@Query`/`@Param` with `new ZodValidationPipe(schema)`. Lists return `withMeta(rows, { total, limit, offset, summary })`.
   - `<domain>.service.ts`: business rules and state machine checks, throwing `AppError` (`notFound('<ENTITY>_NOT_FOUND', …)`, `conflict(...)`, `validation(...)`). Use "today" and "now" only from `ClockService`.
   - `<domain>.repository.ts`: every query filters by `ctx.organizationId` ([06](06-multi-tenancy.md) §3). Join or batch, never N+1.
   - `<domain>.module.ts`: **register it in `DOMAIN_MODULES`** (`apps/api/src/domain-modules.ts`). Nothing else needs to change.
6. **Writes:**

   ```ts
   return this.db.transaction(async (tx) => {
     // validate references with the org filter, check the state machine, change rows
     await this.audit.record(tx, ctx, { action: 'LOAD_CREATED', entityType: 'load', entityId, entityLabel: 'L-40223', next });
     await this.events.emit(tx, ctx, { type: 'LoadCreated', aggregateType: 'load', aggregateId: entityId, payload: { loadId: entityId } });
     return dto;
   });
   ```

   Human numbers come from `organization_counters` (`UPDATE … RETURNING`) inside the same transaction.

7. **Events:** add the event to [17](17-event-architecture.md) §5. Consumers are idempotent handlers in the worker.
8. **Tests:**
   - Unit tests for formulas and state machines.
   - Integration tests for 401, 403, cross-tenant 404, 400, the happy path, and the audit and outbox rows ([20](20-testing.md) §3).
   - An e2e test for critical flows.
9. **Web:**
   - Fetch with the `api` client and TanStack Query. Invalidate lists after writes.
   - Hide API-backed controls with `useSession().can(...)` (never a security boundary).
   - Map enums to Runtruck1 labels and tones in the web.
   - Never compute authoritative money or KPIs in the browser.
10. **Report:** what changed, which tests and commands ran with their results, what was not verified, and any decisions for docs/01 §6.

### 7.4 Parity specifics

- Runtruck1 (`docs/reference/runtruck1/*.md` and the prototype source) defines what the UI shows. The design brief ([reference/design-brief.md](reference/design-brief.md)) resolves the conflicts between specs.
- Reproduce quirks in the web, never by weakening the API (D6).
- Numbers come from records (D5). Formatting and wording stay identical.
- Demo-load content is real seeded rows, rendered by the same code path (D7).
