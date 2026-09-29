# Implementation brief (parity slice)

This brief is binding for everyone implementing a domain group. Read it after [design-brief.md](design-brief.md), and follow the architecture's §42 workflow.

## 1. Sources of truth for your group

1. **Product decisions:** [01-product-requirements.md](../01-product-requirements.md).
2. **Tables:** [03-database.md](../03-database.md) and `packages/database/src/schema/*.ts`. Tables already exist. Do not change them unless the doc is wrong. If you must change one, fix both the doc and the code, regenerate the migration (see §6), and say so in your report.
3. **Endpoints and screen mappings:** [04-api.md](../04-api.md) and `docs/api/<domain>.md`.
4. **Wire contracts:** `packages/types/src/<domain>.ts` and `packages/validation/src/<domain>.ts`. Treat them as frozen. If a change is unavoidable, make it minimal and additive, rebuild that package, and report it.
5. **What the screen must look like:** the Runtruck1 source at `C:/Users/mashi/AppData/Local/Temp/claude/runtruck-ref/Runtruck1/app/src`, plus the port specs in `docs/reference/runtruck1/`.

## 2. API module rules (apps/api)

- **Layout.** One folder per module under `apps/api/src/<module>/`, following architecture §6: `<m>.module.ts`, `<m>.controller.ts`, `<m>.service.ts`, `<m>.repository.ts`, plus optional `<m>.events.ts`, `<m>.mapper.ts` and `tests/`. Register every module class in **your group's** `apps/api/src/modules/<group>.ts`. Never edit another group's registry.
- **Imports.** ESM with `.js` extensions on relative imports. Constructor-injected classes stay value imports. Import types used only as types with `import type`.
- **Controllers** are thin:
  - Validate with `new ZodValidationPipe(schema)` on `@Body`, `@Query` and `@Param`.
  - Declare permissions with `@RequirePermissions(...)`.
  - Get the tenant with `@Auth() ctx`.
  - Return data, or `withMeta(data, meta)`.
- **Tenancy is non-negotiable.**
  - Every repository method takes `organizationId` (from `ctx`) as a required argument.
  - Every query filters on it. That includes joins: join conditions include `organization_id` equality for tenant tables.
  - A lookup by id or number that finds nothing in the org throws `AppError.notFound('<ENTITY>_NOT_FOUND', …)`, whether the row exists in another org or not.
  - Never read `organizationId` from the request.
- **Writes** run in `db.transaction(async (tx) => …)`:
  1. Validate business rules and state transitions. An illegal transition throws `AppError.conflict(...)`.
  2. Write the rows.
  3. `audit.record(tx, ctx, {...})`.
  4. `events.emit(tx, ctx, {...})`.
  - Allocate human numbers from `organization_counters` with `UPDATE … SET next_value = next_value + 1 … RETURNING` inside the same transaction.
  - Use `clock.now(ctx.timezone)` for business timestamps and `clock.today(ctx.timezone)` for "today".
- **Reads** use no N+1 queries: join or batch with `inArray`. Lists honour `limit`/`offset` (bounded), and `q` where the doc says so. Compute `meta.summary` in SQL, or in one pass over the page with its own aggregate query.
- **Money** is integer cents end to end. Round only where the doc specifies it.
- **Errors** are `AppError` with the doc's codes. Never leak internals.

## 3. Tests you must write (architecture §31, §45)

- **Unit tests** (`src/**/<name>.test.ts`, vitest, run with `pnpm --filter @runtruck/api test`) cover pure business logic: calculations, state machines, mappers.
- **Integration tests** (`apps/api/test/<domain>.int.test.ts`) use `createTestContext()` from `test/helpers.ts`. Every endpoint needs at least:
  - a happy path asserting the exact seeded values the API doc lists;
  - 401 without a session;
  - 403 for a fixture user lacking the permission;
  - **tenant isolation**: `t.as('otherAdmin')` cannot see or modify demo-org rows (404 or an empty list);
  - validation 400s for writes;
  - audit and event rows written for writes.

  Docker/PostgreSQL may not be available while you work. Write the tests anyway, make them **typecheck**, and say in your report that they have not run yet.

## 4. Web rules (apps/web)

- **Pages** go in `src/app/app/<route>/page.tsx`, components in `src/components/<group>/`, and data hooks in `src/lib/api/<domain>.ts` (TanStack Query `useQuery`/`useMutation`; invalidate affected queries after writes).
- **Port the markup verbatim** from the Runtruck1 component. Keep the same elements, class names, inline styles, text, conditional rendering and quirks (D6). Replace only:
  1. mock-data reads, with hook data mapped to the same shape;
  2. react-router APIs, with Next equivalents (`usePathname`, `useRouter().push(href, { scroll: false })`, `next/link` with `scroll={false}`, `useParams`);
  3. `tagClass` → `<Tag tone=…/>`, with the same colour mapping;
  4. business writes, with API mutations.
- **Search parity:** map each DTO row to a *view-model row* with the same keys and **formatted string values** as Runtruck1's mock object for that row, then filter with `matchesQuery(viewRow, query)` from `src/lib/search.ts`. Search then behaves exactly like Runtruck1, including hidden fields.
- **Formatting:** use `@runtruck/calculations` (`formatMoney`, `formatShortDate`, `formatDate`, `formatAge`, `formatHos`, `formatActivityTime`, `formatLoadNumber`, …). Never compute authoritative money on the client. KPI values come from the API's `meta.summary`.
- **Client components** (`'use client'`) are any that use hooks. Read `localStorage` only in effects or event handlers, never during render (hydration).
- **While data loads,** render the same page structure with no rows. Don't invent spinners or skeletons Runtruck1 never had. On error, render the page with a `ui-empty` row showing the API error message.
- **Header contracts** (Header.tsx already imports these):
  - `useUninvoicedCount(): number | undefined` from `@/lib/api/billing`
  - `useApproveSettlements(): () => void` from `@/lib/api/settlements`
  - `NewLoadDialog({ onClose, onCreated(loadNumber: string) })` from `@/components/loads/NewLoadDialog`, where `loadNumber` is formatted like `L-40223`
- **Permissions:** hide or disable controls with `useSession().can(...)` only when the member lacks the permission. Rosa (Admin) sees exactly Runtruck1.

## 5. Commands and machine limits

- Before any command: `export PATH="/c/Program Files/nodejs:/c/Users/mashi/AppData/Roaming/npm:$PATH"`, run from `C:/Users/mashi/Runtruck2`.
- **Type check:**
  - API: `cd apps/api && npx tsc -p tsconfig.json --noEmit`
  - web: `cd apps/web && npx tsc -p tsconfig.json --noEmit`
  - The web needs `next-env.d.ts`. If it's missing, run `npx next typegen` once, or create the standard file.
- **Lint:** `npx eslint <your paths>` from the app directory.
- **Unit tests:** `pnpm --filter @runtruck/api test`.
- The machine has 8 GB of RAM, and other agents run concurrently:
  - Do **not** run `next build`, `next dev` or a full `pnpm build`.
  - Do not start servers.
  - Rebuild a shared package only if you changed it (`pnpm --filter @runtruck/<pkg> build`).
- Do not `git commit`. Do not edit files outside your ownership list. If another group's file must change, say so in your final report.

## 6. Schema changes (rare)

1. Change the doc and the Drizzle file.
2. `pnpm --filter @runtruck/database build`.
3. `cd packages/database && pnpm exec drizzle-kit generate --name <change>`.
4. Never edit an existing migration file.
5. Report it.

## 7. Report (final reply)

- What you built: files, endpoints and pages.
- Which tests exist, and which ran and passed or did not run, with the reason.
- Type-check and lint status.
- Every deviation from Runtruck1 or from the docs, with the reason.
- Anything another group must do.
- Open issues.
