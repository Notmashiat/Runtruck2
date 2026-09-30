# 06 — Multi-Tenancy

Runtruck is a multi-tenant SaaS, and the tenant is the **organization** (architecture §2 Rule 3, §10). Company A must never read or change Company B's data. This rule is enforced on the server and is never delegated to the web app.

This document describes the code as of 2026-09-29 and the rules every domain module must follow.

## 1. Data model

| Table                                                     | Tenancy                                                                                                                                                                               |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `organizations`                                           | The tenant. It holds `name`, `short_name`, `company_number` (a display number, globally unique), `timezone` (IANA), `mc_number` and `dot_number`.                                     |
| `users`                                                   | **Global** identities. The email is unique case-insensitively (`users_email_lower_uq`). A user has no `organization_id`.                                                              |
| `organization_members`                                    | Links a user to an organization, unique per `(organization_id, user_id)`. It carries `member_number` (globally unique), `title` (display only) and `status` (`active` / `suspended`). |
| `roles`, `user_roles`                                     | Per organization. `roles` is unique per `(organization_id, key)`. `user_roles` is unique per `(organization_id, user_id, role_id)`.                                                   |
| `permissions`, `role_permissions`                         | `permissions` is the **global** catalog of keys. `role_permissions` links a role to catalog entries.                                                                                  |
| `sessions`                                                | Bound to one `(user_id, organization_id)`.                                                                                                                                            |
| `organization_counters`, `audit_logs`, `events`           | Tenant rows. Their primary key or indexes lead with `organization_id`.                                                                                                                |
| Every domain table (loads, customers, invoices, planner…) | Must carry `organization_id uuid NOT NULL` through the `organizationId()` helper exported from `platform.ts`. It references `organizations(id)` with `ON DELETE RESTRICT`.            |

**Index rule.** Every tenant index leads with `organization_id` (design brief §3). The platform tables follow it:

- `organization_members_org_user_uq`
- `roles_org_key_uq`
- `user_roles_org_user_role_uq`
- the `organization_counters` primary key `(organization_id, key)`
- `audit_logs_org_entity_idx`, `audit_logs_org_occurred_idx`
- `events_org_aggregate_idx`

Human-facing numbers are unique **per organization**, not globally: `load_number`, `invoice_number`, `batch_number`, `claim_number`. The next value comes from `organization_counters` with `UPDATE … RETURNING` inside the transaction that creates the row.

## 2. How the tenant is determined

1. At sign-in the API binds the new session to one membership, the user's oldest active one ([05](05-authentication.md) §4).
2. On every request `SessionGuard` resolves the cookie to `AuthContext.organizationId`. That only succeeds when the session is live, the user is active **and the membership is still active**.
3. Permissions are resolved for that organization only. The query joins `roles` on `roles.organization_id = ctx.organizationId` **and** filters `user_roles.organization_id = ctx.organizationId`, so a role row from another tenant can never grant anything.
4. **No endpoint accepts an organization id** in a body, query or path parameter (architecture Rule 4, [04-api.md](04-api.md) §4). The only source is `ctx.organizationId`.

## 3. Enforcement rules for services and repositories

These rules are mandatory for every domain module (architecture §12 "Correct organization?"). The permission guard does not check tenancy. It is enforced **in each query**.

1. **Take the context.** Service and repository functions take `ctx: AuthContext`, or `ctx.organizationId`, as a parameter. They never read an organization id from DTOs.
2. **Filter every read.** Every `SELECT` on a tenant table has `eq(table.organizationId, ctx.organizationId)` in its `WHERE`. In a join, every tenant table is constrained, either directly or through a join condition on `organization_id`.
3. **Stamp every insert.** Inserts set `organizationId: ctx.organizationId` from the context, never from input.
4. **Scope every update and delete.** Updates and deletes include the organization predicate in the `WHERE`. When zero rows are affected, the response is **404** (the entity's `<ENTITY>_NOT_FOUND` code).
5. **Foreign ids are "not found".** An id that belongs to another organization gets exactly the same response as an id that does not exist: **404**, same code, same message. The API never reveals that the row exists elsewhere ([04-api.md](04-api.md) §3).
6. **Check referenced ids.** When input references other rows (for example a load's `customerId`, `driverId`, `carrierId` or `facilityId`), the service looks each one up **with the organization filter** before using it. An id from another tenant is rejected as not found. A plain foreign key alone would accept it. Whether [03-database.md](03-database.md) also adds composite `(organization_id, id)` foreign keys is decided there.
7. **Scope natural keys.** Lookups by human numbers (`GET /loads/by-number/:loadNumber`) are scoped by organization, because the numbers are only unique within one.
8. **Aggregates too.** KPI sums and counts (docs/01 D5) are computed with the same organization filter.
9. **Quirks stay in the web.** Runtruck1 quirks are reproduced in the web app, never by weakening a server check (docs/01 D6). Example: for an unknown load number the API returns 404 `LOAD_NOT_FOUND`, and the **web** falls back to the first load as Runtruck1 did.
10. **Audit and events carry the tenant.** `AuditService.record` and `EventsService.emit` take `organizationId` from the context and write it on every `audit_logs` and `events` row.

The Drizzle client (`packages/database/src/client.ts`) is a plain connection pool, so a query without the predicate _would_ run. Nothing in the database stops a missing filter today, which makes rules 2–6 and the tests in §4 the controls.

## 4. Verifying isolation (tests)

The test fixtures, not the demo seed, create a **second organization, "Test Carrier Co"**, plus users holding the Dispatcher, Driver and Accounting roles (design brief §3, docs/01 §4). Every domain endpoint's integration tests ([20-testing.md](20-testing.md)) must show:

| Case                                                                           | Expectation                                                                                             |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| A list called as a Test Carrier Co member                                      | Contains none of Sunridge Freight's rows. `meta.total` and `meta.summary` count only the caller's rows. |
| A read by id / number with the other organization's id                         | `404` with the entity's not-found code, identical to a random UUID.                                     |
| An update or delete with the other organization's id                           | `404`, and the other organization's row is unchanged.                                                   |
| A create that references another organization's customer, driver or carrier id | Rejected (`404` or `400` per the endpoint doc). Nothing is written.                                     |
| An `organizationId` field in a body or query                                   | Ignored or rejected by the Zod schema. It never changes which tenant is used.                           |
| Audit and outbox rows written by a request                                     | Carry the caller's `organization_id`.                                                                   |

**Status:** the integration test harness exists (`apps/api/test/`: `global-setup.ts` rebuilds the test database from the migrations; `helpers.ts` seeds the fixtures with `seedTestFixtures` and signs in fixture users). `seed.int.test.ts` proves that Test Carrier Co has at least one row in every tenant-owned table, that its rows stay separate and that the composite tenant keys refuse a cross-tenant reference; `auth.int.test.ts` covers sessions and the guards. The per-endpoint isolation cases of the table above are written with each domain module, as its endpoints land.

## 5. What is not built

| Item                                                                                                                                                         | Phase          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------- |
| Organization settings (profile editing, timezone change). `organization.view` / `organization.manage` exist in the catalog with no endpoint.                 | 3 (follow-up)  |
| Switching organization inside one session (users with several memberships)                                                                                   | 3 (follow-up)  |
| Creating organizations and onboarding tenants. Organizations come only from the seed and test fixtures.                                                      | 3 (follow-up)  |
| Database-level defence in depth (PostgreSQL row-level security keyed on a per-transaction setting). Not planned in the architecture. Candidate for Phase 16. | 16 (candidate) |
