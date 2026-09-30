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
- **Loading, refusal and error states** (the one rule for every ported page; the domain documents reference it and do not restate a different one; 01 §6):
  1. **First paint has the data.** The server page prefetches the screen's queries for the calls the member is permitted to make and hydrates them (TanStack Query `initialData` / `HydrationBoundary`), so in normal use no Runtruck1 screen shows a loading state. Data a layout-level component needs (the Header's "Invoice N loads") is hydrated above that component.
  2. **Pending** (a query without prefetched data, e.g. after client navigation): render the page's full structure (tab bar, header, KPI cards, card titles, table head) with KPI values "—" and no notes, no rows, no chart bars and **no** empty-state line. No spinners or skeletons Runtruck1 never had. A refetch keeps the previous data on screen.
  3. **Refused (403)**: exactly as pending. Nothing about the refused data is shown, and no message is added (the sidebar already hides most refused screens; 07 §5, §7).
  4. **Any other error** (400, 404, 5xx, network): the structure of rule 2 plus one `ui-empty` line with the API error `message` (user-safe by 04 §2), in the table card, or in the first card of a page without a table.
- **Data loading pattern (use exactly this):**
  - In `src/lib/api/<domain>.ts` (no `'use client'` directive), declare each read once with `apiQuery(queryKey, path)` from `@/lib/api/query`, using the query keys your API doc specifies. Export the hooks there too: `useApiQuery(def)`, `useMutation` + `invalidate(queryClient, ...prefixes)`.
  - `src/app/app/<route>/page.tsx` is an async **server** component:
    1. `const me = await getMe()` (from `@/lib/api/server`);
    2. pick the query defs the member may read (`me.permissions`);
    3. `return <Prefetch queries={[...]}><YourClientPage /></Prefetch>` (from `@/lib/api/prefetch`).

    The client page (a `'use client'` component in `src/components/<group>/`) calls `useApiQuery(def)` with the same defs.
  - The `/app` layout already prefetches `uninvoicedLoadsQuery` above the Header on accounting routes.
- **View-model builders** live in `packages/calculations/src/view-models/<domain>.ts` (pre-created, already re-exported; **owned by the domain's group**), together with label/tone maps. They are pure functions over DTO types, and the API uses the same builders for server-side `q` (03 §1.11). Rebuild with `pnpm --filter @runtruck/calculations build` after changing them.
- **Header contracts** (Header.tsx and the /app layout already import these):
  - `uninvoicedLoadsQuery` (an `apiQuery` def, key `['billing', 'uninvoiced-loads']`, path `/billing/uninvoiced-loads?limit=500`) from `@/lib/api/billing`
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

## 8. Cross-cutting items assigned to a group

- **C27 compliance warnings (loads group):** `POST /loads` evaluates the assigned driver's compliance (expired CDL or medical card, missing required driver documents, per `driver_documents`) against `clock.today`. It **never blocks**. It records each problem in the `LOAD_CREATED` / `LOAD_ASSIGNED` audit entry's `next.complianceWarnings`, and integration tests assert this for Priya Raman (expired CDL).
- **Seeded document files (loads group):** the demo seed stores storage keys, sizes and checksums of a placeholder PDF (`PLACEHOLDER_PDF*`, `documentStorageKey` from `@runtruck/database/seed`) but writes no objects.
  - Add `packages/database/src/seed/storage.ts` exporting `uploadSeedDocuments(db, s3Config)`: it puts the placeholder PDF at every seeded version's key that is missing from the bucket. `@aws-sdk/client-s3` is already a dependency of `@runtruck/database` and `@runtruck/api`.
  - Call it from `scripts/seed.ts` and `scripts/reset.ts` when `S3_*` env vars are set, from `createTestContext` (test bucket), and from `tests/e2e/global-setup.ts`.
  - Also export it from `@runtruck/database/seed`.
  - You own those call sites for this change.
- **Shared S3 client (loads group):** `apps/api/src/storage/` holds a `StorageService` wrapping `@aws-sdk/client-s3`, built from the validated `S3_*` env, with timeouts per docs/13 §2. Other groups never touch storage.
