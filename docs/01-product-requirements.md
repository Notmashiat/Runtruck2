# 01 — Product Requirements

Rank 1 in the source-of-truth hierarchy (architecture §49). Where this document and a lower-ranked one conflict, this one wins. If it conflicts with a **security** requirement (rank 2), the conflict must be raised with the product owner. It must not be resolved silently.

## 1. Goal of the current release

Runtruck2 re-implements the **Runtruck1** prototype (https://github.com/Notmashiat/Runtruck1, `app/`, commit `46217c7`) on the production architecture in [02-development-architecture.md](02-development-architecture.md).

**Requirement R1 — Visual and behavioural parity.** The web app must look and behave like Runtruck1 in normal use: every route, screen, text, class name, layout, interaction, and dark mode. The per-area port specifications made from Runtruck1 are the detailed reference for what "the same" means. They were produced on 2026-09-29 and archived under `docs/reference/runtruck1/`.

**Requirement R2 — Production architecture underneath.** All business data lives in PostgreSQL and is served by the NestJS API. The API authenticates, authorizes, scopes to the tenant, validates, audits and emits events for everything, as the architecture requires. Runtruck1's in-browser data (mock constants, in-memory created loads, planner `localStorage`) is replaced by API calls.

## 2. Product decisions (approved by the product owner, 2026-09-29)

| # | Decision | Consequence |
|---|---|---|
| D1 | **Tooling:** Claude installs Node.js 24 LTS and pnpm. The owner installs Docker Desktop. PostgreSQL 17 and Redis 8 run from `infrastructure/docker/docker-compose.yml`. | Local development needs Docker running. |
| D2 | **Login page.** Runtruck1 has no authentication. Runtruck2 adds a sign-in screen at `/login` in Runtruck1's visual language. The marketing "Log in" link goes to it. After sign-in the app is identical to Runtruck1. | This is the only intentional new screen. Seeded demo account: Rosa Medina, Sunridge Freight (the password comes from `SEED_DEMO_PASSWORD` in `.env`). |
| D3 | **Full backend now.** Build the foundation, authentication, multi-tenancy and permissions, then real API + PostgreSQL behind **every** Runtruck1 screen. Everything is seeded with Runtruck1's data. | This covers phases 1–4 fully, and a Runtruck1-parity slice of phases 5–8 and 11–13 (§5). |
| D4 | **Demo clock.** "Today" is pinned to **2026-09-03** with `DEMO_TODAY`. The API computes business dates in the organization's time zone (`America/Los_Angeles`). With `DEMO_TODAY` set, "now" is the pinned date at the real time of day. `DEMO_TODAY` is rejected in production. | Every age, overdue flag, "this week" figure and calendar "today" matches Runtruck1. |
| D5 | **Numbers are computed strictly from records.** Every KPI, total, count, age and aggregate is derived by the API from stored rows. Nothing is a stored snapshot or a hardcoded figure. | Figures that Runtruck1 hardcoded, or that its records cannot produce, will **differ** from Runtruck1. Examples: AR aging, customer YTD revenue and load counts, driver pay YTD, dashboard week-over-week figures, the revenue chart. That difference is accepted. The seed contains exactly Runtruck1's records (§4). |
| D6 | **Reproduce every quirk.** Runtruck1's visible behaviour is reproduced bug-for-bug in the UI. That includes wording (e.g. "1 loads"), the fallback to the first load for an unknown load number, no confirmation before deleting a planner event, the stub buttons that do nothing, and the demo data's oddities (e.g. invoices dated before delivery). | The server still enforces authentication, tenancy, permissions and validation. A quirk is never reproduced by weakening a server-side check. Where a quirk and a security requirement collide, raise it (§6). |
| D7 | **Demo loads are real records, rendered by one set of rules.** Runtruck1 synthesises content for its 8 board loads: a fuel stop, "Today" activity rows, and document states inferred from status. These are seeded as real `load_stops`, activity/audit rows and `documents` rows, and every load renders through the same code path. | The single accepted visual difference: on those 8 loads' detail pages a stop's time line reads `Sep 3 · 08:00–14:00`, not Runtruck1's `Pickup Sep 3 · 08:00–14:00` (and likewise `Deliver …`). |
| D8 | **Planner is a shared organization calendar.** Events and color codes are organization data in PostgreSQL. Changes require permissions and are audited. View preferences (view, week start, density, hidden codes, color-by, card lines…) stay in the browser, as in Runtruck1. **"Reset calendar"** still restores the default events and color codes for the whole organization. It is allowed only with `planner.reset` (Owner/Admin), and it is audited. | The Reset button stays. Users without the permission get a refusal from the API. |

## 3. Runtruck1 facts the port preserves

- **Routes:** `/`, `/app` → `/app/dashboard`, `/app/{dashboard,loads,loads/:loadNumber,planner,crm,facilities}`, `/app/fleet/{drivers,trucks,trailers}`, `/app/accounting/{uninvoiced,invoiced,batches,past-due,paid,payroll,bills}`, `/app/hr/{employee-contracts,onboarding}`, `/app/safety/{maintenance,driver-documents,violations,settlements}`. Section roots redirect to their first tab. The six legacy redirects apply, route matching is case-insensitive, and any unknown path goes to `/`.
- **Load URLs use the load number** (`/app/loads/L-40218`). The API resolves it within the session's organization. UUIDs remain the database keys (architecture §8).
- **New load numbers continue the sequence:** the first load created after seeding is `L-40223`. Numbers are allocated server-side per organization.
- **The top-bar search** filters the table on screen live. This matches client-side, as in Runtruck1: case-insensitive substring over the row's fields. List endpoints also support server-side `q`, `limit` and `offset` (architecture §37). The web app requests at most one bounded page (≤ 500 rows) per list.
- **Theme** stays a per-device preference in `localStorage['runtruck-theme']`, applied before first paint.
- **Stub controls stay inert.** Filters, "+ Add Driver", "Message driver", "Update status" and the rest do nothing, exactly as in Runtruck1. They are tracked as *not implemented* in §7, never as done (architecture §43).

## 4. Seed data

`pnpm db:seed` creates one organization, **Sunridge Freight** (company number 30017, timezone `America/Los_Angeles`, MC 812044, DOT 2291176). It contains every record in Runtruck1's `app/src/data/*.ts`, mapped to normalized rows per [03-database.md](03-database.md):

- the 8 board loads
- the 11 uninvoiced loads (`accounting.ts UNINVOICED`) and every load referenced by an invoice, stored as **archived** loads (delivered and removed from the dispatch board, so the Loads board shows Runtruck1's 8 loads)
- customers, carriers, facilities, drivers, trucks, trailers
- invoices, payments, batches, bills, settlements
- contracts and onboarding
- work orders, driver documents, violations, claims
- planner events and color codes
- the user **Rosa Medina** (member 100482731, title "Dispatch", role **Admin**)

A second organization and extra users exist **only in test fixtures**, to prove tenant isolation and permission denials. The seed refuses to run when `NODE_ENV=production`. `pnpm db:reset` rebuilds the demo, so end-to-end tests and demos are repeatable.

## 5. Scope

**In this release (parity slice):**
- auth: login, logout, sessions
- organizations and membership
- roles and permissions
- dashboard
- loads: list, detail, create with stops, rates, carrier or own-fleet assignment, and documents stored in object storage
- planner: events, color codes, derived load-stop events, reset
- fleet: drivers, trucks, trailers
- CRM customers
- facilities (a "coming soon" page, as in Runtruck1)
- accounting: uninvoiced, invoiced, batches, past due, paid, payroll with settlement approval, bills
- HR: contracts and onboarding
- safety: maintenance, driver documents, violations and claims (read views)
- audit log and domain events with a BullMQ worker
- CI

**Explicitly not in this release:**
- password/account recovery (needs an email provider, Phase 2 follow-up)
- the mobile driver app (Phase 9)
- tracking/ELD and every external integration (Phases 10, 14)
- AI (Phase 15)
- every Runtruck1 stub button's real behaviour
- production deployment/terraform (Phase 16)

## 6. Open conflicts to raise with the product owner

Record new conflicts here instead of choosing silently (architecture §49).

| # | Conflict | Status |
|---|---|---|
| C1 | D5 (strict) versus D6 (reproduce quirks). Some Runtruck1 screens dereference the first row of a list unguarded (e.g. Uninvoiced, Past Due). Parity code would crash if strict data made such a list empty. The seed keeps those lists non-empty, so the case cannot arise with demo data. | Accepted as-is. Revisit when real tenants onboard. |
| C2 | Local object storage. MinIO stopped publishing community Docker images, and `minio/minio` / `minio/mc` no longer pull. Local development and CI use **SeaweedFS 4.48** (Apache-2.0, S3-compatible) instead, with the AWS CLI image creating the buckets. The application only speaks the standard S3 API, so production can use any S3 provider (architecture §25: replaceable providers). | Decided 2026-09-29 (infrastructure only; no stack change). |

## 7. Not implemented (tracked, never reported as done)

These are the stub controls carried over from Runtruck1: Filters (every table screen), "+ Add Driver", "+ Add Unit", "Log service", "+ Add Trailer", "+ Add Customer", "Export batch", "+ New Batch" (on Batches), "Send reminders", "Export", "+ Add Bill", "+ New Contract", "+ Start Onboarding", "+ Log Service", "Request document", "+ Log Violation", "+ New Claim", "Message driver" and "Update status". "Invoice N loads" and "+ New Batch" on Invoiced only navigate, exactly as in Runtruck1.
