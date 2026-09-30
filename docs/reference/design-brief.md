# Design brief: Runtruck1 parity on the Runtruck architecture

This brief is binding input for everyone who writes `docs/03-database.md`, `docs/04-api.md` and `docs/api/*.md`, and for the code built from them.

Read these first, in this order:
1. [01-product-requirements.md](../01-product-requirements.md): the product owner's decisions **D1–D8**. They outrank everything else here.
2. [02-development-architecture.md](../02-development-architecture.md): the rules.
3. The port specs in [runtruck1/](runtruck1/), which define what the UI shows and does. Where they propose tables or endpoints, those are proposals; this brief and the docs you write are canonical. [gaps.md](runtruck1/gaps.md) lists the cross-spec conflicts, which are resolved below.

## 1. Existing code you must build on (do not redesign)

**`packages/database/src/schema/platform.ts`** holds these tables:
- `organizations`
- `users`
- `organization_members`: member number and title
- `sessions`
- `permissions`, `roles`, `role_permissions`, `user_roles`
- `organization_counters`: per-org sequences. Keys: `load`, `invoice`, `invoice_batch`, `claim`
- `audit_logs`: append-only
- `events`: the outbox

You may **add** columns or tables when a screen needs them. Do not rename or remove anything. Shared column helpers live in `_columns.ts`: `id()`, `timestamps()`. `organizationId()` is exported from `platform.ts`.

**`packages/permissions/src/catalog.ts`** is the permission catalog, and `roles.ts` holds the default roles. Use these keys. If a screen truly needs another key, add it to the catalog and to the default roles, and record why in `docs/07-roles-permissions.md`.

**API core (`apps/api/src`):**
- `@RequirePermissions(...)`, `@AuthenticatedOnly()`, `@Public()` and `@Auth() ctx: AuthContext`. The context carries `organizationId`, `userId`, `timezone` and `permissions`.
- `withMeta(data, meta)` produces the `{data, meta}` envelope.
- `AppError` provides categorized errors with specific codes.
- `ZodValidationPipe(schema)`.
- `AuditService.record(tx, ctx, entry)`.
- `EventsService.emit(tx, ctx, event)` writes to the outbox.
- `ClockService.today(tz)` / `.now(tz)` are the demo-pinned clock. Every "today" computation must use it.

**`apps/web/src`:**
- `api` client: `api.get/post/patch/delete/upload`, returning `{data, meta}`.
- `useSession()`: `me`, `can(...)`.
- `useShellUi()`: `query`, `loadTab`, `driverTab`.
- TanStack Query provider.
- `@runtruck/ui` has Card, Kpis, Tag (`tone: 'blue'|'gray'|'amber'|'green'`), Blueprint and ComingSoon.
- The CSS is Runtruck1's, verbatim.

## 2. Canonical resolutions of the cross-spec conflicts (gaps.md §4)

| Topic | Decision |
|---|---|
| Statuses | Lifecycle statuses are **stored enums**, because they are facts on Runtruck1's records: load status, invoice status (`draft/sent/overdue/paid`), bill status, settlement status, contract status, onboarding stage, work-order status, document status, violation status, claim status, trailer and truck status, driver duty status. **Aggregates** are always computed from rows: counts, sums, averages, ages, "this week", KPI tiles, bars and chart values (D5). Chip tone and label are web presentation, mapped from the enum per screen. `tagClass` is never stored. |
| Delayed / Needs driver / Needs POD | These are load status enum values mapped from Runtruck1's labels 1:1. Define the enum and its state machine in `docs/08-load-lifecycle.md`, mapping each label to an architecture §17 lifecycle state where one exists. |
| Invoice overdue | Stored status `overdue`, as on the record. INV-8836 stays overdue. |
| Compliance watchlist (Drivers tab; Runtruck1's Dashboard has none) | **Stored records.** Table `compliance_reminders`: driver, item label, due date plus precision (`day` or `month`), in seed order. Runtruck1 keeps them as a record list (`COMPLIANCE` + 1). |
| Contract "Expiring" / "Renewal due" | Stored contract status. Counts are computed. |
| Created-load stops in the planner | Reproduce the quirk. Planner time = the stop's planned slot if set, else the window when both open and close are set, else **08:00–09:00**. Seeded board loads carry planned slots equal to Runtruck1's hash-derived times. Load detail and the Loads expand row show the **window**. |
| Uninvoiced loads and invoice-only loads | Seeded as real loads with `archived_at` set: delivered and off the dispatch board. `GET /loads` (board), planner stop events and the EventDialog "Related load" list **exclude archived loads**. **Uninvoiced** is computed: loads (archived or not) in a delivered state that have no invoice. Against the seed that gives exactly Runtruck1's 11 rows, because the delivered board loads L-40212, L-40210 and L-40214 already have invoices. Verify this. If it doesn't hold, store an explicit `billing_status` and record why. |
| Money formatter | One shared formatter in `@runtruck/calculations`: `'$' + (cents/100).toLocaleString('en-US')`. That is Runtruck1's `money(n)` with n in dollars, including its quirks. Negative and em-dash variants follow data-model §2.3. |
| Revenue chart | Computed per day from records for the **7 days ending yesterday** (today − 7 … today − 1), labelled with the weekday of each date: Thu…Wed on 2026-09-03. Define "revenue of a day" in the dashboard API doc (e.g. Σ line haul of loads delivered that day). |
| Hardcoded KPI texts ("+4 vs. last week", "$168K", "+9.2%", "7.8% deadhead", CRM tiles, AR buckets, driver pay YTD…) | Computed from records with a formula written down in the API doc. The formatting and the note wording stay identical, and only the numbers change (D5). Where no record can support a metric at all (e.g. deadhead needs empty miles), **add the minimal stored fact** it needs (e.g. `empty_miles` on loads) and seed it from Runtruck1's figures where those can be back-solved. Otherwise show the computed value. Record every such choice in `docs/01-product-requirements.md §6`, with status "decided in design". |
| Endpoint names | `GET /dashboard` · `GET /loads` (board, `?view=active\|needs-pod\|delivered\|all` optional) · `GET /loads/by-number/:loadNumber` · `GET /loads/:id` · `POST /loads` · `POST /loads/:id/documents` (multipart) · `GET /billing/uninvoiced-loads` · `GET /invoices?status=…` · `GET /invoice-batches` · `GET /payments` (or paid invoices via `/invoices?status=paid` with payment fields) · `GET /bills` · `GET /settlements?periodStart=YYYY-MM-DD` · `POST /settlements/approve` `{periodStart}` · `GET /drivers` · `GET /trucks` · `GET /trailers` · `GET /carriers` · `GET /customers` · `GET /facilities` · `GET /hr/contracts` · `GET /hr/onboarding` · `GET /work-orders` · `GET /driver-documents` · `GET /violations` · `GET /claims` · `GET /compliance-reminders` · `/planner/events` (GET range, POST, PATCH, DELETE) · `/planner/color-codes` (GET, POST, PATCH, DELETE) · `POST /planner/reset`. All paths are under `/api/v1`. |
| Planner tables | `planner_color_codes` and `planner_events`. |
| Driver qualification table | `driver_documents`. |
| Permissions | From the catalog: loads.view (includes load financials), drivers.view (includes pay), compliance.view (driver documents, violations, reminders), claims.view, maintenance.view, hr.view, billing.view (invoices, batches, payments, uninvoiced), payables.view (bills), settlements.view/.approve, planner.view/.manage/.configure/.reset, customers.view, carriers.view, locations.view (facilities), dashboard.view, documents.view/.upload. |

## 3. Conventions

**Data.**
- UUID primary keys.
- `organization_id` on every tenant row. Every tenant index leads with it.
- `created_at`/`updated_at` are `timestamptz`.
- Money is integer cents, with a `…Cents` suffix in DTOs.
- Business days are `date`, sent as `YYYY-MM-DD`.
- Instants are UTC ISO strings.
- Wall-clock times are `HH:MM`, with their timezone context: the facility timezone for stops, the org timezone for office events and activity.

**Human numbers.**
- Integer columns, unique per org: `load_number`, `invoice_number`, `batch_number`, `claim_number`.
- The web formats them: `L-`, `INV-`, `B-`, `CLM-`.
- The first new load after seeding is `L-40223`.

**Search.**
- The web filters the rows it holds with Runtruck1's `matchesQuery` semantics.
- To keep results identical, every list DTO row must contain the same searchable string/number fields Runtruck1's rows had, as **display-ready strings where Runtruck1 had strings** (e.g. `route`, `unit`).
- List endpoints also accept `q`/`limit`/`offset`.

**API.**
- Resource-oriented REST under `/api/v1`.
- Screen KPIs are computed server-side and returned in `meta.summary` of the list endpoint the screen already calls, or from a dedicated summary endpoint when a screen has no list.
- No N+1 queries: list endpoints join or batch.
- Every endpoint declares its permission.
- Every query filters by `ctx.organizationId`.
- Every write runs in a transaction that also writes `audit_logs` and emits the domain event.

**Contracts in code.**
- DTO types go in `packages/types/src/<domain>.ts`.
- Input Zod schemas go in `packages/validation/src/<domain>.ts`.
- Both files already exist, and their index files already re-export them.
- Edit only your own domain's files.

**Documents.**
- Object storage is S3-compatible: SeaweedFS in docker-compose (MinIO stopped publishing community images), bucket `runtruck-documents`.
- Metadata lives in `documents` + `document_versions`.
- Seeded "Attached" documents get metadata rows. The seed also writes a small placeholder object for each, so the metadata is never dangling.

**Seed.**
- `packages/database/src/seed/` inserts exactly Runtruck1's records (01 §4), using `organization_counters` so the next numbers continue.
- Demo users: Rosa Medina (Admin).
- Test fixtures (not the seed): a second org "Test Carrier Co" plus users with Dispatcher / Driver / Accounting roles.
