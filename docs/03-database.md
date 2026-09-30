# 03 — Database Specification

Rank 3 in the source-of-truth hierarchy (architecture §49): below the product requirements ([01](01-product-requirements.md)) and security, above the architecture rules, the API specification ([04](04-api.md), `docs/api/*.md`) and the domain specifications. The code in `packages/database/src/schema/` (one file per domain) and the migrations in `packages/database/drizzle/` implement this document **name for name**. A schema change is made here first, then in code, then as a generated migration (§9).

Inputs: the product decisions D1–D8 ([01 §2](01-product-requirements.md)), the binding [design brief](reference/design-brief.md), and the Runtruck1 port specs in [reference/runtruck1/](reference/runtruck1/) (mainly [data-model.md](reference/runtruck1/data-model.md), which this document supersedes wherever they differ).

Contents: §1 conventions · §2 platform tables · §3 entity-relationship overview · §4 enum catalogue · §5 domain tables · §6 derived values (rules the API computes) · §7 seed mapping · §8 where computed values differ from Runtruck1 (D5) · §9 migrations and database-level rules.

---

## 1. Conventions

### 1.1 Naming

- Tables: plural `snake_case` (`load_stops`). Columns: `snake_case`. Enum types: singular `snake_case` (`load_status`); enum values `lower_snake_case`.
- Drizzle keys are camelCase and mapped by `casing: 'snake_case'` (`loadNumber` ↔ `load_number`). Exported table constants are the camelCase table name (`loadStops`), enum constants the camelCase enum name (`loadStatus`).
- Constraint and index names: `<table>_<what>_uq` (unique), `_idx` (index), `_ck` (check), `_fk` (foreign key), `<table>_org_id_uq` (tenant key, §1.3). Single-column foreign keys declared with Drizzle `.references()` (to `organizations` and `users`, and every platform FK) keep Drizzle's generated name `<table>_<column>_<target>_id_fk`, e.g. `loads_created_by_user_id_users_id_fk`, `loads_organization_id_organizations_id_fk`.
- Suffixes: `_cents` money in integer cents, `_bp` basis points, `_on` business date (`date`), `_at` instant (`timestamptz`), `_miles`/`_lb`/`_in`/`_ft` units, `_id` reference.

### 1.2 Standard columns

Every domain table (§5) and the platform tables marked "standard columns" in §2 start with the **standard columns**; the tables list them as one row:

| column | type | null | default | notes |
|---|---|---|---|---|
| `id` | `uuid` | not null | `gen_random_uuid()` | primary key (architecture §8) |
| `organization_id` | `uuid` | not null | — | FK → `organizations(id)` ON DELETE RESTRICT (`organizationId()` in `platform.ts`) |
| `created_at` | `timestamptz` | not null | `now()` | |
| `updated_at` | `timestamptz` | not null | `now()` | bumped by Drizzle `$onUpdate` on every ORM update |

Exceptions:
- The append-only domain tables `load_activity` and `document_versions` have `created_at` but no `updated_at`.
- The platform tables `audit_logs` and `events` have neither; they carry `occurred_at` (§2.10, §2.11).
- `organization_counters` has no `id` (its key is `(organization_id, key)`), and `role_permissions` has only its two key columns (§2.7, §2.9).

### 1.3 Tenancy (architecture Rule 3)

- `organization_id` is on every tenant row, including child rows (stops, items, versions), so every query can filter by the session's organization without a join.
- **Tenant key.** Every domain table (§5) has `UNIQUE (organization_id, id)` named `<table>_org_id_uq` (a unique constraint, created by `tenantKey()` in `_tenant.ts`).
- **Tenant-safe foreign keys.** Every reference from one tenant table to another is a **composite** foreign key `(organization_id, <x>_id) → <x>(organization_id, id)`. A row therefore cannot point at another organization's row even if application code is wrong. Nullable reference columns use the default `MATCH SIMPLE`, so a null `<x>_id` skips the check. References to the global `users` table are single-column.
- **Tenant indexes lead with `organization_id`.** In the domain tables the only index that does not is `document_versions_storage_key_uq`, because object keys are unique across the whole bucket (the key itself begins with the organization id). Child tables have no separate `(organization_id, parent_id)` index: their `(organization_id, parent_id, sequence|position)` unique index serves parent lookups (migration `0002`, §9.1).
- Platform tables (§2) predate this rule and use single-column foreign keys; they are not redesigned (design brief §1).

### 1.4 Deletion

- Business rows are not hard-deleted by normal actions: loads are archived (`archived_at`), invoices, bills, settlements, claims and contracts change status.
- In the domain tables `ON DELETE CASCADE` is used only from a parent to rows it owns (stops, dispatches, activity and documents of a load; versions of a document; items of an invoice, batch or settlement; a customer's contacts; a driver's mileage entries, qualification documents and reminders; an onboarding case's document requests). Every other domain reference, and every reference to `organizations` or `users` from a domain table, is `ON DELETE RESTRICT`. The platform cascades are listed in §2 (`sessions`, `user_roles`, `role_permissions`).
- Hard deletes that do exist are user actions on the shared calendar (D8): deleting a planner event, deleting a color code after its events were reassigned (§5.12), and **Reset calendar**. Each is audited.

### 1.5 Time

- **Instants** (`_at`) are `timestamptz`, stored in UTC (architecture §9), sent as ISO-8601 UTC strings.
- **Business dates** (`_on`, `appointment_date`, `start_date`, `period_start`…) are `date`, read by Drizzle as `YYYY-MM-DD` strings (`mode: 'string'`), never converted through `Date`.
- **Wall-clock times** are `time` (`HH:MM:SS`, sent as `HH:MM`) and always have a stated timezone context:
  - `load_stops.window_open/window_close/planned_start/planned_end` → `load_stops.timezone` (the facility's IANA zone);
  - `planner_events.start_time/end_time` → `organizations.timezone` (office events, D8).
- **"Today"** is the organization-local business date from `ClockService.today(organizations.timezone)`, pinned to 2026-09-03 by `DEMO_TODAY` (D4). "Now" is the pinned date at the real time of day. The **organization week** is Monday–Sunday (Runtruck1's Onboarding "this week" and the planner's default week start).

### 1.6 Money and quantities

- Money is `integer` cents per row (`_cents`), always ≥ 0 except signed settlement items (§5.10). Aggregates are computed in SQL (`sum(integer)` returns `bigint`); the API returns them as JSON numbers of cents.
- Rates: per-mile, hourly and salary pay are cents (`pay_rate_cents`: 62 = $0.62/mi, 3450 = $34.50/hr, 6800000 = $68,000/yr); percentages are basis points (`pay_percent_bp`: 2500 = 25%).
- Temperatures are `numeric(4,1)` °F (Drizzle returns a string; the API converts with `Number()` so `-10.0` renders `-10 °F`).

### 1.7 Enums and statuses

- Lifecycle statuses are **stored** Postgres enums because they are facts on Runtruck1's records (design brief §2). Each value maps 1:1 to one Runtruck1 label (§4). Chip tone and label are web presentation; `tagClass` is never stored.
- Adding a value is a migration (`ALTER TYPE … ADD VALUE`); renaming or removing one is a breaking change.

### 1.8 No stored aggregates (D5)

Nothing in the database is a snapshot of a count, sum, average, age, total, KPI, chart value or "this week" figure. In particular there is **no** `metric_snapshots` table, no invoice or batch total column, no settlement gross/net column, no customer YTD column and no driver pay-YTD column. Where Runtruck1 shows a figure that no record could produce, a **minimal stored fact** was added instead (listed in §6.0.2) and seeded so that the computed figure reproduces Runtruck1's wherever it can be back-solved.

### 1.9 Human numbers

- `loads.load_number`, `invoices.invoice_number`, `invoice_batches.batch_number`, `claims.claim_number` are `integer`, unique per organization, rendered by the web as `L-`, `INV-`, `B-`, `CLM-`.
- They are allocated from `organization_counters` (§2.9), keys `load`, `invoice`, `invoice_batch`, `claim`, inside the creating transaction:
  `UPDATE organization_counters SET next_value = next_value + 1, updated_at = now() WHERE organization_id = $1 AND key = $2 RETURNING next_value - 1 AS allocated;`
  The row lock serialises concurrent creates; the unique index is the backstop.
- `organizations.company_number` and `organization_members.member_number` are display numbers stored as `text` (platform, unchanged).

### 1.10 Ordering

Every list has an explicit `ORDER BY` with a unique tie-breaker (SQL sorts are not stable). Lists whose Runtruck1 order is hand-authored carry a `position integer` (1-based, seeded in Runtruck1 order; new rows get `max(position) + 1`). The loads board orders by `created_at DESC, load_number DESC`. The order of every list is given with its rule in §6.

### 1.11 Search

There are no search columns. The web filters the rows it holds with Runtruck1's `matchesQuery` over **view-model rows**: objects with exactly Runtruck1's row keys and display strings. Server-side `q` (architecture §37) is evaluated by the API over **the same view-model rows, built by the same shared builders in `@runtruck/calculations`** (label maps, formatters, row builders such as `formatPayBasis`), so both paths match identically. A DTO may therefore carry a display-ready string (`route`, `unit`, `sentTo`, `categoryLabel`) or the structured facts the builder formats (fleet, HR and safety rows: `currentLoad`, `location`, `make`/`model`/`modelYear`, `payBasis` + rate, `shop`); either way the string compared is the builder's. This departs from the design brief §3 wording ("display-ready strings where Runtruck1 had strings") for the structured rows; recorded in 01 §6. The builders must exist in `@runtruck/calculations` before those endpoints ship, and a server-composed label (`SettlementRow.payBasisLabel`) is produced by the same function the web uses (`formatPayBasis`). The API's in-memory matching is capped (04 §5.1).

---

## 2. Platform tables (`platform.ts`)

These tables exist and are only ever extended (design brief §1). `organizations`, `users` and `permissions` are global; the others are tenant tables.

### 2.1 `organizations` (global)

The tenant.

| column | type | null | default | notes |
|---|---|---|---|---|
| `id` | `uuid` | not null | `gen_random_uuid()` | PK |
| `name` | `text` | not null | | "Sunridge Freight" |
| `short_name` | `text` | not null | | "Sunridge" (UI copy: "Haul it with the Sunridge fleet") |
| `company_number` | `text` | not null | | "30017" (Settings › Profile "Company ID") |
| `timezone` | `text` | not null | | IANA zone; business "today" and office events |
| `mc_number` | `text` | null | | "812044"; the own authority (also on the own-fleet `carriers` row) |
| `dot_number` | `text` | null | | "2291176" |
| `planner_defaults` | `planner_default_set` | not null | `'standard'` | which default calendar **Reset calendar** restores (§5.12.2): `standard` = the six color codes of §7.24 and no events; `runtruck1_demo` = those codes and the demo events of §7.25. Only the demo seed sets `runtruck1_demo` (Sunridge Freight); tenant-specific demo content is never written into another organization. Migration `0003`. |
| `created_at`, `updated_at` | `timestamptz` | not null | `now()` | |

Unique: `organizations_company_number_uq (company_number)`.

`mc_number` and `dot_number` hold **digits only**; the web renders "MC " / "DOT " + digits, as for `carriers` (§5.2.1).

### 2.2 `users` (global)

| column | type | null | default | notes |
|---|---|---|---|---|
| `id` | `uuid` | not null | `gen_random_uuid()` | PK |
| `email` | `text` | not null | | unique case-insensitively |
| `full_name` | `text` | not null | | "Rosa Medina" |
| `password_hash` | `text` | not null | | scrypt, format `scrypt$N$r$p$salt$hash` ([05-authentication.md](05-authentication.md)) |
| `status` | `user_status` | not null | `'active'` | |
| `last_login_at` | `timestamptz` | null | | |
| `created_at`, `updated_at` | `timestamptz` | not null | `now()` | |

Unique: `users_email_lower_uq (lower(email))`.

### 2.3 `organization_members`

A user's membership of an organization.

| column | type | null | default | notes |
|---|---|---|---|---|
| standard columns (§1.2) | | | | |
| `user_id` | `uuid` | not null | | FK → `users(id)` ON DELETE RESTRICT |
| `member_number` | `text` | not null | | "100482731" (Settings › Profile "Member ID") |
| `title` | `text` | not null | | "Dispatch" — display only, never used for authorization |
| `status` | `member_status` | not null | `'active'` | |

Unique: `organization_members_org_user_uq (organization_id, user_id)`, `organization_members_member_number_uq (member_number)`. Index: `organization_members_user_idx (user_id)` (session lookup across organizations).

### 2.4 `sessions`

Server-side sessions; only the SHA-256 hash of the opaque cookie token is stored.

| column | type | null | default | notes |
|---|---|---|---|---|
| standard columns (§1.2) | | | | |
| `token_hash` | `text` | not null | | |
| `user_id` | `uuid` | not null | | FK → `users(id)` ON DELETE CASCADE |
| `expires_at` | `timestamptz` | not null | | |
| `last_seen_at` | `timestamptz` | not null | `now()` | |
| `revoked_at` | `timestamptz` | null | | |
| `ip_address`, `user_agent` | `text` | null | | |

Unique: `sessions_token_hash_uq (token_hash)`. Index: `sessions_user_idx (user_id)`.

### 2.5 `permissions` (global)

The permission catalog, seeded from `@runtruck/permissions` `PERMISSIONS`.

| column | type | null | default |
|---|---|---|---|
| `id` | `uuid` | not null | `gen_random_uuid()` (PK) |
| `key` | `text` | not null | |
| `description` | `text` | not null | |
| `created_at`, `updated_at` | `timestamptz` | not null | `now()` |

Unique: `permissions_key_uq (key)`.

### 2.6 `roles`

Per-organization roles, seeded from `@runtruck/permissions` `roles.ts`.

| column | type | null | default |
|---|---|---|---|
| standard columns (§1.2) | | | |
| `key` | `text` | not null | |
| `name` | `text` | not null | |
| `description` | `text` | not null | `''` |

Unique: `roles_org_key_uq (organization_id, key)`.

### 2.7 `role_permissions`

| column | type | null | notes |
|---|---|---|---|
| `role_id` | `uuid` | not null | FK → `roles(id)` ON DELETE CASCADE |
| `permission_id` | `uuid` | not null | FK → `permissions(id)` ON DELETE CASCADE |

PK: `role_permissions_role_id_permission_id_pk (role_id, permission_id)`. No `organization_id`: the role row carries the tenant.

### 2.8 `user_roles`

| column | type | null | default | notes |
|---|---|---|---|---|
| standard columns (§1.2) | | | | |
| `user_id` | `uuid` | not null | | FK → `users(id)` ON DELETE CASCADE |
| `role_id` | `uuid` | not null | | FK → `roles(id)` ON DELETE CASCADE |

Unique: `user_roles_org_user_role_uq (organization_id, user_id, role_id)`. Index: `user_roles_user_idx (user_id)`.

### 2.9 `organization_counters`

Per-organization sequences for human numbers (§1.9).

| column | type | null | default | notes |
|---|---|---|---|---|
| `organization_id` | `uuid` | not null | | FK → `organizations(id)` ON DELETE RESTRICT |
| `key` | `text` | not null | | `load` · `invoice` · `invoice_batch` · `claim` |
| `next_value` | `bigint` | not null | | the next number to hand out |
| `created_at`, `updated_at` | `timestamptz` | not null | `now()` | |

PK: `organization_counters_organization_id_key_pk (organization_id, key)`.

### 2.10 `audit_logs` (append-only)

Architecture §30. Written by `AuditService.record` in the same transaction as every write. A trigger rejects `UPDATE` and `DELETE` by the application role; what it does not cover is in §9.2.

| column | type | null | default | notes |
|---|---|---|---|---|
| `id` | `uuid` | not null | `gen_random_uuid()` | PK |
| `organization_id` | `uuid` | not null | | FK → `organizations(id)` ON DELETE RESTRICT |
| `actor_user_id` | `uuid` | null | | FK → `users(id)` ON DELETE RESTRICT; null for system actions (seed, workers) |
| `action` | `text` | not null | | e.g. `LOAD_CREATED`, `SETTLEMENT_APPROVED` (one row per settlement), `PLANNER_RESET` |
| `entity_type` | `text` | not null | | |
| `entity_id` | `uuid` | not null | | |
| `entity_label` | `text` | null | | human label at the time, e.g. "L-40223" |
| `previous`, `next` | `jsonb` | null | | before / after |
| `request_id` | `text` | null | | |
| `occurred_at` | `timestamptz` | not null | `now()` | |

Indexes: `audit_logs_org_entity_idx (organization_id, entity_type, entity_id, occurred_at)`, `audit_logs_org_occurred_idx (organization_id, occurred_at)`.

### 2.11 `events` (outbox)

Architecture §23. Written in the business transaction; a worker publishes to BullMQ.

| column | type | null | default | notes |
|---|---|---|---|---|
| `id` | `uuid` | not null | `gen_random_uuid()` | PK |
| `organization_id` | `uuid` | not null | | FK → `organizations(id)` ON DELETE RESTRICT |
| `type` | `text` | not null | | `LoadCreated`, `SettlementApproved`, … |
| `aggregate_type` | `text` | not null | | |
| `aggregate_id` | `uuid` | not null | | |
| `payload` | `jsonb` | not null | | |
| `actor_user_id` | `uuid` | null | | FK → `users(id)` ON DELETE RESTRICT |
| `request_id` | `text` | null | | |
| `occurred_at` | `timestamptz` | not null | `now()` | |
| `published_at` | `timestamptz` | null | | |
| `publish_attempts` | `bigint` | not null | `0` | |
| `last_error` | `text` | null | | |

Indexes: `events_unpublished_idx (occurred_at) WHERE published_at IS NULL`, `events_org_aggregate_idx (organization_id, aggregate_type, aggregate_id)`.

---

## 3. Entity-relationship overview

46 tables: 11 platform + 35 domain. Arrows point from the referencing table to the referenced one; every arrow between tenant tables is a composite `(organization_id, …)` key (§1.3).

```
organizations ◄── every tenant table (organization_id)
users ◄── organization_members, sessions, user_roles, employees.user_id, loads.created_by_user_id,
          dispatches.assigned_by_user_id, load_activity.actor_user_id, document_versions.uploaded_by_user_id,
          settlements.approved_by_user_id, planner_events.created_by_user_id, audit_logs, events
roles ◄── role_permissions ──► permissions ;  roles ◄── user_roles

customers ◄── customer_contacts
customers ◄── loads.customer_id / bill_to_customer_id, invoices, invoice_batches, claims.claimant_customer_id
carriers  ◄── loads.carrier_id
facilities ◄── load_stops, trailers.location_facility_id, work_orders.shop_facility_id, claims.claimant_facility_id

employees ◄── employee_contracts, onboarding_cases (employee_id, owner_employee_id), drivers
onboarding_cases ◄── onboarding_document_requests
drivers ◄── driver_mileage_entries, trucks.assigned_driver_id, dispatches, settlements,
            driver_documents, compliance_reminders, violations, claims
trucks  ◄── dispatches, work_orders, violations, claims
trailers ◄── dispatches, work_orders, claims

loads ◄── load_stops, dispatches, load_activity, documents ◄── document_versions
loads ◄── invoice_items, settlement_items, claims, planner_events
invoices ◄── invoice_items, payments, invoice_batch_items ──► invoice_batches
factoring_companies ◄── payments, invoice_batches
vendors ◄── bills
settlements ◄── settlement_items
planner_color_codes ◄── planner_events
```

| Domain (file) | Tables |
|---|---|
| Platform (`platform.ts`) | organizations, users, organization_members, sessions, permissions, roles, role_permissions, user_roles, organization_counters, audit_logs, events |
| Customers (`customers.ts`) | customers, customer_contacts |
| Carriers (`carriers.ts`) | carriers |
| Facilities (`facilities.ts`) | facilities |
| HR (`hr.ts`) | employees, employee_contracts, onboarding_cases, onboarding_document_requests |
| Fleet (`fleet.ts`) | drivers, driver_mileage_entries, trucks, trailers |
| Loads (`loads.ts`) | loads, load_stops, dispatches, load_activity |
| Documents (`documents.ts`) | documents, document_versions |
| Billing (`billing.ts`) | factoring_companies, invoices, invoice_items, payments, invoice_batches, invoice_batch_items |
| Payables (`payables.ts`) | vendors, bills |
| Settlements (`settlements.ts`) | settlements, settlement_items |
| Safety (`safety.ts`) | work_orders, driver_documents, compliance_reminders, violations, claims |
| Planner (`planner.ts`) | planner_color_codes, planner_events |

Architecture §7 also names `appointments`, `notifications`, `messages`, `integrations`, `integration_accounts` and `background_jobs`. They are not created in this release: the appointment window is 1:1 with a stop and lives on `load_stops`; the others belong to phases outside the parity slice (01 §5).

---

## 4. Enum catalogue

Tones (informative; the web owns them): **B** blue `ui-chip-blue`, **G** gray, **A** amber, **Gr** green.

### 4.1 Platform

| enum | values |
|---|---|
| `user_status` | `active`, `disabled` |
| `member_status` | `active`, `suspended` |
| `planner_default_set` | `standard`, `runtruck1_demo` (`organizations.planner_defaults`, §2.1) |

### 4.2 Parties and places

| enum | value → Runtruck1 label |
|---|---|
| `customer_standing` | `key_account` → "Key account" (B) · `growing` → "Growing" (G) · `at_risk` → "At risk" (A) |
| `payment_terms` | `net_15` → "Net 15" · `net_30` → "Net 30" · `net_45` → "Net 45" · `net_60` → "Net 60" · `quick_pay` → "Quick pay". Net days: 15/30/45/60/0 |
| `facility_kind` | `shipper`, `consignee`, `crossdock`, `port`, `yard`, `shop` (no Runtruck1 label; not displayed) |

### 4.3 Workforce and fleet

| enum | value → Runtruck1 label |
|---|---|
| `employee_status` | `active`, `onboarding` (not displayed) |
| `employee_role` | `company_driver` → "Company driver" · `owner_operator` → "Owner-operator" · `dispatcher` → "Dispatcher" · `mechanic` → "Mechanic" |
| `contract_type` | `w2` → "W-2" · `form_1099` → "1099" · `lease_purchase` → "Lease-purchase" |
| `contract_status` | `active` → "Active" (Gr) · `renewal_due` → "Renewal due" (A) · `expiring` → "Expiring" (A) · `draft` → "Draft" (G) |
| `pay_basis` | `per_mile` → "$0.62 / mi" · `percent_of_line_haul` → "25% of line haul" · `annual_salary` → "$68,000 / yr" · `hourly` → "$34.50 / hr" (format rules in §6.0.6) |
| `onboarding_stage` | `application` → "Application" (G) · `background_check` → "Background check" (A) · `road_test` → "Road test" (B) · `orientation` → "Orientation" (B) · `complete` → "Complete" (Gr) |
| `onboarding_request_status` | `pending`, `received` (drives "Awaiting documents") |
| `driver_duty_status` | `on_duty` → "On duty" (B) · `available` → "Available" (G) · `home_time` → "Home time" (G) |
| `truck_status` | `in_service` → "In service" (B) · `service_due` → "Service due" (A) · `in_shop` → "In shop" (A) |
| `trailer_type` | `reefer` → "Reefer" · `dry_van` → "Dry van" · `flatbed` → "Flatbed" |
| `trailer_status` | `loaded` → "Loaded" (B) · `empty` → "Empty" (G) · `inspection` → "Inspection" (A) |
| `trailer_location_kind` | `yard` → "Yard · {facility city}" · `en_route` → "En route · {route}" · `city` → "{city}, {state}" |

### 4.4 Loads and documents

| enum | value → Runtruck1 label |
|---|---|
| `load_status` | `needs_driver` → "Needs driver" (A) · `dispatched` → "Dispatched" (G) · `at_pickup` → "At pickup" (G) · `in_transit` → "In transit" (B) · `delayed` → "Delayed" (A) · `needs_pod` → "Needs POD" (A) · `delivered` → "Delivered" (G). Architecture §17 states: `needs_driver`≙BOOKED, `dispatched`≙DISPATCHED, `at_pickup`≙AT_PICKUP, `in_transit`≙LOADED/IN_TRANSIT/AT_DELIVERY, `delayed` = an in-progress load running late (no §17 state), `needs_pod`≙DELIVERED, `delivered`≙POD_RECEIVED. INVOICED/PAID are billing facts (§5.8), not load statuses. Transitions: [08-load-lifecycle.md](08-load-lifecycle.md). |
| `load_mode` | `ftl` → "Full truckload" (choice "FTL") · `ltl` → "Less than truckload" ("LTL") · `partial` → "Partial" |
| `equipment_type` | `dry_van_53` → "Dry van, 53 ft" · `reefer_53` → "Reefer, 53 ft" · `flatbed_48` → "Flatbed, 48 ft" · `flatbed_tarped` → "Flatbed, tarped" · `step_deck_48` → "Step deck, 48 ft" · `power_only` → "Power only" · `box_truck_26` → "Box truck, 26 ft". Reefer ⇔ `reefer_53`. |
| `packaging` | `pallets` "Pallets" · `skids` "Skids" · `crates` "Crates" · `boxes` "Boxes" · `drums` "Drums" · `totes` "Totes" · `loose` "Loose" |
| `ltl_service` | `liftgate_pickup` "Liftgate at pickup" · `liftgate_delivery` "Liftgate at delivery" · `residential_delivery` "Residential delivery" · `inside_delivery` "Inside delivery" · `delivery_appointment` "Delivery appointment" · `limited_access` "Limited access" |
| `stop_kind` | `pickup` → "Pickup" · `delivery` → "Delivery" · `fuel` → "Fuel stop" |
| `stop_status` | `pending`, `arrived`, `completed` (label rule §6.0.5) |
| `dispatch_status` | `assigned`, `completed`, `cancelled` (not displayed) |
| `load_activity_kind` | `created`, `driver_instructions`, `driver_accepted`, `arrived`, `document_uploaded`, `invoice_queued`, `consignee_notified` (the message text is stored, §5.6.4) |
| `document_type` | `rate_confirmation` "Rate confirmation" · `customer_load_tender` "Customer load tender" · `bill_of_lading` "Bill of lading" · `proof_of_delivery` "Proof of delivery" · `lumper_receipt` "Lumper receipt" |
| `document_status` | `pending` → "Pending" (A) · `attached` → "Attached" (Gr). The Uninvoiced POD chip: attached POD → "Attached" (Gr), else "Missing" (A) |

`loads.freight_class` is `text` restricted by CHECK to `50, 55, 60, 65, 70, 77.5, 85, 92.5, 100, 110, 125, 150, 175, 200, 250, 300, 400, 500` (exported as `FREIGHT_CLASSES`).

### 4.5 Money

| enum | value → Runtruck1 label |
|---|---|
| `invoice_status` | `draft` → "Draft" (A) · `sent` → "Sent" (B) · `overdue` → "Overdue" (A) · `paid` → "Paid" (Gr) |
| `payment_method` | `ach` → "ACH" (G) · `check` → "Check" (G) · `factoring` → "Factoring" (B) |
| `invoice_batch_status` | `ready` → "Ready" (B) · `sent` → "Sent" (B) · `settled` → "Settled" (Gr) |
| `bill_status` | `due` → "Due" (A) · `overdue` → "Overdue" (A) · `scheduled` → "Scheduled" (B) · `paid` → "Paid" (Gr) |
| `settlement_status` | `ready` → "Ready" (B) · `approved` → "Approved" (B) · `on_hold` → "Hold · {hold_reason}" (A) · `paid` → "Paid" (Gr) |
| `settlement_item_kind` | `line_pay`, `deduction` |

### 4.6 Safety

| enum | value → Runtruck1 label |
|---|---|
| `work_order_status` | `scheduled` → "Scheduled" (B) · `due` → "Due" (A) · `overdue` → "Overdue" (A) · `in_shop` → "In shop" (A) · `done` → "Done" (G) |
| `driver_document_type` | `cdl` "CDL" · `medical_card` "Medical card" · `mvr` "MVR" · `annual_review` "Annual review" · `drug_test` "Drug test" · `clearinghouse_query` "Clearinghouse query" |
| `driver_document_status` | `valid` → "Valid" (Gr) · `expiring` → "Expiring" (A) · `expired` → "Expired" (A) · `missing` → "Missing" (A) |
| `date_precision` | `day` → rendered "Sep 20" · `month` → rendered "Apr 2028" |
| `violation_status` | `open` → "Open" (A) · `contested` → "Contested" (B) · `closed` → "Closed" (G) |
| `claim_type` | `cargo_damage` "Cargo damage" · `property_damage` "Property damage" · `bodily_injury` "Bodily injury" · `cargo_shortage` "Cargo shortage" |
| `claimant_kind` | `customer` → the customer's name · `facility` → the facility's name · `third_party` → "Third party · {claimant_name}" |
| `claim_status` | `open` → "Open" (A) · `under_review` → "Under review" (B) · `settled` → "Settled" (Gr) · `denied` → "Denied" (G) |

### 4.7 Planner

| enum | values |
|---|---|
| `planner_tone` | `amber`, `green`, `red`, `purple`, `blue`, `teal`, `pink`, `orange`, `indigo`, `slate` (CSS class `t-<tone>`; Runtruck1 `TONES` order) |

---

## 5. Domain tables

Notation: as in §2. "standard columns (§1.2)" stands for `id`, `organization_id` (FK → `organizations(id)` ON DELETE RESTRICT, Drizzle name `<table>_organization_id_organizations_id_fk`), `created_at` and `updated_at`. Every domain table also has its tenant key `<table>_org_id_uq UNIQUE (organization_id, id)` (§1.3); it is not repeated below. A composite FK written `(organization_id, x_id) → t` means `FOREIGN KEY (organization_id, x_id) REFERENCES t (organization_id, id)`. "Labels" gives the Runtruck1 label of every enum value the table stores (the catalogue is §4; tones B/G/A/Gr as there).

### 5.1 Customers (`customers.ts`)

#### 5.1.1 `customers`

The shipper accounts: CRM table and cards, New Load "Customer", invoice and batch recipients.

| column | type | null | default | notes |
|---|---|---|---|---|
| standard columns (§1.2) | | | | |
| `name` | `text` | not null | | "Northgate Foods" |
| `standing` | `customer_standing` | not null | | the CRM "Standing" chip and the card tier |
| `payment_terms` | `payment_terms` | not null | | default terms; copied onto new loads (New Load pre-fills "Payment terms") and invoices |
| `position` | `integer` | not null | | hand-authored list order (CRM table, New Load select) |

- Unique: `customers_org_name_uq (organization_id, lower(name))`.
- Index: `customers_org_position_idx (organization_id, position)`.
- Labels: `standing` key_account "Key account" (B) · growing "Growing" (G) · at_risk "At risk" (A). `payment_terms` net_15 "Net 15" · net_30 "Net 30" · net_45 "Net 45" · net_60 "Net 60" · quick_pay "Quick pay" (net days 15/30/45/60/0, §6.0.7).

#### 5.1.2 `customer_contacts`

People at a customer. The primary one is the CRM "Primary contact" and the account card's `Name · email`.

| column | type | null | default | notes |
|---|---|---|---|---|
| standard columns (§1.2) | | | | |
| `customer_id` | `uuid` | not null | | the customer |
| `full_name` | `text` | not null | | "Dana Ruiz" |
| `email` | `text` | null | | "dana@northgate.com"; personal data |
| `phone` | `text` | null | | personal data |
| `is_primary` | `boolean` | not null | `false` | the contact shown in the CRM |
| `position` | `integer` | not null | | order within the customer |

- FK: `customer_contacts_customer_fk (organization_id, customer_id) → customers` ON DELETE CASCADE.
- Unique (partial): `customer_contacts_primary_uq (organization_id, customer_id) WHERE is_primary` (at most one primary contact).
- Index: `customer_contacts_org_customer_idx (organization_id, customer_id, position)`.

### 5.2 Carriers (`carriers.ts`)

#### 5.2.1 `carriers`

The organization's own operating authority (`is_own_fleet`) and the partner carriers that brokered loads are tendered to (New Load "Carrier", the load "Carrier" card, the Loads expand "Carrier").

| column | type | null | default | notes |
|---|---|---|---|---|
| standard columns (§1.2) | | | | |
| `name` | `text` | not null | | stored without " (own fleet)"; the web appends it when `is_own_fleet` (§6.0.8) |
| `mc_number` | `text` | null | | digits only, "812044"; rendered "MC 812044" |
| `dot_number` | `text` | null | | digits only, "2291176"; rendered "DOT 2291176" |
| `is_own_fleet` | `boolean` | not null | `false` | the organization's own authority |
| `position` | `integer` | not null | | New Load list order (own fleet is position 1) |

- Unique: `carriers_org_name_uq (organization_id, lower(name))`; partial `carriers_own_fleet_uq (organization_id) WHERE is_own_fleet` (exactly one own-fleet row per organization).
- Index: `carriers_org_position_idx (organization_id, position)`.

### 5.3 Facilities (`facilities.ts`)

#### 5.3.1 `facilities`

Shippers, consignees, the crossdock, the port, the yard and the shops. Stops, trailer yard locations, work-order shops and claim claimants point here. The Facilities page is "coming soon" and reads nothing.

| column | type | null | default | notes |
|---|---|---|---|---|
| standard columns (§1.2) | | | | |
| `name` | `text` | not null | | "Reno Grocers DC" |
| `kind` | `facility_kind` | not null | | not displayed |
| `address_line1` | `text` | null | | "1855 E Greg St" |
| `city` | `text` | not null | | address city, "Sparks" |
| `state` | `text` | not null | | two-letter state, "NV" |
| `postal_code` | `text` | null | | |
| `timezone` | `text` | not null | | IANA zone; stop times at this facility are wall clock in it (§1.5) |
| `market_city` | `text` | null | | route-label city when it differs from the address city ("Reno"); null → `city` |
| `market_state` | `text` | null | | route-label state; null → `state` |
| `market_short` | `text` | null | | driver "Current load" short label ("SLC"); null → market city, then city |

- Unique: `facilities_org_name_uq (organization_id, lower(name))`.
- Index: `facilities_org_kind_idx (organization_id, kind)`.
- Labels: `facility_kind` has no Runtruck1 label (not displayed).

### 5.4 HR (`hr.ts`)

#### 5.4.1 `employees`

Everyone on staff: the six drivers, Rosa Medina (linked to her user), the mechanic, the dispatchers and hires in onboarding. Names feed every "Driver", "Employee" and "Owner" column and the KPI notes.

| column | type | null | default | notes |
|---|---|---|---|---|
| standard columns (§1.2) | | | | |
| `first_name` | `text` | not null | | |
| `last_name` | `text` | not null | | KPI notes use it ("Nakamura · 1h 45m", "Raman Sep 20") |
| `status` | `employee_status` | not null | | `onboarding` for a hire whose contract has not started (Jamal Reed) |
| `user_id` | `uuid` | null | | FK → `users(id)` ON DELETE RESTRICT (`employees_user_id_users_id_fk`); set when the employee can sign in |

- Unique (partial): `employees_org_user_uq (organization_id, user_id) WHERE user_id IS NOT NULL`.
- Index: `employees_org_name_idx (organization_id, last_name, first_name)`.
- Labels: `employee_status` is not displayed.

#### 5.4.2 `employee_contracts`

HR › Employee Contracts: one row per contract on file.

| column | type | null | default | notes |
|---|---|---|---|---|
| standard columns (§1.2) | | | | |
| `employee_id` | `uuid` | not null | | "Employee" |
| `role` | `employee_role` | not null | | "Role" |
| `contract_type` | `contract_type` | not null | | "Type" |
| `status` | `contract_status` | not null | | stored lifecycle status (design brief §2) |
| `starts_on` | `date` | not null | | "Start" (F-DATE, §6.0.9) |
| `renews_on` | `date` | not null | | "Renews": the renewal date, or the end of a fixed term (status `expiring`) |
| `pay_basis` | `pay_basis` | not null | | "Pay basis" (format §6.0.6) |
| `pay_rate_cents` | `integer` | null | | cents per mile / per hour / per year; null for `percent_of_line_haul` |
| `pay_percent_bp` | `integer` | null | | basis points of line haul; only for `percent_of_line_haul` |
| `position` | `integer` | not null | | hand-authored list order |

- FK: `employee_contracts_employee_fk (organization_id, employee_id) → employees` ON DELETE RESTRICT.
- Indexes: `employee_contracts_org_position_idx (organization_id, position)`, `employee_contracts_org_employee_idx (organization_id, employee_id)`.
- CHECK `employee_contracts_dates_ck`: `renews_on >= starts_on`.
- CHECK `employee_contracts_pay_ck` (`payBasisCheck`, shared with settlements): `(pay_basis = 'percent_of_line_haul' and pay_percent_bp is not null and pay_percent_bp between 1 and 10000 and pay_rate_cents is null) or (pay_basis <> 'percent_of_line_haul' and pay_rate_cents is not null and pay_rate_cents > 0 and pay_percent_bp is null)`.
- Labels: `role` company_driver "Company driver" · owner_operator "Owner-operator" · dispatcher "Dispatcher" · mechanic "Mechanic". `contract_type` w2 "W-2" · form_1099 "1099" · lease_purchase "Lease-purchase". `status` active "Active" (Gr) · renewal_due "Renewal due" (A) · expiring "Expiring" (A) · draft "Draft" (G). `pay_basis` per §6.0.6.

#### 5.4.3 `onboarding_cases`

HR › Onboarding: one row per candidate being onboarded.

| column | type | null | default | notes |
|---|---|---|---|---|
| standard columns (§1.2) | | | | |
| `candidate_name` | `text` | not null | | "Candidate"; personal data |
| `employee_id` | `uuid` | null | | set once the candidate is an employee (Jamal Reed, Evan Brooks) |
| `role` | `employee_role` | not null | | "Role" |
| `stage` | `onboarding_stage` | not null | | "Stage" chip |
| `started_on` | `date` | not null | | "Started" (F-SHORT) |
| `owner_employee_id` | `uuid` | not null | | "Owner" (employee full name) |
| `progress_percent` | `smallint` | not null | | "Progress" bar and text; not a function of the stage (Derek 35 and Kevin 30 share one), so stored |
| `next_step` | `text` | not null | | "Next step" text |
| `next_step_on` | `date` | null | | appended as ` · <F-SHORT>` when set |
| `completed_on` | `date` | null | | set iff stage `complete`; "Completed this quarter" |
| `position` | `integer` | not null | | hand-authored list order |

- FKs: `onboarding_cases_employee_fk (organization_id, employee_id) → employees` and `onboarding_cases_owner_fk (organization_id, owner_employee_id) → employees`, ON DELETE RESTRICT.
- Index: `onboarding_cases_org_position_idx (organization_id, position)`.
- CHECK `onboarding_cases_progress_ck`: `progress_percent between 0 and 100`.
- CHECK `onboarding_cases_completed_ck`: `(stage = 'complete') = (completed_on is not null)`.
- Labels: `stage` application "Application" (G) · background_check "Background check" (A) · road_test "Road test" (B) · orientation "Orientation" (B) · complete "Complete" (Gr). `role` as §5.4.2.

#### 5.4.4 `onboarding_document_requests`

Documents requested from a candidate. A case with a `pending` request is "Awaiting documents"; the labels form that KPI's note.

| column | type | null | default | notes |
|---|---|---|---|---|
| standard columns (§1.2) | | | | |
| `onboarding_case_id` | `uuid` | not null | | |
| `label` | `text` | not null | | stored as shown in the KPI note ("MVR consent", "medical card") |
| `status` | `onboarding_request_status` | not null | | |
| `position` | `integer` | not null | | order within the case |

- FK: `onboarding_document_requests_case_fk (organization_id, onboarding_case_id) → onboarding_cases` ON DELETE CASCADE.
- Unique: `onboarding_document_requests_case_position_uq (organization_id, onboarding_case_id, position)` (also serves lookups by case).
- Labels: `onboarding_request_status` (`pending`, `received`) is not displayed.

### 5.5 Fleet (`fleet.ts`)

#### 5.5.1 `drivers`

The driver roster (Fleet › Drivers, the Dashboard "Drivers" card, New Load "Driver"). One row per employee who drives; the roster lists every row.

| column | type | null | default | notes |
|---|---|---|---|---|
| standard columns (§1.2) | | | | |
| `employee_id` | `uuid` | not null | | the name comes from the employee |
| `duty_status` | `driver_duty_status` | not null | | "Status" chip, Dashboard dot |
| `hos_remaining_minutes` | `integer` | null | | drive time left as last reported (ELD fact); null renders "—" |
| `hos_as_of` | `timestamptz` | null | | when that was reported |
| `position` | `integer` | not null | | roster order |

- FK: `drivers_employee_fk (organization_id, employee_id) → employees` ON DELETE RESTRICT.
- Unique: `drivers_org_employee_uq (organization_id, employee_id)`.
- Index: `drivers_org_position_idx (organization_id, position)`.
- CHECK `drivers_hos_ck`: `hos_remaining_minutes is null or hos_remaining_minutes >= 0`.
- Labels: `duty_status` on_duty "On duty" (B) · available "Available" (G) · home_time "Home time" (G).

#### 5.5.2 `driver_mileage_entries`

Miles reported for a driver on a business day (ELD mileage fact). "Miles per driver, this week" sums them (§6.6).

| column | type | null | default | notes |
|---|---|---|---|---|
| standard columns (§1.2) | | | | |
| `driver_id` | `uuid` | not null | | |
| `recorded_on` | `date` | not null | | org-local business day the miles were reported for |
| `miles` | `integer` | not null | | |

- FK: `driver_mileage_entries_driver_fk (organization_id, driver_id) → drivers` ON DELETE CASCADE.
- Indexes: `driver_mileage_entries_org_recorded_idx (organization_id, recorded_on)`, `driver_mileage_entries_org_driver_idx (organization_id, driver_id, recorded_on)`.
- CHECK `driver_mileage_entries_miles_ck`: `miles >= 0`.

#### 5.5.3 `trucks`

Power units (Fleet › Trucks, the driver's "Unit", dispatch truck, work orders, violations, claims).

| column | type | null | default | notes |
|---|---|---|---|---|
| standard columns (§1.2) | | | | |
| `unit_number` | `text` | not null | | "T-114" |
| `make` | `text` | not null | | "Peterbilt" |
| `model` | `text` | not null | | "579" |
| `model_year` | `smallint` | not null | | 2020; "Make / year" = `<make> <model> · <year>` |
| `plate_state` | `text` | not null | | "CA" |
| `plate_number` | `text` | not null | | "6PL4408"; "Plate" = `<state> <number>` |
| `assigned_driver_id` | `uuid` | null | | the truck's "Assigned to" and the driver's "Unit" |
| `odometer_miles` | `integer` | not null | | "Odometer" (F-INT) |
| `next_service_miles` | `integer` | null | | odometer reading at which service is due, "Next service"; null renders "—" |
| `status` | `truck_status` | not null | | stored lifecycle status |

- FK: `trucks_assigned_driver_fk (organization_id, assigned_driver_id) → drivers` ON DELETE RESTRICT.
- Unique: `trucks_org_unit_uq (organization_id, unit_number)`; partial `trucks_org_assigned_driver_uq (organization_id, assigned_driver_id) WHERE assigned_driver_id IS NOT NULL` (at most one truck per driver).
- CHECK `trucks_odometer_ck`: `odometer_miles >= 0 and (next_service_miles is null or next_service_miles >= 0)`.
- Labels: `status` in_service "In service" (B) · service_due "Service due" (A) · in_shop "In shop" (A).

#### 5.5.4 `trailers`

Fleet › Trailers, dispatch trailer, work orders, claims.

| column | type | null | default | notes |
|---|---|---|---|---|
| standard columns (§1.2) | | | | |
| `unit_number` | `text` | not null | | "RF-88" |
| `trailer_type` | `trailer_type` | not null | | "Type" = `<label> · <length_ft> ft` |
| `length_ft` | `smallint` | not null | | 53 |
| `status` | `trailer_status` | not null | | stored lifecycle status |
| `location_kind` | `trailer_location_kind` | not null | | which location column applies |
| `location_facility_id` | `uuid` | null | | `yard`: the yard facility |
| `location_route` | `text` | null | | `en_route`: the corridor, "I-80" |
| `location_city` | `text` | null | | `city`: "Bakersfield" |
| `location_state` | `text` | null | | `city`: "CA" |
| `position` | `integer` | not null | | hand-authored list order |

- FK: `trailers_location_facility_fk (organization_id, location_facility_id) → facilities` ON DELETE RESTRICT.
- Unique: `trailers_org_unit_uq (organization_id, unit_number)`.
- Index: `trailers_org_position_idx (organization_id, position)`.
- CHECK `trailers_length_ck`: `length_ft > 0`.
- CHECK `trailers_location_ck`: `(location_kind = 'yard' and location_facility_id is not null) or (location_kind = 'en_route' and location_route is not null) or (location_kind = 'city' and location_city is not null and location_state is not null)`.
- Labels: `trailer_type` reefer "Reefer" · dry_van "Dry van" · flatbed "Flatbed". `status` loaded "Loaded" (B) · empty "Empty" (G) · inspection "Inspection" (A). `location_kind` yard → "Yard · {facility city}" · en_route → "En route · {location_route}" · city → "{location_city}, {location_state}".

### 5.6 Loads (`loads.ts`)

#### 5.6.1 `loads`

The load: board rows, the detail page, New Load writes, and the history behind billing (archived loads, §6.0.3).

| column | type | null | default | notes |
|---|---|---|---|---|
| standard columns (§1.2) | | | | `created_at` orders the board (§6.3) |
| `load_number` | `integer` | not null | | human number, "L-40218"; counter key `load` (§1.9) |
| `customer_id` | `uuid` | not null | | "Customer" |
| `bill_to_customer_id` | `uuid` | null | | New Load "Bill to" when different |
| `tender_ref` | `text` | null | | "Tender #" / "Reference"; seeded loads carry Runtruck1's `ref` here |
| `customer_po` | `text` | null | | "Reference" falls back to it (§6.0.3) |
| `mode` | `load_mode` | null | | null for seeded loads (the detail page then has no "Mode" row) |
| `equipment_type` | `equipment_type` | null | | "Equipment"; null only on archived history (`loads_complete_ck`) |
| `dispatcher_name` | `text` | null | | New Load "Dispatcher" |
| `commodity` | `text` | null | | "Commodity"; null only on archived history |
| `weight_lb` | `integer` | null | | "Weight" = F-INT + " lb"; null only on archived history |
| `pieces` | `integer` | null | | |
| `packaging` | `packaging` | null | | |
| `declared_value_cents` | `integer` | null | | |
| `temperature_f` | `numeric(4,1)` | null | | reefer set point, °F (§1.6) |
| `hazmat` | `boolean` | not null | `false` | |
| `un_number` | `text` | null | | required when `hazmat` |
| `freight_class` | `text` | null | | NMFC class, one of `FREIGHT_CLASSES` |
| `nmfc` | `text` | null | | |
| `handling_units` | `integer` | null | | |
| `length_in`, `width_in`, `height_in` | `integer` | null | | dimensions |
| `stackable` | `boolean` | not null | `false` | |
| `ltl_services` | `ltl_service[]` | not null | `'{}'::ltl_service[]` | in the order ticked; rendered in that order in the "LTL" row |
| `carrier_id` | `uuid` | null | | own fleet or partner; null = "Not yet covered" |
| `carrier_contact_name` | `text` | null | | |
| `carrier_phone` | `text` | null | | |
| `carrier_rate_cents` | `integer` | null | | brokered loads: what the partner is paid ("Carrier cost", "Carrier rate") |
| `line_haul_cents` | `integer` | not null | | "Rate" / "Line haul" |
| `fuel_surcharge_cents` | `integer` | not null | `0` | part of "Total to customer" |
| `accessorial_cents` | `integer` | not null | `0` | part of "Total to customer" |
| `loaded_miles` | `integer` | null | | "Miles"; the rate-per-mile divisor |
| `empty_miles` | `integer` | null | | deadhead to the first pickup (Dashboard "Deadhead miles", §6.0.2) |
| `driver_pay_cents` | `integer` | null | | own-fleet loads: "Driver pay" |
| `operating_cost_cents` | `integer` | null | | other trip cost deducted in "Margin" (§6.0.2) |
| `payment_terms` | `payment_terms` | not null | | the load's terms (New Load "Payment terms") |
| `status` | `load_status` | not null | | stored lifecycle status ([08-load-lifecycle.md](08-load-lifecycle.md)) |
| `driver_instructions` | `text` | null | | activity "Driver instructions: …" |
| `internal_notes` | `text` | null | | |
| `archived_at` | `timestamptz` | null | | set when the load is closed off the dispatch board; the board, planner stop events and EventDialog "Related load" exclude archived loads |
| `created_by_user_id` | `uuid` | null | | FK → `users(id)` ON DELETE RESTRICT (`loads_created_by_user_id_users_id_fk`); null for seeded rows |

- FKs: `loads_customer_fk (organization_id, customer_id) → customers`, `loads_bill_to_customer_fk (organization_id, bill_to_customer_id) → customers`, `loads_carrier_fk (organization_id, carrier_id) → carriers`, all ON DELETE RESTRICT.
- Unique: `loads_org_number_uq (organization_id, load_number)`.
- Indexes: partial `loads_org_board_idx (organization_id, created_at DESC) WHERE archived_at IS NULL`; `loads_org_status_idx (organization_id, status)`; `loads_org_customer_idx (organization_id, customer_id)`; `loads_org_carrier_idx (organization_id, carrier_id)`.
- CHECK `loads_number_ck`: `load_number > 0`.
- CHECK `loads_money_ck`: `line_haul_cents >= 0 and fuel_surcharge_cents >= 0 and accessorial_cents >= 0 and (declared_value_cents is null or declared_value_cents >= 0) and (operating_cost_cents is null or operating_cost_cents >= 0)`.
- CHECK `loads_total_ck`: `line_haul_cents::bigint + fuel_surcharge_cents + accessorial_cents <= 2147483647` (migration `0003`). Each money column is an `integer`, so without it revenue(l) (§6.0.3) could exceed the `integer` range; New Load refuses such a total ("Total to customer is too large.", docs/api/loads.md §6.1).
- CHECK `loads_pay_ck`: `(driver_pay_cents is null or driver_pay_cents > 0) and (carrier_rate_cents is null or carrier_rate_cents > 0) and (driver_pay_cents is null or carrier_rate_cents is null)` (a driver pay or a carrier cost, never both).
- CHECK `loads_quantities_ck`: `loaded_miles`, `empty_miles`, `pieces`, `length_in`, `width_in`, `height_in` are null or `>= 0`; `weight_lb` and `handling_units` are null or `> 0`.
- CHECK `loads_hazmat_ck`: `not hazmat or un_number is not null`.
- CHECK `loads_ltl_ck`: `mode is distinct from 'ltl' or (freight_class is not null and handling_units is not null)`.
- CHECK `loads_freight_class_ck`: `freight_class is null or freight_class in ('50', '55', '60', '65', '70', '77.5', '85', '92.5', '100', '110', '125', '150', '175', '200', '250', '300', '400', '500')`.
- CHECK `loads_complete_ck`: `archived_at is not null or (equipment_type is not null and commodity is not null and weight_lb is not null)`.
- Labels: `status` needs_driver "Needs driver" (A) · dispatched "Dispatched" (G) · at_pickup "At pickup" (G) · in_transit "In transit" (B) · delayed "Delayed" (A) · needs_pod "Needs POD" (A) · delivered "Delivered" (G). `mode` ftl "Full truckload" · ltl "Less than truckload" · partial "Partial". `equipment_type`, `packaging`, `ltl_services`, `payment_terms`: §4.2, §4.4.

#### 5.6.2 `load_stops`

The stops of a load in running order: pickups, deliveries and fuel stops. Every stop card, the Loads expand "Stops (n)", the planner's load-stop events and every route label read them.

| column | type | null | default | notes |
|---|---|---|---|---|
| standard columns (§1.2) | | | | |
| `load_id` | `uuid` | not null | | |
| `sequence` | `smallint` | not null | | 1-based order in which the truck runs the stops |
| `kind` | `stop_kind` | not null | | |
| `status` | `stop_status` | not null | `'pending'` | drives the detail-page kind label (§6.0.5) |
| `facility_id` | `uuid` | null | | set when the stop is a known facility (route labels then use its market, §6.0.3) |
| `facility_name` | `text` | not null | | snapshot shown on the stop card; free text for New Load stops |
| `address_line1` | `text` | null | | |
| `city` | `text` | null | | address city; required for pickups and deliveries |
| `state` | `text` | null | | required for pickups and deliveries |
| `postal_code` | `text` | null | | |
| `timezone` | `text` | not null | | IANA zone of the wall-clock times below: the facility's, else the organization's |
| `appointment_date` | `date` | not null | | stop-local business day ("Pickup"/"Delivery" dates) |
| `window_open` | `time` | null | | appointment window open, wall clock in `timezone` |
| `window_close` | `time` | null | | appointment window close; either end may be missing |
| `planned_start` | `time` | null | | planner slot (design brief §2), wall clock in `timezone` |
| `planned_end` | `time` | null | | |
| `reference_number` | `text` | null | | "Pickup #" / "Delivery #" |
| `site_contact` | `text` | null | | personal data |
| `arrived_at` | `timestamptz` | null | | actual arrival |
| `completed_at` | `timestamptz` | null | | actual completion |

- FKs: `load_stops_load_fk (organization_id, load_id) → loads` ON DELETE CASCADE; `load_stops_facility_fk (organization_id, facility_id) → facilities` ON DELETE RESTRICT.
- Unique: `load_stops_load_sequence_uq (organization_id, load_id, sequence)` (also serves lookups by load).
- Indexes: `load_stops_org_date_idx (organization_id, appointment_date)` (planner ranges, candidate loads of date-bounded aggregates); partial `load_stops_org_completed_idx (organization_id, completed_at) WHERE completed_at IS NOT NULL` (loads delivered in a date window, Dashboard revenue; migration `0003`).
- CHECK `load_stops_sequence_ck`: `sequence >= 1`.
- CHECK `load_stops_place_ck`: `kind = 'fuel' or (city is not null and state is not null)`.
- CHECK `load_stops_planned_ck`: `(planned_start is null and planned_end is null) or (planned_start is not null and planned_end is not null and planned_end > planned_start)`.
- CHECK `load_stops_arrived_ck`: `arrived_at is null or status in ('arrived', 'completed')`.
- CHECK `load_stops_completed_ck`: `completed_at is null or status = 'completed'`.
- Labels: `kind` pickup "Pickup" · delivery "Delivery" · fuel "Fuel stop"; `status` (`pending`, `arrived`, `completed`) through the label rule §6.0.5.

#### 5.6.3 `dispatches`

Who hauls the load (architecture §19): the own-fleet driver, truck and trailer, or a partner carrier's free-text driver and unit numbers. At most one live dispatch per load.

| column | type | null | default | notes |
|---|---|---|---|---|
| standard columns (§1.2) | | | | |
| `load_id` | `uuid` | not null | | |
| `driver_id` | `uuid` | null | | own-fleet driver |
| `truck_id` | `uuid` | null | | own-fleet truck |
| `trailer_id` | `uuid` | null | | own-fleet trailer |
| `driver_name` | `text` | null | | brokered: the partner's driver (free text) |
| `truck_number` | `text` | null | | brokered: the partner's truck number |
| `trailer_number` | `text` | null | | brokered: the partner's trailer number |
| `status` | `dispatch_status` | not null | `'assigned'` | `completed` once the load is delivered |
| `assigned_at` | `timestamptz` | not null | `now()` | |
| `assigned_by_user_id` | `uuid` | null | | FK → `users(id)` ON DELETE RESTRICT (`dispatches_assigned_by_user_id_users_id_fk`) |

- FKs: `dispatches_load_fk (organization_id, load_id) → loads` ON DELETE CASCADE; `dispatches_driver_fk → drivers`, `dispatches_truck_fk → trucks`, `dispatches_trailer_fk → trailers` (each `(organization_id, <x>_id)`), ON DELETE RESTRICT.
- Unique (partial): `dispatches_org_load_active_uq (organization_id, load_id) WHERE status <> 'cancelled'`.
- Indexes: `dispatches_org_driver_idx (organization_id, driver_id)`, `dispatches_org_truck_idx (organization_id, truck_id)`, `dispatches_org_trailer_idx (organization_id, trailer_id)`.
- CHECK `dispatches_party_ck`: `(driver_id is null or driver_name is null) and (truck_id is null or truck_number is null) and (trailer_id is null or trailer_number is null)`.
- CHECK `dispatches_not_empty_ck`: `coalesce(driver_id::text, driver_name, truck_id::text, truck_number, trailer_id::text, trailer_number) is not null`.
- Labels: `dispatch_status` (`assigned`, `completed`, `cancelled`) is not displayed.

#### 5.6.4 `load_activity`

The load detail "Activity" card. The message is rendered when the row is written and stored. Rows are never updated or deleted by the application (append-only by rule; there is no trigger, and rows go with their load on cascade).

| column | type | null | default | notes |
|---|---|---|---|---|
| `id`, `organization_id` | | | | as §1.2 |
| `load_id` | `uuid` | not null | | |
| `sequence` | `integer` | not null | | display order within the load |
| `occurred_at` | `timestamptz` | not null | | rendered "Today HH:MM" on the org business day, else "MMM d HH:MM" (org timezone; `formatActivityTime`) |
| `kind` | `load_activity_kind` | not null | | |
| `message` | `text` | not null | | the rendered line |
| `actor_user_id` | `uuid` | null | | FK → `users(id)` ON DELETE RESTRICT (`load_activity_actor_user_id_users_id_fk`); null when the actor is not a user (driver app, seed) |
| `created_at` | `timestamptz` | not null | `now()` | no `updated_at` |

- FK: `load_activity_load_fk (organization_id, load_id) → loads` ON DELETE CASCADE.
- Unique: `load_activity_load_sequence_uq (organization_id, load_id, sequence)`.
- Message per kind (Runtruck1 wording): `created` "Load created by {actor full name}" · `driver_instructions` "Driver instructions: {loads.driver_instructions}" · `driver_accepted` "Driver accepted the load in the app" · `arrived` "Arrived at {pickup facility_name}" · `document_uploaded` "Bill of lading uploaded from the cab" · `invoice_queued` "Invoice queued for billing" · `consignee_notified` "Dispatch notified the consignee".

### 5.7 Documents (`documents.ts`)

#### 5.7.1 `documents`

The load "Documents" card and the Uninvoiced "POD" chip: one row per checklist slot of a load. The file itself is a version (§5.7.2).

| column | type | null | default | notes |
|---|---|---|---|---|
| standard columns (§1.2) | | | | |
| `load_id` | `uuid` | not null | | |
| `document_type` | `document_type` | not null | | the row label |
| `status` | `document_status` | not null | `'pending'` | `attached` once a version exists |
| `position` | `smallint` | not null | | order of the card rows |
| `attached_at` | `timestamptz` | null | | when the first file was attached; set iff `attached` |

- FK: `documents_load_fk (organization_id, load_id) → loads` ON DELETE CASCADE.
- Unique: `documents_org_load_type_uq (organization_id, load_id, document_type)` (one slot per type per load; also serves lookups by load).
- Index: `documents_org_type_status_idx (organization_id, document_type, status)` (POD look-ups for Uninvoiced).
- CHECK `documents_attached_ck`: `(status = 'attached') = (attached_at is not null)`.
- Checklists: New Load creates five slots, positions 1–5, in Runtruck1's `DOCUMENTS` order (rate_confirmation, customer_load_tender, bill_of_lading, proof_of_delivery, lumper_receipt), `attached` where a file was chosen. Seeded slots: §7.12, §7.13.
- Labels: `document_type` rate_confirmation "Rate confirmation" · customer_load_tender "Customer load tender" · bill_of_lading "Bill of lading" · proof_of_delivery "Proof of delivery" · lumper_receipt "Lumper receipt". `status` pending "Pending" (A) · attached "Attached" (Gr); on Uninvoiced an attached POD reads "Attached" (Gr), anything else "Missing" (A).

#### 5.7.2 `document_versions`

One uploaded file of a document slot; the highest `version_number` is current. Binaries live in object storage, bucket `runtruck-documents` (architecture §21).

| column | type | null | default | notes |
|---|---|---|---|---|
| `id`, `organization_id` | | | | as §1.2 |
| `document_id` | `uuid` | not null | | |
| `version_number` | `integer` | not null | | 1, 2, … per document |
| `file_name` | `text` | not null | | the name the user uploaded ("rate-con-40223.pdf") |
| `storage_key` | `text` | not null | | `org/{organization_id}/loads/{load_id}/documents/{id}` (this version's own id, generated before the row is inserted). Every part is known before the upload transaction, so the object is written before any row is locked ([13 §4.4](13-document-system.md)); no user-supplied text. |
| `mime_type` | `text` | not null | | |
| `size_bytes` | `bigint` | not null | | |
| `checksum_sha256` | `text` | null | | lower-case hex |
| `uploaded_by_user_id` | `uuid` | null | | FK → `users(id)` ON DELETE RESTRICT (`document_versions_uploaded_by_user_id_users_id_fk`); null for seeded placeholders |
| `uploaded_at` | `timestamptz` | not null | `now()` | |
| `created_at` | `timestamptz` | not null | `now()` | no `updated_at` (append-only by rule) |

- FK: `document_versions_document_fk (organization_id, document_id) → documents` ON DELETE CASCADE.
- Unique: `document_versions_document_version_uq (organization_id, document_id, version_number)`; `document_versions_storage_key_uq (storage_key)` (global, §1.3).
- CHECK `document_versions_number_ck`: `version_number >= 1 and size_bytes >= 0`.

### 5.8 Billing (`billing.ts`)

Totals are never stored: an invoice's amount is the sum of its items and a batch's total the sum of its invoices (§1.8, §6.0.7).

#### 5.8.1 `factoring_companies`

Factors that buy invoices ("TriPoint Capital"): the payment method detail and a batch recipient.

| column | type | null | default | notes |
|---|---|---|---|---|
| standard columns (§1.2) | | | | |
| `name` | `text` | not null | | |

- Unique: `factoring_companies_org_name_uq (organization_id, lower(name))`.

#### 5.8.2 `invoices`

Accounting › Invoiced, Past Due and Paid; CRM AR balances; AR aging.

| column | type | null | default | notes |
|---|---|---|---|---|
| standard columns (§1.2) | | | | |
| `invoice_number` | `integer` | not null | | human number, "INV-8845"; counter key `invoice` |
| `customer_id` | `uuid` | not null | | "Customer" |
| `status` | `invoice_status` | not null | | stored lifecycle status (INV-8836 stays `overdue`) |
| `payment_terms` | `payment_terms` | not null | | terms of this invoice (may differ from the customer's default) |
| `issued_on` | `date` | null | | "Issued"; null while draft ("—") |
| `due_on` | `date` | null | | `issued_on` + net days of `payment_terms` (§6.0.7) |

- FK: `invoices_customer_fk (organization_id, customer_id) → customers` ON DELETE RESTRICT.
- Unique: `invoices_org_number_uq (organization_id, invoice_number)`.
- Indexes: `invoices_org_status_issued_idx (organization_id, status, issued_on)`, `invoices_org_customer_idx (organization_id, customer_id)`.
- CHECK `invoices_number_ck`: `invoice_number > 0`.
- CHECK `invoices_issued_ck`: `(status = 'draft') = (issued_on is null)`.
- CHECK `invoices_due_ck`: `(issued_on is null) = (due_on is null) and (due_on is null or due_on >= issued_on)`.
- Labels: `status` draft "Draft" (A) · sent "Sent" (B) · overdue "Overdue" (A) · paid "Paid" (Gr).

#### 5.8.3 `invoice_items`

The lines of an invoice. The invoice's "Load" column is the load of item 1; a load with any item is invoiced (§6.0.4).

| column | type | null | default | notes |
|---|---|---|---|---|
| standard columns (§1.2) | | | | |
| `invoice_id` | `uuid` | not null | | |
| `position` | `integer` | not null | | 1-based |
| `load_id` | `uuid` | null | | the invoiced load |
| `description` | `text` | not null | | "Line haul" |
| `amount_cents` | `integer` | not null | | |

- FKs: `invoice_items_invoice_fk (organization_id, invoice_id) → invoices` ON DELETE CASCADE; `invoice_items_load_fk (organization_id, load_id) → loads` ON DELETE RESTRICT.
- Unique: `invoice_items_invoice_position_uq (organization_id, invoice_id, position)`.
- Index: `invoice_items_org_load_idx (organization_id, load_id)`.
- CHECK `invoice_items_amount_ck`: `amount_cents >= 0 and position >= 1`.

#### 5.8.4 `payments`

Money received against an invoice (Accounting › Paid "Paid", "Via", "Days to pay").

| column | type | null | default | notes |
|---|---|---|---|---|
| standard columns (§1.2) | | | | |
| `invoice_id` | `uuid` | not null | | |
| `received_at` | `timestamptz` | not null | | instant received; its org-local date is "Paid"; the Paid tab orders by it |
| `method` | `payment_method` | not null | | "Via" |
| `factoring_company_id` | `uuid` | null | | set iff `method = 'factoring'` |
| `amount_cents` | `integer` | not null | | |
| `reference` | `text` | null | | check number, ACH trace |

- FKs: `payments_invoice_fk (organization_id, invoice_id) → invoices` and `payments_factoring_company_fk (organization_id, factoring_company_id) → factoring_companies`, ON DELETE RESTRICT.
- Indexes: `payments_org_invoice_idx (organization_id, invoice_id)`, `payments_org_received_idx (organization_id, received_at)`.
- CHECK `payments_amount_ck`: `amount_cents > 0`.
- CHECK `payments_factoring_ck`: `(method = 'factoring') = (factoring_company_id is not null)`.
- Labels: `method` ach "ACH" (G) · check "Check" (G) · factoring "Factoring" (B).

#### 5.8.5 `invoice_batches`

Accounting › Batches: invoices sent together to one recipient.

| column | type | null | default | notes |
|---|---|---|---|---|
| standard columns (§1.2) | | | | |
| `batch_number` | `integer` | not null | | human number, "B-2035"; counter key `invoice_batch` |
| `created_on` | `date` | not null | | "Created" |
| `customer_id` | `uuid` | null | | recipient customer ("Sent to") |
| `factoring_company_id` | `uuid` | null | | recipient factor ("TriPoint Capital (factoring)") |
| `status` | `invoice_batch_status` | not null | | stored lifecycle status |

- FKs: `invoice_batches_customer_fk (organization_id, customer_id) → customers` and `invoice_batches_factoring_company_fk (organization_id, factoring_company_id) → factoring_companies`, ON DELETE RESTRICT.
- Unique: `invoice_batches_org_number_uq (organization_id, batch_number)`.
- CHECK `invoice_batches_number_ck`: `batch_number > 0`.
- CHECK `invoice_batches_recipient_ck`: `(customer_id is null) <> (factoring_company_id is null)` (exactly one recipient).
- Labels: `status` ready "Ready" (B) · sent "Sent" (B) · settled "Settled" (Gr).

#### 5.8.6 `invoice_batch_items`

Membership of an invoice in a batch.

| column | type | null | default | notes |
|---|---|---|---|---|
| standard columns (§1.2) | | | | |
| `batch_id` | `uuid` | not null | | |
| `invoice_id` | `uuid` | not null | | |

- FKs: `invoice_batch_items_batch_fk (organization_id, batch_id) → invoice_batches` ON DELETE CASCADE; `invoice_batch_items_invoice_fk (organization_id, invoice_id) → invoices` ON DELETE RESTRICT.
- Unique: `invoice_batch_items_org_invoice_uq (organization_id, invoice_id)` (an invoice is in at most one batch).
- Index: `invoice_batch_items_org_batch_idx (organization_id, batch_id)`.

### 5.9 Payables (`payables.ts`)

#### 5.9.1 `vendors`

| column | type | null | default | notes |
|---|---|---|---|---|
| standard columns (§1.2) | | | | |
| `name` | `text` | not null | | "Modesto Yard — Lease" (em dash kept) |

- Unique: `vendors_org_name_uq (organization_id, lower(name))`.

#### 5.9.2 `bills`

Accounting › Bills (accounts payable).

| column | type | null | default | notes |
|---|---|---|---|---|
| standard columns (§1.2) | | | | |
| `vendor_id` | `uuid` | not null | | "Vendor" |
| `category` | `text` | not null | | "Telematics", "Parts", … |
| `description` | `text` | null | | "Category" shows `<category> · <description>` when set ("Parts · T-118 turbo") |
| `due_on` | `date` | not null | | "Due" |
| `amount_cents` | `integer` | not null | | "Amount" |
| `status` | `bill_status` | not null | | stored lifecycle status |
| `scheduled_on` | `date` | null | | auto-pay date; required when `scheduled` |
| `paid_on` | `date` | null | | set iff `paid` |

- FK: `bills_vendor_fk (organization_id, vendor_id) → vendors` ON DELETE RESTRICT.
- Indexes: `bills_org_due_idx (organization_id, due_on)`, `bills_org_status_idx (organization_id, status)`.
- CHECK `bills_amount_ck`: `amount_cents > 0`.
- CHECK `bills_paid_ck`: `(status = 'paid') = (paid_on is not null)`.
- CHECK `bills_scheduled_ck`: `status <> 'scheduled' or scheduled_on is not null`.
- Labels: `status` due "Due" (A) · overdue "Overdue" (A) · scheduled "Scheduled" (B) · paid "Paid" (Gr).

### 5.10 Settlements (`settlements.ts`)

Gross, deductions, net, loads and miles are computed from items (§1.8, §6.7.6).

#### 5.10.1 `settlements`

Accounting › Payroll: one driver's pay for one pay period.

| column | type | null | default | notes |
|---|---|---|---|---|
| standard columns (§1.2) | | | | |
| `driver_id` | `uuid` | not null | | "Driver" |
| `period_start` | `date` | not null | | "Week of Sep 1" |
| `period_end` | `date` | not null | | inclusive |
| `pay_basis` | `pay_basis` | not null | | basis in force for the period ("Basis", §6.0.6) |
| `pay_rate_cents` | `integer` | null | | as `employee_contracts` |
| `pay_percent_bp` | `integer` | null | | as `employee_contracts` |
| `status` | `settlement_status` | not null | | stored lifecycle status; "Approve all" / "Run settlements" moves `ready` → `approved` |
| `hold_reason` | `text` | null | | "Hold · fuel" → `fuel`; set iff `on_hold` |
| `approved_at` | `timestamptz` | null | | required when `approved` |
| `approved_by_user_id` | `uuid` | null | | FK → `users(id)` ON DELETE RESTRICT (`settlements_approved_by_user_id_users_id_fk`) |

- FK: `settlements_driver_fk (organization_id, driver_id) → drivers` ON DELETE RESTRICT.
- Unique: `settlements_org_driver_period_uq (organization_id, driver_id, period_start)`.
- Index: `settlements_org_period_idx (organization_id, period_start)`.
- CHECK `settlements_period_ck`: `period_end >= period_start`.
- CHECK `settlements_hold_ck`: `(status = 'on_hold') = (hold_reason is not null)`.
- CHECK `settlements_approved_ck`: `status <> 'approved' or approved_at is not null`.
- CHECK `settlements_pay_ck`: the pay-basis rule of `employee_contracts_pay_ck` (§5.4.2).
- Labels: `status` ready "Ready" (B) · approved "Approved" (B) · on_hold "Hold · {hold_reason}" (A) · paid "Paid" (Gr).

#### 5.10.2 `settlement_items`

The lines of a settlement: one `line_pay` item per paid load, and deductions (negative).

| column | type | null | default | notes |
|---|---|---|---|---|
| standard columns (§1.2) | | | | |
| `settlement_id` | `uuid` | not null | | |
| `position` | `integer` | not null | | 1-based |
| `kind` | `settlement_item_kind` | not null | | |
| `load_id` | `uuid` | null | | the load a `line_pay` item pays for, when known |
| `miles` | `integer` | null | | paid miles of a `line_pay` item |
| `description` | `text` | null | | |
| `amount_cents` | `integer` | not null | | signed: line pay ≥ 0, deductions ≤ 0 |

- FKs: `settlement_items_settlement_fk (organization_id, settlement_id) → settlements` ON DELETE CASCADE; `settlement_items_load_fk (organization_id, load_id) → loads` ON DELETE RESTRICT.
- Unique: `settlement_items_settlement_position_uq (organization_id, settlement_id, position)`.
- CHECK `settlement_items_amount_ck`: `(kind = 'line_pay' and amount_cents >= 0 and (miles is null or miles >= 0)) or (kind = 'deduction' and amount_cents <= 0 and miles is null and load_id is null)`.
- Labels: `kind` (`line_pay`, `deduction`) is not displayed.

### 5.11 Safety (`safety.ts`)

#### 5.11.1 `work_orders`

Safety › Maintenance: service work on a truck or a trailer.

| column | type | null | default | notes |
|---|---|---|---|---|
| standard columns (§1.2) | | | | |
| `truck_id` | `uuid` | null | | exactly one of truck / trailer ("Unit") |
| `trailer_id` | `uuid` | null | | |
| `item` | `text` | not null | | "Item" |
| `due_on` | `date` | null | | exactly one of the two dues: a day ("Sep 5") … |
| `due_odometer` | `integer` | null | | … or an odometer reading ("529,800 mi") |
| `shop_facility_id` | `uuid` | not null | | "Shop" = `<facility name> · <facility city>` |
| `estimate_cents` | `integer` | not null | | "Estimate" |
| `status` | `work_order_status` | not null | | stored lifecycle status |
| `completed_on` | `date` | null | | set iff `done` |
| `position` | `integer` | not null | | hand-authored list order |

- FKs: `work_orders_truck_fk (organization_id, truck_id) → trucks`, `work_orders_trailer_fk (organization_id, trailer_id) → trailers`, `work_orders_shop_fk (organization_id, shop_facility_id) → facilities`, ON DELETE RESTRICT.
- Indexes: `work_orders_org_position_idx (organization_id, position)`, `work_orders_org_status_idx (organization_id, status)`.
- CHECK `work_orders_unit_ck`: `(truck_id is null) <> (trailer_id is null)`.
- CHECK `work_orders_due_ck`: `(due_on is null) <> (due_odometer is null)`.
- CHECK `work_orders_estimate_ck`: `estimate_cents >= 0`.
- CHECK `work_orders_done_ck`: `(status = 'done') = (completed_on is not null)`.
- Labels: `status` scheduled "Scheduled" (B) · due "Due" (A) · overdue "Overdue" (A) · in_shop "In shop" (A) · done "Done" (G).

#### 5.11.2 `driver_documents`

Safety › Driver Documents (the driver qualification file; design brief canonical name) and the Drivers tab "CDL" column.

| column | type | null | default | notes |
|---|---|---|---|---|
| standard columns (§1.2) | | | | |
| `driver_id` | `uuid` | not null | | "Driver" |
| `document_type` | `driver_document_type` | not null | | "Document" |
| `expires_on` | `date` | null | | null = missing; a month-precision date is stored as the last day of the month |
| `expires_precision` | `date_precision` | not null | `'month'` | "Expires" renders F-SHORT for `day`, F-MONTHYEAR for `month`, "—" when `expires_on` is null |
| `status` | `driver_document_status` | not null | | stored lifecycle status |
| `position` | `integer` | not null | | roster order, then the order within the driver's file |

- FK: `driver_documents_driver_fk (organization_id, driver_id) → drivers` ON DELETE CASCADE.
- Unique: `driver_documents_org_driver_type_uq (organization_id, driver_id, document_type)`.
- Index: `driver_documents_org_position_idx (organization_id, position)`.
- CHECK `driver_documents_missing_ck`: `(status = 'missing') = (expires_on is null)`.
- Labels: `document_type` cdl "CDL" · medical_card "Medical card" · mvr "MVR" · annual_review "Annual review" · drug_test "Drug test" · clearinghouse_query "Clearinghouse query". `status` valid "Valid" (Gr) · expiring "Expiring" (A) · expired "Expired" (A) · missing "Missing" (A). `expires_precision` day "Sep 20" · month "Apr 2028".

#### 5.11.3 `compliance_reminders`

The Drivers-tab "Compliance watchlist", kept as its own record list (design brief §2: Runtruck1 relabels, merges and hand-orders it, so it is not derived from `driver_documents`).

| column | type | null | default | notes |
|---|---|---|---|---|
| standard columns (§1.2) | | | | |
| `driver_id` | `uuid` | not null | | "Driver" |
| `item_label` | `text` | not null | | "Item": "CDL renewal", "Medical card", "Annual MVR review", "Clearinghouse query" |
| `due_on` | `date` | not null | | "Due" (month precision → the last day of the month) |
| `due_precision` | `date_precision` | not null | | `day` → F-SHORT, `month` → F-MONTHYEAR |
| `position` | `integer` | not null | | hand-authored list order |

- FK: `compliance_reminders_driver_fk (organization_id, driver_id) → drivers` ON DELETE CASCADE.
- Index: `compliance_reminders_org_position_idx (organization_id, position)`.
- Labels: `due_precision` day "Sep 20" · month "Jul 2026".

#### 5.11.4 `violations`

Safety › Violations: roadside inspection findings.

| column | type | null | default | notes |
|---|---|---|---|---|
| standard columns (§1.2) | | | | |
| `occurred_on` | `date` | not null | | "Date" (F-SHORT) |
| `driver_id` | `uuid` | not null | | "Driver" |
| `truck_id` | `uuid` | not null | | "Unit" |
| `violation_type` | `text` | not null | | "Type" ("Log form & manner") |
| `severity_points` | `smallint` | not null | | CSA severity weight, "Points" |
| `location` | `text` | not null | | "Location" ("I-70 POE · Loma, CO") |
| `status` | `violation_status` | not null | | stored lifecycle status |

- FKs: `violations_driver_fk (organization_id, driver_id) → drivers` and `violations_truck_fk (organization_id, truck_id) → trucks`, ON DELETE RESTRICT.
- Index: `violations_org_occurred_idx (organization_id, occurred_on DESC)`.
- CHECK `violations_points_ck`: `severity_points >= 0`.
- Labels: `status` open "Open" (A) · contested "Contested" (B) · closed "Closed" (G).

#### 5.11.5 `claims`

The Safety "Settlements" tab (route `/app/safety/settlements`): cargo and liability claims, not driver pay.

| column | type | null | default | notes |
|---|---|---|---|---|
| standard columns (§1.2) | | | | |
| `claim_number` | `integer` | not null | | human number, "CLM-1112"; counter key `claim` |
| `occurred_on` | `date` | not null | | "Date" |
| `driver_id` | `uuid` | not null | | "Driver" |
| `truck_id` | `uuid` | not null | | "Unit" = `<truck>` or `<truck> / <trailer>` |
| `trailer_id` | `uuid` | null | | |
| `load_id` | `uuid` | null | | the load, when known |
| `claim_type` | `claim_type` | not null | | "Type" |
| `claimant_kind` | `claimant_kind` | not null | | which claimant column applies |
| `claimant_customer_id` | `uuid` | null | | `customer` claimant |
| `claimant_facility_id` | `uuid` | null | | `facility` claimant |
| `claimant_name` | `text` | null | | `third_party` claimant ("R. Delgado"); personal data |
| `reserved_cents` | `integer` | not null | | "Reserved" |
| `paid_cents` | `integer` | not null | `0` | "Paid" ("—" when 0) |
| `status` | `claim_status` | not null | | stored lifecycle status |

- FKs (all `(organization_id, <x>_id)`, ON DELETE RESTRICT): `claims_driver_fk → drivers`, `claims_truck_fk → trucks`, `claims_trailer_fk → trailers`, `claims_load_fk → loads`, `claims_claimant_customer_fk → customers`, `claims_claimant_facility_fk → facilities`.
- Unique: `claims_org_number_uq (organization_id, claim_number)`.
- CHECK `claims_number_ck`: `claim_number > 0`.
- CHECK `claims_money_ck`: `reserved_cents >= 0 and paid_cents >= 0`.
- CHECK `claims_claimant_ck`: exactly the column of `claimant_kind` is set: `(claimant_kind = 'customer' and claimant_customer_id is not null and claimant_facility_id is null and claimant_name is null) or (claimant_kind = 'facility' and claimant_facility_id is not null and claimant_customer_id is null and claimant_name is null) or (claimant_kind = 'third_party' and claimant_name is not null and claimant_customer_id is null and claimant_facility_id is null)`.
- Labels: `claim_type` cargo_damage "Cargo damage" · property_damage "Property damage" · bodily_injury "Bodily injury" · cargo_shortage "Cargo shortage". `claimant_kind` customer → the customer's name · facility → the facility's name · third_party → "Third party · {claimant_name}". `status` open "Open" (A) · under_review "Under review" (B) · settled "Settled" (Gr) · denied "Denied" (G).

### 5.12 Planner (`planner.ts`)

The shared organization calendar (D8). Load-stop events are **computed** from `load_stops` (§6.4) and never stored. View preferences stay in the browser.

#### 5.12.1 `planner_color_codes`

What each calendar color means (Customize › Color codes, the legend, EventDialog "Color code").

| column | type | null | default | notes |
|---|---|---|---|---|
| standard columns (§1.2) | | | | |
| `key` | `text` | not null | | stable key used by the browser view preferences: `pickup`, `delivery`, `maintenance`, `driver`, `meeting`, `admin`, or `code-<uuid>` for added codes |
| `label` | `text` | not null | | "Loaded (pickup)" |
| `tone` | `planner_tone` | not null | | CSS class `t-<tone>` |
| `is_locked` | `boolean` | not null | `false` | the load board's two codes (`pickup`, `delivery`): cannot be deleted, always listed first |
| `position` | `integer` | not null | | list order after the locked codes |

- Unique: `planner_color_codes_org_key_uq (organization_id, key)`.
- Index: `planner_color_codes_org_position_idx (organization_id, position)`.
- Deleting an unlocked code (`planner.configure`) is one transaction: move its events to the first other unlocked code by `position` (refused when it is the last unlocked code), delete the code, audit. Deleting a locked code is refused.
- Labels: `tone` values are Runtruck1's `TONES` in order: amber, green, red, purple, blue, teal, pink, orange, indigo, slate.

#### 5.12.2 `planner_events`

Office events on the shared calendar: timed events (a day plus start and end time) and all-day events (optionally spanning to an inclusive `end_date`).

| column | type | null | default | notes |
|---|---|---|---|---|
| standard columns (§1.2) | | | | |
| `title` | `text` | not null | | |
| `color_code_id` | `uuid` | not null | | |
| `start_date` | `date` | not null | | org-local day |
| `end_date` | `date` | null | | all-day events only: inclusive last day, after `start_date` |
| `start_time` | `time` | null | | timed events: wall clock in `organizations.timezone` |
| `end_time` | `time` | null | | |
| `place` | `text` | null | | "City, ST" |
| `notes` | `text` | null | | |
| `people` | `text[]` | not null | `'{}'::text[]` | free-text attendee names in entry order; empty = none (Runtruck1's missing `people`) |
| `load_id` | `uuid` | null | | EventDialog "Related load" (a non-archived load; enforced by the API) |
| `created_by_user_id` | `uuid` | null | | FK → `users(id)` ON DELETE RESTRICT (`planner_events_created_by_user_id_users_id_fk`); null for seeded and reset rows |

- FKs: `planner_events_color_code_fk (organization_id, color_code_id) → planner_color_codes` and `planner_events_load_fk (organization_id, load_id) → loads`, ON DELETE RESTRICT.
- Indexes: `planner_events_org_start_idx (organization_id, start_date)`, `planner_events_org_color_code_idx (organization_id, color_code_id)`.
- CHECK `planner_events_time_ck`: `(start_time is null and end_time is null) or (start_time is not null and end_time is not null and end_time > start_time and end_date is null)`.
- CHECK `planner_events_end_date_ck`: `end_date is null or end_date > start_date`.
- CHECK `planner_events_span_ck`: `end_date is null or end_date - start_date <= 366` (migration `0003`). An all-day event spans at most 366 days, so the calendar range query can bound `start_date` from below (`start_date >= from − 366`) and the index serves both ends (docs/api/planner.md §3.1).
- **Reset calendar** (D8, `planner.reset`): one transaction deletes every `planner_events` row and then every `planner_color_codes` row of the organization and inserts **the organization's own defaults** per `organizations.planner_defaults` (§2.1): always the six codes of §7.24 (new ids); for `runtruck1_demo` also the 42 events of §7.25 (new ids, `created_by_user_id` null, the seeded `created_at` values). It writes one `PLANNER_RESET` audit row with the real counts. The seed, the test fixtures and the API share one function, `insertPlannerDefaults` (`packages/database/src/seed/demo/planner.ts`, exported from `@runtruck/database/seed`).

---

## 6. Derived values (rules the API computes)

Every value below is computed by the API from stored rows when it is requested (D5). Nothing here is stored. KPI figures ignore the search query `q` (Runtruck1's search never changes a KPI) and are returned in `meta.summary` of the list endpoint the screen already calls (design brief §3). Each rule names the columns it reads. "Seed" is the result against the seed of §7 with today = 2026-09-03; where it differs from Runtruck1 the Runtruck1 value is given too (collected in §8). Display strings use the formatters of §6.0.9; the wording of every note is Runtruck1's. Every list order given here ends with `id` as the final tie-breaker unless its last key is already unique (§1.10); counts and sums are over the organization's rows only.

### 6.0 Shared rules

#### 6.0.1 Clock and periods

| term | rule | seed |
|---|---|---|
| today | `ClockService.today(organizations.timezone)` (D4) | 2026-09-03, a Thursday |
| org week | Monday–Sunday containing today (§1.5) | 2026-08-31 … 2026-09-06 |
| previous org week | the org week before | 2026-08-24 … 2026-08-30 |
| YTD | January 1 of today's year … today, inclusive | 2026-01-01 … 2026-09-03 |
| current month | the calendar month of today | September 2026 ("September") |
| quarter start | first day of today's calendar quarter | 2026-07-01 |
| date of an instant | invoice, payment, activity and planner instants: the calendar date in `organizations.timezone`; stop instants (`arrived_at`, `completed_at`): the date in `load_stops.timezone` (`calendarDateIn`) | |
| day difference | whole calendar days between two `YYYY-MM-DD` dates (`daysBetween`) | |

#### 6.0.2 Minimal stored facts (D5)

Runtruck1 shows some figures that no ordinary record could produce. Each is backed by the smallest stored fact that makes it computable, seeded from Runtruck1's figures where they can be back-solved (design brief §2). No fact was added in this revision; they all exist in `0000_init`.

| fact | feeds | seeded from |
|---|---|---|
| `loads.empty_miles` | Dashboard "Deadhead miles" and its note (§6.2) | back-solved so that this week reads 7.8 % and last week 9.2 % (§7.12) |
| `loads.operating_cost_cents` | load "Margin" | back-solved exactly: rate − pay − margin (§7.12) |
| `loads.driver_pay_cents` / `carrier_rate_cents` | "Driver pay" / "Carrier cost", "Margin" | Runtruck1 `pay` |
| `load_stops.planned_start/planned_end` | planner load-stop event times | Runtruck1's hash-derived slots (`planner.ts:168-171`) |
| `driver_mileage_entries` | "Miles per driver, this week" | Runtruck1 `miles` |
| `drivers.hos_remaining_minutes` | "Hours left", "Hours at risk", Dashboard driver notes | Runtruck1 `hos` |
| `onboarding_cases.progress_percent`, `next_step`, `next_step_on` | Onboarding "Progress", "Next step" | Runtruck1 values |
| `onboarding_document_requests` | "Awaiting documents" and its note | Runtruck1 `docsPending` and `nextStep` text |
| `compliance_reminders` | Drivers "Compliance watchlist", "Docs to renew" | Runtruck1 `WATCHLIST` |
| `trailers.location_*` | trailer "Location", "rolling", "at the Modesto yard" | Runtruck1 `where` |
| `settlement_items` | settlement loads, miles, gross, deductions, net | Runtruck1 totals, split into items (§7.18) |
| stored lifecycle statuses (§1.7) | every status chip and the counts over them | Runtruck1 `status` |

#### 6.0.3 Load helpers

| term | rule (columns) |
|---|---|
| board load | `loads.archived_at is null` |
| active statuses | `needs_driver`, `dispatched`, `at_pickup`, `in_transit`, `delayed` (Runtruck1 `ACTIVE_STATUSES`) |
| delivered statuses | `needs_pod`, `delivered` |
| first pickup / last delivery | the `pickup` stop with the lowest `sequence` (else the lowest-sequence stop) / the `delivery` stop with the highest `sequence` (else the highest-sequence stop); Runtruck1 `toLoad` |
| live dispatch | the load's `dispatches` row with `status <> 'cancelled'` (at most one) |
| revenue(l) | `line_haul_cents + fuel_surcharge_cents + accessorial_cents` ("Total to customer"). In SQL cast before adding, `l.line_haul_cents::bigint + l.fuel_surcharge_cents + l.accessorial_cents`, so neither the per-row sum nor an aggregate over it can hit `integer out of range` (CHECK `loads_total_ck` also bounds each row). The same applies to margin (`revenue − pay − operating cost`, computed in `bigint`). |
| delivered_on(l) | for a load in a delivered status: the date of the last delivery's `completed_at` (stop timezone) when set, else its `appointment_date`; null otherwise |
| load_date(l) | the first pickup's `appointment_date`; for a load without stops, the smallest `invoices.issued_on` among invoices with an `invoice_items` row for the load; null otherwise |
| stop route label | with `facility_id`: `coalesce(market_city, city) + ", " + coalesce(market_state, state)` of the facility; without: `load_stops.city + ", " + load_stops.state` |
| route | first pickup label + " → " (U+2192) + last delivery label |
| stop short market | with `facility_id`: `coalesce(market_short, market_city, city)`; without: `load_stops.city` |
| stop address label | the non-null of `address_line1`, `city`, `state` joined ", ", then " " + `postal_code` when set ("4120 S Golden State Blvd, Fresno, CA"; fuel stop "Routed automatically on the lane") |
| "Pickup" / "Delivery" date | F-SHORT of the first pickup / last delivery `appointment_date` |
| driver label | live dispatch → the driver's employee full name, else `driver_name`, else "Unassigned" |
| unit label | live dispatch → the non-empty of (truck `unit_number` or `truck_number`, trailer `unit_number` or `trailer_number`) joined " / ", else "—"; the Loads table shows "Unassigned" when it is "—" |
| carrier | `carrier_id` null → "Not yet covered", "—", "—"; else `name` (+ " (own fleet)" when `is_own_fleet`), "MC " + `mc_number`, "DOT " + `dot_number` ("—" when null) |
| reference | `coalesce(tender_ref, customer_po, "—")` |
| temperature | `equipment_type = 'reefer_53'` → `Number(temperature_f) + " °F"`, or "Set at pickup" when null; otherwise "Ambient" |
| weight | F-INT(`weight_lb`) + " lb" |
| miles | F-INT(`loaded_miles`) when > 0, else "—" |
| rate per mile | `round(line_haul_cents / loaded_miles)` cents when `loaded_miles > 0`, else null; F-RPM; the Line haul tile note is `${F-RPM} / mi`, absent when null |
| pay | `carrier_rate_cents` when set (tile "Carrier cost"), else `driver_pay_cents` (tile "Driver pay"); null → "—" |
| margin | null when pay is null; else `revenue − pay − coalesce(operating_cost_cents, 0)`; F-SIGNED, null → "—" |

#### 6.0.4 Uninvoiced loads

A load (board or archived) is **uninvoiced** when its status is a delivered status and no `invoice_items` row references it (an item on an invoice of any status, draft included, counts). Its POD is **attached** when a `documents` row of type `proof_of_delivery` with status `attached` exists for it.

Verified against the seed (design brief §2): exactly Runtruck1's 11 rows. The delivered-status board loads L-40214 (INV-8841), L-40212 (INV-8840) and L-40210 (INV-8836) and the 12 invoice-only archived loads (§7.14) all have an item; L-40218 is in transit (its draft INV-8845 does not matter). No `billing_status` column is needed.

#### 6.0.5 Stop labels

- **Detail kind label** (from `kind` and `status`): pickup `pending` "Pickup", `arrived` "Pickup · at shipper", `completed` "Pickup · complete"; delivery `completed` "Delivery · complete", otherwise "Delivery"; fuel "Fuel stop". CSS modifier: `pickup`, `delivery`, none for fuel. The seeded stop statuses reproduce Runtruck1's literal labels, quirks included (§7.12).
- **Time line** (detail and Loads expand): `${F-SHORT(appointment_date)} · ${window}`, where `window` is `open–close` (en dash U+2013) when both ends are set, else the one that is set, else "Any time"; times are `HH:MM` wall clock in the stop's timezone, never converted. D7: seeded board loads read "Sep 3 · 08:00–14:00" where Runtruck1 read "Pickup Sep 3 · 08:00–14:00" / "Deliver Sep 4 · 06:00–12:00"; the fuel stop line "Sep 3 · 16:40" is identical.
- **Loads expand**: only pickup and delivery stops, in `sequence` order, heading "Stops (n)", each labelled `${"Pickup" | "Delivery"} · Stop ${i}` with `i` counted over the listed stops.

#### 6.0.6 Pay basis

`per_mile` → `"$" + (pay_rate_cents / 100).toFixed(2) + " / mi"` ("$0.62 / mi") · `percent_of_line_haul` → `pay_percent_bp / 100 + "% of line haul"` ("25% of line haul") · `annual_salary` → F-MONEY(`pay_rate_cents`) + " / yr" ("$68,000 / yr") · `hourly` → `"$" + (pay_rate_cents / 100).toFixed(2) + " / hr"` ("$34.50 / hr"). Read from `employee_contracts` (Contracts) and `settlements` (Payroll).

#### 6.0.7 Invoice helpers

| term | rule |
|---|---|
| net days | `net_15` 15 · `net_30` 30 · `net_45` 45 · `net_60` 60 · `quick_pay` 0 |
| due_on | written when the invoice is issued: `issued_on + net days(invoices.payment_terms)` (stored) |
| invoice total | Σ `invoice_items.amount_cents` |
| outstanding | invoice total − Σ `payments.amount_cents` |
| age | `today − issued_on` days; F-AGE ("41 d"), "—" when not issued |
| days past due | `today − due_on` |
| paid on | date of the latest `payments.received_at` (org timezone) |
| days to pay | `paid on − issued_on` |
| "Load" column | `load_number` of the item with `position = 1` |

#### 6.0.8 Other display compositions

Truck "Make / year" `${make} ${model} · ${model_year}`; "Plate" `${plate_state} ${plate_number}`; trailer "Type" `${type label} · ${length_ft} ft`; trailer "Location" per §5.5.4; claim "Unit" `truck` or `truck / trailer` unit numbers; claimant per §5.11.5; bill "Category" `category` or `${category} · ${description}`; batch "Sent to" the customer name or `${factoring company name} (factoring)`; work-order "Unit" the truck or trailer `unit_number`, "Due" F-SHORT(`due_on`) or F-INT(`due_odometer`) + " mi", "Shop" `${facility name} · ${facility city}`; onboarding "Next step" `next_step` + (" · " + F-SHORT(`next_step_on`) when set), "Owner" the owner employee's full name; every person's name is `first_name + " " + last_name` of the employee.

#### 6.0.9 Formatters

The web formats with `@runtruck/calculations` (`format.ts`, `dates.ts`): F-MONEY `formatMoney` ("$2,450"), F-SIGNED `formatSignedMoney` ("-$142", zero "—" where stated), F-K `formatMoneyK` ("$168K"), F-K1 `formatMoneyK1` ("$91.9K"), F-M1 `formatMoneyM1` ("$1.3M"), F-RPM `formatRatePerMile`, F-INT `formatInt`, F-SHORT `formatShortDate` ("Sep 3"), F-DATE `formatDate` ("Jan 12" this year, "Mar 14, 2022" otherwise), F-MONTHYEAR `formatMonthYear` ("Apr 2028"), F-MMYYYY `formatMmYyyy` ("04/2028"), F-AGE `formatAge`, F-HOS `formatHos` ("6h 20m"), `formatActivityTime` ("Today 07:12"), `formatLoadNumber` ("L-40218"; likewise "INV-", "B-", "CLM-"). Percentages are `Math.round` of the exact ratio unless stated. Empty-list notes use Runtruck1's text where it has one ("Nobody under 2h", "Bays clear", "Nothing due", "None pending", "None") and "None" elsewhere.

### 6.1 Shell

| value | rule | seed |
|---|---|---|
| Header action on Uninvoiced | `Invoice ${uninvoiced count} loads` (§6.0.4) | "Invoice 11 loads" |
| Sidebar / Settings › Profile | stored: `users.full_name`, `organization_members.title`, `organizations.name`, `users.email`, `organization_members.member_number`, `organizations.company_number`; initials = first letter of each word of the name | "Rosa Medina", "Dispatch · Sunridge Freight", "RM", "100482731", "30017" |

### 6.2 Dashboard (`GET /dashboard`)

| value | rule (columns) | seed | Runtruck1 |
|---|---|---|---|
| Active loads | count of board loads in an active status | 5 | |
| … note | `delta = value − activeOn(today − 7)`, where `activeOn(D)` = count of loads (board or archived) whose first pickup `appointment_date ≤ D ≤` last delivery `appointment_date` (loads without stops never count); `${delta >= 0 ? "+" : ""}${delta} vs. last week` | activeOn(2026-08-27) = 3 (L-40205, L-40200, L-40199) → "+2 vs. last week" | "+4 vs. last week" |
| Revenue this week | Σ revenue(l) over loads (board or archived) whose delivered_on is in the org week; F-K | 2,468,000 → "$25K" | "$168K" |
| … note | `p = (this − prev) / prev × 100`, `prev` = the same sum over the previous org week, rounded half away from zero to 0.1; `${p >= 0 ? "+" : ""}${p.toFixed(1)}%`; "—" when `prev = 0` | prev 1,796,000 → "+37.4%" | "+9.2%" |
| Deadhead miles | over loads whose first pickup `appointment_date` is in the org week and whose `loaded_miles` and `empty_miles` are both set: `pct = round1(100 × Σ empty_miles / Σ (loaded_miles + empty_miles))`, `${pct.toFixed(1)}%`; "—" when there is no such load | L-40218, -19, -20, -14, -12, -22: 258 / 3,312 → "7.8%" | same |
| … note | `d = prevPct − pct` (previous org week, same rule); `${abs(d).toFixed(1)} pts ${d >= 0 ? "better" : "worse"}`; "—" when either week has no data | L-40210: 116 / 1,258 → 9.2 → "1.4 pts better" | same |
| Unbilled loads | uninvoiced count (§6.0.4) | 11 | |
| … note | `${F-MONEY(Σ revenue of the uninvoiced loads)} waiting` | 3,490,000 → "$34,900 waiting" | |
| Active loads table | board loads in an active status, board order (§6.3), first 6; with a search, the first 6 matching board loads | L-40218, L-40219, L-40220, L-40221, L-40222 | |
| Revenue chart | for each date D from today − 7 to today − 1: label = the en-US short weekday of D; value = Σ revenue(l) over loads with delivered_on = D; bar height `round(v / max × 100)%`; bars equal to the max use `var(--ui-primary)`, the others `var(--ui-primary-soft)`; all heights 0% when max = 0 | table below | |
| Drivers card | every driver in roster order (`drivers.position`); `on_duty` → `On duty · ${F-HOS(hos_remaining_minutes)} left`, otherwise the duty label; dot `on_duty` primary, `available` green, else muted | Marcus Hale "On duty · 6h 20m left", Dara Whitfield "On duty · 9h 05m left", Ellis Nakamura "On duty · 1h 45m left", Priya Raman "Available", Ana Cortez "Available", Tobias Frey "Home time" | |

Revenue chart against the seed (the loads delivered that day in brackets):

| date | label | revenue (cents) | height | Runtruck1 height |
|---|---|---|---|---|
| 2026-08-27 | Thu | 441,000 (L-40199) | 42% | 57% |
| 2026-08-28 | Fri | 305,000 (L-40200) | 29% | 78% |
| 2026-08-29 | Sat | 276,000 (L-40201) | 26% | 69% |
| 2026-08-30 | Sun | 774,000 (L-40205, L-40202) | 74% | 89% |
| 2026-08-31 | Mon | 486,000 (L-40204, L-40203) | 46% | **100%** (highlighted) |
| 2026-09-01 | Tue | 930,000 (L-40206, L-40212, L-40210) | 88% | 51% |
| 2026-09-02 | Wed | 1,052,000 (L-40209, L-40208, L-40207, L-40214) | **100%** (highlighted) | 39% |

The labels Thu … Wed equal Runtruck1's `REVENUE_DAYS`. The previous org week (for the note) is Aug 27 441,000 + Aug 28 305,000 + Aug 29 276,000 + Aug 30 774,000 = 1,796,000; this week is Aug 31 + Sep 1 + Sep 2 = 2,468,000 (nothing is delivered on Sep 3).

### 6.3 Loads board and load detail (`GET /loads`, `GET /loads/by-number/:loadNumber`)

- **Board rows**: board loads ordered `created_at DESC, load_number DESC`. Tabs: Active = active statuses, Needs POD = `needs_pod`, Delivered = `delivered`, All = every board load. Card title `${n} loads` (Runtruck1 grammar, "1 loads"), or `${n} matching “${q}”` when searching.
- **KPIs** (board loads): Undispatched = count `needs_driver` → 1; In transit = count `in_transit` (Delayed not counted) → 1; Delivered = count `delivered` → 2; Needs POD = count `needs_pod` → 1. Tabs: Active 5, Needs POD 1, Delivered 2, All 8. All as Runtruck1.
- **Row and detail values** (§6.0.3), identical to Runtruck1:

| load | route | pickup | delivery | driver | unit | rate | miles | rpm | pay | margin | status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| L-40218 | Fresno, CA → Reno, NV | Sep 3 | Sep 4 | Marcus Hale | T-114 / RF-88 | $2,450 | 478 | $5.13 | $612 | $1,214 | In transit |
| L-40219 | Stockton, CA → Salt Lake City, UT | Sep 3 | Sep 5 | Dara Whitfield | T-107 / DV-51 | $3,180 | 736 | $4.32 | $795 | $1,540 | At pickup |
| L-40220 | Sacramento, CA → Boise, ID | Sep 2 | Sep 4 | Ellis Nakamura | T-121 / FB-12 | $2,910 | 602 | $4.83 | $728 | $1,388 | Delayed |
| L-40221 | Oakland, CA → Portland, OR | Sep 4 | Sep 6 | Unassigned | — | $3,540 | 632 | $5.60 | — | — | Needs driver |
| L-40214 | Bakersfield, CA → Phoenix, AZ | Sep 1 | Sep 2 | Priya Raman | T-103 / RF-27 | $1,980 | 389 | $5.09 | $495 | $986 | Needs POD |
| L-40212 | Los Angeles, CA → Las Vegas, NV | Aug 31 | Sep 1 | Marcus Hale | T-114 / DV-88 | $1,640 | 271 | $6.05 | $410 | $842 | Delivered |
| L-40210 | Modesto, CA → Denver, CO | Aug 29 | Sep 1 | Tobias Frey | T-118 / DV-14 | $4,120 | 1,142 | $3.61 | $1,030 | $1,904 | Delivered |
| L-40222 | Redding, CA → Seattle, WA | Sep 5 | Sep 6 | Ana Cortez | T-109 / FB-04 | $2,760 | 578 | $4.78 | $690 | $1,312 | Dispatched |

- **Detail page**: heading = route; subline `Load ${L-n} · ${customer name} · ${status label}`; tiles Miles, Line haul (note rpm), Driver pay / Carrier cost, Margin; "Freight & pay" rows Mode (only when `mode` is set), Commodity, Weight, Equipment, Temperature, Reference, LTL (only for `ltl`: `Class ${freight_class} · ${handling_units} ${packaging label lower-cased}` then the service labels, joined " · "); "Carrier" rows Carrier, MC #, DOT # (+ "Carrier rate" F-MONEY(`carrier_rate_cents`) when set); "Stops" every stop in `sequence` (§6.0.5); "Documents" the load's `documents` by `position`, label + status chip; "Activity" the `load_activity` rows by `sequence` (§5.6.4).
- **New Load option lists**: customers, partner carriers (`is_own_fleet` false) and trailers by `position`, drivers by `drivers.position`, trucks by `unit_number` (Runtruck1's constant orders).
- Whether the detail page resolves an **archived** load number or falls back to the first board load as Runtruck1 does for numbers not on its board (D6) is specified in [api/loads.md](api/loads.md); archived loads have only the rows of §7.13–§7.14.

### 6.4 Planner (`GET /planner/events`, `/planner/color-codes`)

- **Load-stop events** (never stored): one per `pickup` and `delivery` stop (fuel excluded) of every board load. Title `${L-n} · ${stop route label}`; color code `pickup` or `delivery`; date `appointment_date`; time = the planned slot when set, else the window when both `window_open` and `window_close` are set, else **08:00–09:00** (Runtruck1's rule for created stops, including a single-bound window or "Any time"); `place` = stop route label; facility = `facility_name`; notes `${facility_name} · ${customer name}`; customer, driver label, truck = unit label ("" when "—"), commodity; people = [driver label]; read-only. Times are wall clock of the stop's timezone, drawn as they are.
- Seed: 16 events, all as Runtruck1 —

| load | pickup event | delivery event |
|---|---|---|
| L-40218 | Sep 3 10:30–12:30 "L-40218 · Fresno, CA" | Sep 4 16:00–18:00 "L-40218 · Reno, NV" |
| L-40219 | Sep 3 12:00–14:00 "… · Stockton, CA" | Sep 5 08:30–10:30 "… · Salt Lake City, UT" |
| L-40220 | Sep 2 13:30–15:30 "… · Sacramento, CA" | Sep 4 13:00–15:00 "… · Boise, ID" |
| L-40221 | Sep 4 15:00–17:00 "… · Oakland, CA" | Sep 6 17:30–19:30 "… · Portland, OR" |
| L-40214 | Sep 1 15:00–17:00 "… · Bakersfield, CA" | Sep 2 10:00–12:00 "… · Phoenix, AZ" |
| L-40212 | Aug 31 12:00–14:00 "… · Los Angeles, CA" | Sep 1 13:00–15:00 "… · Las Vegas, NV" |
| L-40210 | Aug 29 09:00–11:00 "… · Modesto, CA" | Sep 1 16:00–18:00 "… · Denver, CO" |
| L-40222 | Sep 5 06:00–08:00 "… · Redding, CA" | Sep 6 10:00–12:00 "… · Seattle, WA" |

- **Office events**: `planner_events` rows overlapping the requested range (an all-day event covers `start_date … coalesce(end_date, start_date)`).
- **"N events this month"** (web, over the events the API returned): events whose start date is in the cursor month after the view filters. Seed, September 2026 with defaults: 21 standups + 15 office events + 14 stop events = 50 (August: 6 + 2 = 8), as Runtruck1.
- **Color codes** order: `is_locked DESC, position, id` → Loaded (pickup), Empty (delivery), Maintenance, Driver schedule, Meetings, Billing & admin.
- **EventDialog "Related load"** options: board loads in board order, `${L-n} · ${route}`.

### 6.5 CRM (`GET /customers`)

Per customer, over **all** its loads (board and archived):

| column | rule (columns) |
|---|---|
| Primary contact | `customer_contacts.full_name` of the `is_primary` contact |
| Loads YTD | count of the customer's loads whose load_date (§6.0.3) is in YTD |
| Revenue | Σ revenue(l) over those loads; F-K |
| On time | `round(100 × (n − late) / n)` + "%" over those `n` loads, "—" when `n = 0`; a load is **late** when `status = 'delayed'`, or when its last delivery has `arrived_at` later than `appointment_date` + `coalesce(window_close, '23:59')` in the stop's timezone |
| Terms | `customers.payment_terms` label |
| AR balance | Σ outstanding (§6.0.7) of the customer's invoices in status `sent` or `overdue`; F-MONEY |
| Standing | `customers.standing` chip |

Rows in `position` order. Seed (Runtruck1 in brackets):

| customer | Loads YTD | Revenue | On time | AR balance |
|---|---|---|---|---|
| Northgate Foods | 5 (184) | 1,131,000 "$11K" ($412K) | 100% (96%) | $1,980 ($18,400) |
| Bayline Distribution | 5 (151) | 1,480,000 "$15K" ($338K) | 100% (94%) | $1,640 ($12,900) |
| Cascade Building Supply | 6 (77) | 1,713,000 "$17K" ($196K) | 83%, L-40220 delayed (91%) | $8,550 ($21,300) |
| Harbor Point Retail | 3 (44) | 913,000 "$9K" ($121K) | 100% (89%) | $2,180 ($6,100) |
| Sierra Ag Partners | 5 (62) | 1,820,000 "$18K" ($154K) | 100% (82%) | $7,980 ($29,300) |
| Vantage Home Goods | 5 (29) | 1,303,000 "$13K" ($74K) | 100% (93%) | $3,850 (same) |

The YTD loads are: Northgate L-40218, L-40214, L-40209, L-40203, L-40187; Bayline L-40219, L-40212, L-40208, L-40202, L-40183; Cascade L-40220, L-40207, L-40201, L-40198, L-40196, L-40176 (L-40222 picks up Sep 5, after today); Harbor Point L-40206, L-40191, L-40178 (L-40221 picks up Sep 4); Sierra L-40210, L-40205, L-40200, L-40190, L-40168; Vantage L-40204, L-40199, L-40197, L-40189, L-40172.

| KPI | rule | seed | Runtruck1 |
|---|---|---|---|
| Accounts | count of customers | 6 | |
| … note | `${count of standing key_account} key accounts` | "2 key accounts" | |
| Revenue YTD | Σ of the customers' Revenue; F-M1 | 8,360,000 → "$0.1M" | "$1.3M" |
| … note | `Top 3 accounts = ${round(100 × Σ of the three largest customer revenues / total)}%` (ties by `position`; "0%" when the total is 0) | Sierra + Cascade + Bayline = 5,013,000 → "Top 3 accounts = 60%" | "= 73%" |
| On time | `round(100 × Σ (n − late) / Σ n)` + "%" over all customers ("Weighted by loads") | 28 / 29 → "97%" | "92%" |
| Open AR | Σ AR balances; F-K1 | 2,618,000 → "$26.2K" | "$91.9K" |
| … note | `${count of standing at_risk} account at risk` | "1 account at risk" | |

**Top account cards**: customers with standing `key_account` or `at_risk`, key accounts first, then by `position`; the first 3 → Northgate Foods, Bayline Distribution, Sierra Ag Partners (Runtruck1's `TOP_ACCOUNTS`). Card: the standing label, the name, `${contact name} · ${contact email}` (the name alone when there is no email), and the row's Loads YTD, Revenue and On time: Northgate 5 / "$11K" / 100%, Bayline 5 / "$15K" / 100%, Sierra 5 / "$18K" / 100% (Runtruck1 184/$412K/96%, 151/$338K/94%, 62/$154K/82%).

### 6.6 Fleet (`GET /drivers`, `/trucks`, `/trailers`)

**Drivers.** Rows in `drivers.position` order; the tabs All / On duty / Available filter on `duty_status`.

| column | rule (columns) |
|---|---|
| Unit | `unit_number` of the truck whose `assigned_driver_id` is the driver, else "—" |
| Current load | (1) the driver's live dispatch on a board load in status `at_pickup`, `in_transit` or `delayed` → `${L-n} · ${first pickup short market} → ${last delivery short market}`; (2) else one on a board load in status `dispatched` → `${L-n} · ${F-SHORT(first pickup appointment_date)}`; (3) else "—". Several candidates: the earliest first-pickup date, then the lowest load number |
| Hours left | F-HOS(`hos_remaining_minutes`), "—" when null |
| CDL | F-MMYYYY of the driver's `driver_documents` `cdl` `expires_on`, "—" when missing |
| Pay YTD | F-MONEY(Σ `settlement_items.amount_cents` of kind `line_pay` over the driver's settlements with `period_start` in YTD, any status) |
| miles (bar card) | Σ `driver_mileage_entries.miles` with `recorded_on` in the org week |

| driver | status | unit | current load | hours left | CDL | Pay YTD (Runtruck1) | week miles | bar |
|---|---|---|---|---|---|---|---|---|
| Marcus Hale | On duty | T-114 | L-40218 · Fresno → Reno | 6h 20m | 04/2028 | $1,326 ($61,400) | 2,140 | 100% |
| Dara Whitfield | On duty | T-107 | L-40219 · Stockton → SLC | 9h 05m | 11/2027 | $1,188 ($58,900) | 1,980 | 93% |
| Ellis Nakamura | On duty | T-121 | L-40220 · Sacramento → Boise | 1h 45m | 02/2027 | $1,455 ($55,120) | 1,760 | 82% |
| Priya Raman | Available | T-103 | — | 11h 00m | 07/2026 | $824 ($52,480) | 1,420 | 66% |
| Ana Cortez | Available | T-109 | L-40222 · Sep 5 | 11h 00m | 09/2029 | $684 ($48,300) | 1,180 | 55% |
| Tobias Frey | Home time | T-118 | — | — | 01/2028 | $0 ($63,750) | 640 | 30% |

| KPI / card | rule | seed |
|---|---|---|
| On the roster | count of drivers; note `${on_duty} on duty · ${roster − on_duty − available} home time` | 6, "3 on duty · 1 home time" |
| Available now | count `available`; note "Both reset today" (Runtruck1's static caption) | 2 |
| Hours at risk | `on_duty` drivers with `hos_remaining_minutes < 120`; note `${last_name} · ${F-HOS}` joined ", ", or "Nobody under 2h" | 1, "Nakamura · 1h 45m" |
| Docs to renew | count of `compliance_reminders`; note "On the watchlist below" | 4 |
| Miles per driver, this week | bars `round(m / max × 100)%`, opacity 1 for the max and 0.55 otherwise; action `${F-INT(Σ)} mi total` | "9,120 mi total" |
| Compliance watchlist | `compliance_reminders` by `position`: driver name, `item_label`, due (F-SHORT for `day`, F-MONTHYEAR for `month`) | Priya Raman · CDL renewal · Jul 2026; Ellis Nakamura · Medical card · Oct 12; Ana Cortez · Annual MVR review · Sep 24; Marcus Hale · Clearinghouse query · Sep 20 |

All drivers values except Pay YTD are as Runtruck1.

**Trucks.** Rows by `unit_number` (T-103, T-107, T-109, T-114, T-118, T-121); columns per §5.5.3 and §6.0.8. KPIs, all as Runtruck1:

| KPI | rule | seed |
|---|---|---|
| Power units | count; note `Avg ${round(avg odometer_miles / 1000)}K mi` | 6, "Avg 380K mi" (2,278,140 / 6) |
| In service | count `in_service`; note `Of ${count} units` | 4, "Of 6 units" |
| In shop | count `in_shop`; note `${unit numbers joined ", "} · turbo` (" · turbo" is Runtruck1's literal caption, D6), or "Bays clear" | 1, "T-118 · turbo" |
| Service due | count `service_due`; note `${unit} in ${F-INT(next_service_miles − odometer_miles)} mi` joined ", ", or "Nothing due" | 1, "T-114 in 900 mi" |

**Trailers.** Rows by `position`. KPIs, all as Runtruck1:

| KPI | rule | seed |
|---|---|---|
| Trailers | count; note `${reefer} reefer · ${dry_van} dry van · ${flatbed} flatbed` | 8, "3 reefer · 3 dry van · 2 flatbed" |
| Loaded | count `loaded`; note `${loaded and en_route} rolling · ${loaded − rolling} at shippers` | 4, "1 rolling · 3 at shippers" |
| Empty | count `empty`; note `${empty and location_kind yard} at the Modesto yard` (literal wording) | 3, "2 at the Modesto yard" |
| Inspection | count `inspection`; note `${unit numbers} · annual DOT` (literal suffix), or "None pending" | 1, "FB-12 · annual DOT" |

### 6.7 Accounting

#### 6.7.1 Uninvoiced (`GET /billing/uninvoiced-loads`)

Rows: uninvoiced loads (§6.0.4) ordered `delivered_on DESC, load_number DESC`; Route, Delivered = F-SHORT(delivered_on), POD chip, Amount = F-MONEY(revenue). The 11 rows and their order are Runtruck1's (§7.13). KPIs, all as Runtruck1:

| KPI | rule | seed |
|---|---|---|
| Loads | count; note "Delivered, not yet invoiced" | 11 |
| Amount waiting | F-MONEY(Σ revenue); note `Across ${distinct customers} customers` | "$34,900", "Across 6 customers" |
| Missing POD | count without an attached POD; note "Cannot invoice until attached" | 3 (L-40207, L-40204, L-40200) |
| Oldest (days) | the row with the largest `today − delivered_on` (the first in row order on ties); value `String(days)`; note `${L-n} · delivered ${F-SHORT(delivered_on)}` | "7", "L-40199 · delivered Aug 27" |

#### 6.7.2 Invoiced (`GET /invoices?status=sent`)

Rows: invoices in status `sent`, ordered `issued_on DESC, invoice_number ASC` → INV-8844 (1 d), INV-8841 (2 d), INV-8842 (2 d), INV-8840 (3 d), INV-8829 (18 d), as Runtruck1. Amount = invoice total; Age §6.0.7.

KPI tiles = **AR aging** over invoices in status `sent` or `overdue`, bucketed by days past due (§6.0.7): "Current" ≤ 0, "1–30 days" 1–30, "31–60 days" 31–60, "60+ days" > 60. Value F-MONEY(Σ outstanding); note `${n} invoices`, and `${n} invoices · collections` for 60+ (no pluralisation, D6).

| tile | seed | Runtruck1 |
|---|---|---|
| Current | "$11,520", "5 invoices" (8841, 8840, 8829, 8844, 8842) | "$96,400", "32 invoices" |
| 1–30 days | "$13,070", "4 invoices" (8836 11 d, 8821 6 d, 8819 5 d, 8811 7 d past due) | "$41,200", "14 invoices" |
| 31–60 days | "$1,590", "1 invoices" (8815, 33 d) | "$18,750", "5 invoices" |
| 60+ days | "$0", "0 invoices · collections" | "$7,900", "2 invoices · collections" |

#### 6.7.3 Batches (`GET /invoice-batches`)

Rows ordered `batch_number DESC`; Invoices = count of the batch's `invoice_batch_items`; Total = Σ invoice totals of those invoices; Sent to §6.0.8.

| batch | created | invoices (Runtruck1) | total (Runtruck1) | sent to | status |
|---|---|---|---|---|---|
| B-2035 | Sep 3 | 2 | $4,430 | Northgate Foods | Ready |
| B-2034 | Sep 2 | 3 | $8,550 ($8,120) | Cascade Building Supply | Ready |
| B-2033 | Sep 1 | 2 | $4,940 | TriPoint Capital (factoring) | Sent |
| B-2032 | Aug 29 | 2 (4) | $4,820 ($11,310) | Bayline Distribution | Sent |
| B-2031 | Aug 26 | 2 (3) | $5,590 ($7,670) | Harbor Point Retail | Sent |
| B-2030 | Aug 22 | 0 (5) | $0 ($14,230) | TriPoint Capital (factoring) | Settled |
| B-2029 | Aug 19 | 1 (3) | $2,450 ($8,410) | Northgate Foods | Settled |

| KPI | rule | seed | Runtruck1 |
|---|---|---|---|
| Batches | count; note `${Σ invoice counts} invoices` | 7, "12 invoices" | "22 invoices" |
| Ready to send | count `ready`; note `${F-MONEY(Σ ready totals)} to go out` | 2, "$12,980 to go out" | "$12,550 to go out" |
| Sent this week | count `sent` with `today − created_on < 7`; note "Last 7 days" | 2 (B-2033, B-2032) | |
| Total batched | F-MONEY(Σ all totals); note "Ready, sent and settled" | "$30,780" | "$59,110" |

#### 6.7.4 Past Due (`GET /invoices?status=overdue`)

Rows: status `overdue`, ordered `issued_on ASC, invoice_number ASC` → INV-8811 (67 d), INV-8815 (63 d), INV-8819 (50 d), INV-8836 (41 d), INV-8821 (36 d). KPIs, all as Runtruck1:

| KPI | rule | seed |
|---|---|---|
| Overdue invoices | count; note "Past terms" | 5 |
| Amount overdue | F-MONEY(Σ outstanding); note `${count with age > 60} in collections (60+ days)` (age from issue, Runtruck1's rule) | "$14,660", "2 in collections (60+ days)" |
| Oldest | the row with the largest age (first in row order on ties); value F-AGE; note `${INV-n} · ${customer}` | "67 d", "INV-8811 · Sierra Ag Partners" |
| Accounts affected | distinct customers; note `of ${count of customers} accounts` | 4, "of 6 accounts" |

#### 6.7.5 Paid (`GET /invoices?status=paid`)

Rows: status `paid`, ordered by the latest `payments.received_at DESC`, then `invoice_number ASC`; Paid = F-SHORT(paid on); Via = the latest payment's method; Days to pay §6.0.7. Seed, as Runtruck1: INV-8823 Aug 5 → Sep 3, Check, 29; INV-8824 Aug 7 → Sep 2, ACH, 26; INV-8838 Aug 28 → Sep 2, Factoring, 5; INV-8839 Aug 29 → Sep 1, Factoring, 3; INV-8830 Aug 18 → Sep 1, ACH, 14.

| KPI | rule | seed |
|---|---|---|
| Paid this month | rows whose paid on is in the current month; note = the month's English name | 5, "September" |
| Amount | F-MONEY(Σ `payments.amount_cents` received in the current month); note "Collected this month" | "$13,980" |
| Avg days to pay | `round(Σ days to pay / max(n, 1))` over **all** rows; note "Issued to paid" | 15 (77 / 5) |
| Paid via factoring | rows whose latest payment is `factoring`; note `${distinct factoring company names joined ", "} · ${F-MONEY(Σ their amounts)}` ("—" for the names when none) | 2, "TriPoint Capital · $4,940" |

#### 6.7.6 Payroll (`GET /settlements?periodStart=`, `POST /settlements/approve`)

The period is the settlement period containing today (`period_start ≤ today ≤ period_end`), else the latest `period_start ≤ today` → 2026-09-01. Rows: its settlements ordered by `drivers.position`. Per row: Basis §6.0.6; Loads = count of `line_pay` items; Miles = F-INT(Σ their `miles`); Gross = Σ `line_pay` amounts; Deductions = Σ `deduction` amounts, F-SIGNED with 0 → "—"; Net = gross + deductions; Status chip. **Approved view** (Runtruck1's `approved` flag) = no row is `ready` and at least one is `approved`.

| driver | basis | loads | miles | gross | deductions | net | status |
|---|---|---|---|---|---|---|---|
| Marcus Hale | $0.62 / mi | 4 | 2,140 | $1,326 | -$142 | $1,184 | Ready |
| Dara Whitfield | $0.60 / mi | 3 | 1,980 | $1,188 | -$96 | $1,092 | Ready |
| Ellis Nakamura | 25% of line haul | 3 | 1,760 | $1,455 | -$210 | $1,245 | Hold · fuel |
| Priya Raman | $0.58 / mi | 2 | 1,420 | $824 | -$64 | $760 | Ready |
| Ana Cortez | $0.58 / mi | 2 | 1,180 | $684 | — | $684 | Paid |

| KPI | rule | seed |
|---|---|---|
| Drivers | count of rows; note `${count ready} ready to approve`, or "Approved for payment" in the approved view | 5, "3 ready to approve" |
| Gross | F-MONEY(Σ gross of every row, any status); note `Week of ${F-SHORT(period_start)}` | "$5,477", "Week of Sep 1" |
| Deductions | F-MONEY(abs(Σ deductions)); note "Fuel advances and escrow" (static caption) | "$512" |
| Net payable | F-MONEY(Σ net); note "Awaiting approval", or "Approved" in the approved view | "$4,965" |
| Card title / footer | `Driver settlements · week of ${F-SHORT(period_start)}`; `Net payable this week ${F-MONEY(Σ net)}` | "Driver settlements · week of Sep 1", "$4,965" |

All as Runtruck1. "Approve all" / "Run settlements" moves every `ready` row of the period to `approved` (`approved_at`, `approved_by_user_id`), after which the three rows read "Approved" and the notes switch.

#### 6.7.7 Bills (`GET /bills`)

Rows ordered `due_on ASC, id`; Category §6.0.8; Due F-SHORT. KPIs, all as Runtruck1:

| KPI | rule | seed |
|---|---|---|
| Due this week | status `due` and `due_on − today ≤ 7`; note F-MONEY(Σ) | 3, "$15,000" |
| Overdue | status `overdue`; note F-MONEY(Σ) | 1, "$486" |
| Scheduled | status `scheduled`; note `${F-MONEY(Σ)} · auto-pay` | 2, "$10,360 · auto-pay" |
| Paid this month | status `paid` and `paid_on` in the current month; note F-MONEY(Σ) | 2, "$4,115" |

### 6.8 HR (`GET /hr/contracts`, `/hr/onboarding`)

**Employee Contracts.** Rows by `position`; Start and Renews F-DATE; Pay basis §6.0.6. KPIs, all as Runtruck1:

| KPI | rule | seed |
|---|---|---|
| Active contracts | count `active`; note `${count} on file` | 6, "10 on file" |
| Renewals due (30 d) | count `renewal_due`; note: those contracts by `renews_on`, `${last_name} ${F-DATE(renews_on)}` joined " · " ("None" when empty) | 2, "Raman Sep 20 · Nakamura Oct 1" |
| Owner-operators | count with role `owner_operator`; note `${last_name} · ${contract type label lower-cased} ends ${F-DATE(renews_on)}` joined ", " | 1, "Frey · lease-purchase ends Nov 15" |
| Drafts | count `draft`; note `${last_name} · starts ${F-DATE(starts_on)}` joined ", " | 1, "Reed · starts Sep 8" |

**Onboarding.** Rows by `position`; Started F-SHORT; Owner; Progress `${progress_percent}%`; Next step §6.0.8. KPIs, all as Runtruck1:

| KPI | rule | seed |
|---|---|---|
| In progress | count with stage ≠ `complete`; note `${count orientation} in orientation` | 5, "1 in orientation" |
| Starting this week | count with `started_on` in the org week; note `Opened since Mon ${F-SHORT(org week start)}` | 2 (Kevin Brandt, Maya Patel), "Opened since Mon Aug 31" |
| Awaiting documents | cases with a `pending` request; note: each such case's lowest-position pending `label`, cases in `position` order, joined " · " | 2, "MVR consent · medical card" |
| Completed this quarter | stage `complete` and `completed_on ≥` quarter start; note `Since ${F-SHORT(quarter start)}` | 1 (Evan Brooks), "Since Jul 1" |

### 6.9 Safety (`GET /work-orders`, `/driver-documents`, `/violations`, `/claims`)

All values in this section are as Runtruck1.

**Maintenance.** Rows by `position`.

| KPI | rule | seed |
|---|---|---|
| Open work orders | count with status ≠ `done`; note `${count done with completed_on ≥ today − 30} done · last 30 d` | 7, "1 done · last 30 d" |
| In shop | count `in_shop`; note the distinct shop labels in row order joined ", ", or "None" | 2, "Sunridge shop · Modesto" |
| Overdue | count `overdue`; note `${unit} · ${item}` joined ", ", or "None" | 1, "T-121 · Brake adjustment" |
| Est. cost open | F-MONEY(Σ `estimate_cents` with status ≠ `done`); note "Parts & labor, open orders" | "$7,115" |

**Driver Documents.** Rows by `position`; Expires per §5.11.2.

| KPI | rule | seed |
|---|---|---|
| Documents | count; note `${distinct drivers} drivers on file` | 15, "6 drivers on file" |
| Expiring (60 d) | count `expiring`; note `Renew before ${F-SHORT(today + 60)}` | 4, "Renew before Nov 2" |
| Expired | count `expired`; note `${driver} · ${document label}` joined ", ", or "None" | 1, "Priya Raman · CDL" |
| Missing | count `missing`; same note form | 1, "Tobias Frey · Drug test" |

**Violations.** Rows ordered `occurred_on DESC, id`; Unit = truck `unit_number`.

| KPI | rule | seed |
|---|---|---|
| Open | count `open`; note "Corrective action pending" | 2 |
| Points (12 mo) | Σ `severity_points` with `occurred_on` after today minus one year (> 2025-09-03); note `CSA severity · ${count in that window} violations` | 29, "CSA severity · 7 violations" |
| Contested | count `contested`; note "DataQ challenge filed" | 1 |
| Closed | count `closed`; note "Resolved, on file" | 4 |

**Claims.** Rows ordered `claim_number DESC`; Reserved F-MONEY; Paid F-MONEY or "—" when 0.

| KPI | rule | seed |
|---|---|---|
| Open claims | count `open` + `under_review`; note `${count under_review} under review` | 2, "1 under review" |
| Reserved | F-MONEY(Σ `reserved_cents` of `open` + `under_review`); note "On open claims" | "$11,000" |
| Paid YTD | F-MONEY(Σ `paid_cents` where `paid_cents > 0` and `occurred_on` in YTD); note `${that count} settlements` | "$24,025", "3 settlements" |
| Settled | count `settled`; note `${count denied} denied` | 3, "1 denied" |

---

## 7. Seed mapping

`seedDemo` (`packages/database/src/seed/`) inserts, in one transaction, exactly the rows below for **Sunridge Freight**: every record of Runtruck1's `app/src/data/*.ts` (01 §4) plus the D7 rows Runtruck1 synthesised for its board loads. Conventions:

- Unless a column is listed, it takes its default (`id`, `created_at`, `updated_at`, booleans, `'{}'` arrays) or null. Every `organization_id` is the seeded organization.
- Money is cents. Dates are 2026 unless written in full. Instants are given in UTC with the organization's time (America/Los_Angeles, UTC−7 on these dates) in brackets.
- A stop's `timezone` is its facility's; a stop without a facility (fuel) uses the organization's.
- Nothing is audited: the seed writes no `audit_logs` or `events` rows (it is the initial state, not a user action), and seeded `load_activity`, `loads`, `dispatches`, `document_versions` and `planner_events` rows have null user columns.
- Attached seeded documents get one version whose object is a fixed placeholder PDF (the same bytes for every version) at the version's `storage_key` (design brief §3); `mime_type` `application/pdf`, `size_bytes` and `checksum_sha256` from those bytes, `uploaded_at` = the document's `attached_at`. **Status: metadata only — the objects are not written yet.** `packages/database` has no S3 client (`@aws-sdk/client-s3`, [13 §2](13-document-system.md)), so every seeded version currently points at a missing object. Required, and tracked in 13 §7: after the seed transaction commits, `pnpm db:seed`, `pnpm db:reset` and the test/e2e fixtures put `PLACEHOLDER_PDF` at every seeded `storage_key` (idempotent overwrite) in `S3_BUCKET`, and a test heads each key.

### 7.0 Record count per Runtruck1 constant

| constant (file) | records | rows |
|---|---|---|
| `USER` (mock.ts) | 1 | organizations 1, users 1, organization_members 1, user_roles 1 (§7.1); employees "Rosa Medina" (§7.6) |
| `LOADS` (mock.ts) | 8 | loads 8, load_stops 24 (16 + 8 D7 fuel stops), dispatches 7, documents 24, document_versions 13, load_activity 32 (§7.12) |
| `CARRIERS` (mock.ts) | 5 | carriers 5 (§7.4) |
| `DRIVERS` (mock.ts) | 6 | employees 6, drivers 6, driver_mileage_entries 6 (§7.6, §7.9); unit via trucks, CDL via driver_documents |
| `TRUCKS` (mock.ts) | 6 | trucks 6 (§7.10) |
| `TRAILERS` (mock.ts) | 8 | trailers 8 (§7.11) |
| `CUSTOMERS` (mock.ts) | 6 | customers 6, customer_contacts 6 (§7.3); loads/revenue/onTime/ar are computed (§6.5) |
| `TOP_ACCOUNTS` (mock.ts) | 3 | none: selected by rule (§6.5); the three contact e-mails are on customer_contacts |
| `INVOICES` (mock.ts) | 6 | invoices 6, invoice_items 6 (§7.15) |
| `SETTLEMENTS` (mock.ts) | 5 | settlements 5, settlement_items 18 (§7.18) |
| `COMPLIANCE` (mock.ts) | 3 | compliance_reminders positions 1–3 (§7.21) |
| `AR`, `REVENUE_BARS`, `REVENUE_DAYS` (mock.ts) | 4, 7, 7 | none: computed (§6.7.2, §6.2) |
| `UNINVOICED` (accounting.ts) | 11 | loads 11 (archived), load_stops 22, documents 11, document_versions 8 (§7.13) |
| `INVOICES_EXTRA` (accounting.ts) | 10 | invoices 10, invoice_items 10 (§7.15) |
| loads referenced only by an invoice | 12 | loads 12 (archived, §7.14) |
| `PAYMENTS` (accounting.ts) | 5 | payments 5, factoring_companies 1 (§7.15) |
| `BATCHES` (accounting.ts) | 7 | invoice_batches 7, invoice_batch_items 12 (§7.16) |
| `BILLS` (accounting.ts) | 8 | vendors 8, bills 8 (§7.17) |
| `WATCHLIST` (fleet.ts) | 4 (`COMPLIANCE` + 1) | compliance_reminders 4 (§7.21) |
| `CONTRACTS` (hr.ts) | 10 | employee_contracts 10; employees Luis Ortega, Evan Brooks, Jamal Reed (§7.6, §7.7) |
| `ONBOARDING` (hr.ts) | 6 | onboarding_cases 6, onboarding_document_requests 3 (§7.8) |
| `MAINTENANCE` (safety.ts) | 8 | work_orders 8 (§7.19) |
| `DRIVER_DOCUMENTS` (safety.ts) | 15 | driver_documents 15 (§7.20) |
| `VIOLATIONS` (safety.ts) | 7 | violations 7 (§7.22) |
| `CLAIMS` (safety.ts) | 6 | claims 6 (§7.23) |
| `DEFAULT_CATEGORIES` (planner.ts) | 6 | planner_color_codes 6 (§7.24) |
| `PLANNER_EVENTS` (planner.ts) | 42 (27 `STANDUPS` + 15) | planner_events 42 (§7.25) |
| places named by `LOADS`, `TRAILERS`, `MAINTENANCE`, `CLAIMS` | 20 | facilities 20 (§7.5) |
| `NAV`, `SECTION_TABS`, `ACTIVE_STATUSES`, `SETTLE_TAG`, `TONES`, `CARD_FIELDS`, `ROW_H`, `DEFAULT_PREFS`, `TODAY` | — | none: static configuration in code (the clock is `DEMO_TODAY`) |

Totals: 31 loads (8 board + 11 uninvoiced + 12 invoice-only), 46 load stops, 35 documents with 21 versions (21 placeholder objects once the seed writes them, §7), 16 invoices.

### 7.1 Organization, user and membership (`USER`)

- `organizations`: name "Sunridge Freight", short_name "Sunridge", company_number "30017", timezone "America/Los_Angeles", mc_number "812044", dot_number "2291176" (digits only, as `carriers`), planner_defaults `runtruck1_demo` (Reset calendar restores §7.24 and §7.25, §5.12.2).
- `permissions`: the `@runtruck/permissions` catalog; `roles` + `role_permissions`: every default role of `roles.ts`.
- `users`: email "rosa.medina@sunridgefreight.com", full_name "Rosa Medina", password_hash from `SEED_DEMO_PASSWORD` (D2).
- `organization_members`: member_number "100482731", title "Dispatch". `user_roles`: role `admin`.

### 7.2 Counters

`organization_counters`: `load` → 40223, `invoice` → 8846, `invoice_batch` → 2036, `claim` → 1113 (each the seeded maximum + 1).

### 7.3 Customers and contacts (`CUSTOMERS`, `TOP_ACCOUNTS`)

| position | name | standing | payment_terms | primary contact (position 1, `is_primary`) | email |
|---|---|---|---|---|---|
| 1 | Northgate Foods | key_account | net_30 | Dana Ruiz | dana@northgate.com |
| 2 | Bayline Distribution | key_account | net_30 | Owen Petrakis | ops@bayline.co |
| 3 | Cascade Building Supply | growing | net_45 | Marta Lind | — |
| 4 | Harbor Point Retail | growing | net_30 | Jules Amari | — |
| 5 | Sierra Ag Partners | at_risk | net_60 | Ben Okafor | ben@sierraag.com |
| 6 | Vantage Home Goods | growing | net_30 | Iris Chen | — |

Contacts have no phone. Runtruck1's `loads`, `revenue`, `onTime` and `ar` are not stored (§6.5).

### 7.4 Carriers (`CARRIERS`)

| position | name | mc_number | dot_number | is_own_fleet |
|---|---|---|---|---|
| 1 | Sunridge Freight | 812044 | 2291176 | true |
| 2 | Valley Line Transport | 604117 | 1780342 | false |
| 3 | Cascade Reefer Express | 733905 | 2014588 | false |
| 4 | High Desert Hauling | 581230 | 1655901 | false |
| 5 | Golden State Flatbed | 690452 | 1893027 | false |

### 7.5 Facilities

From the `LOADS` addresses (`from`/`fromAddr`, `to`/`toAddr`), the trailer yard, the `MAINTENANCE` shops and the `CLAIMS` claimant. `postal_code` is null for all (Runtruck1 has none).

| name | kind | address_line1 | city | state | timezone | market_city / market_state | market_short |
|---|---|---|---|---|---|---|---|
| Northgate Cold Storage | shipper | 4120 S Golden State Blvd | Fresno | CA | America/Los_Angeles | — | — |
| Reno Grocers DC | consignee | 1855 E Greg St | Sparks | NV | America/Los_Angeles | Reno / NV | — |
| Bayline DC 4 | shipper | 2900 Navy Dr | Stockton | CA | America/Los_Angeles | — | — |
| Wasatch Crossdock | crossdock | 1740 S 4130 W | Salt Lake City | UT | America/Denver | — | SLC |
| Cascade Yard 2 | shipper | 8300 Elder Creek Rd | Sacramento | CA | America/Los_Angeles | — | — |
| Boise Builders Depot | consignee | 440 E Corporate Dr | Meridian | ID | America/Boise | Boise / ID | — |
| Port of Oakland, Berth 22 | port | 1599 Maritime St | Oakland | CA | America/Los_Angeles | — | — |
| Harbor Point DC | consignee | 6200 N Basin Ave | Portland | OR | America/Los_Angeles | — | — |
| Northgate Creamery | shipper | 3011 Buck Owens Blvd | Bakersfield | CA | America/Los_Angeles | — | — |
| Valley Foods DC | consignee | 2240 W Buckeye Rd | Phoenix | AZ | America/Phoenix | — | — |
| Bayline LA Annex | shipper | 5200 S Boyle Ave | Vernon | CA | America/Los_Angeles | Los Angeles / CA | — |
| Sunset Beverage DC | consignee | 3900 W Cheyenne Ave | North Las Vegas | NV | America/Los_Angeles | Las Vegas / NV | — |
| Sierra Ag Huller 3 | shipper | 1901 Crows Landing Rd | Modesto | CA | America/Los_Angeles | — | — |
| Front Range Foods | consignee | 5400 Havana St | Denver | CO | America/Denver | — | — |
| Cascade Mill | shipper | 3400 Airport Rd | Redding | CA | America/Los_Angeles | — | — |
| Duwamish Steel Yard | consignee | 8100 E Marginal Way S | Seattle | WA | America/Los_Angeles | — | — |
| Sunridge yard | yard | — | Modesto | CA | America/Los_Angeles | — | — |
| Sunridge shop | shop | — | Modesto | CA | America/Los_Angeles | — | — |
| Thermo King | shop | — | Fresno | CA | America/Los_Angeles | — | — |
| Valley Truck Center | shop | — | Stockton | CA | America/Los_Angeles | — | — |

### 7.6 Employees

| first_name | last_name | status | user_id | source |
|---|---|---|---|---|
| Marcus | Hale | active | — | `DRIVERS` |
| Dara | Whitfield | active | — | `DRIVERS` |
| Ellis | Nakamura | active | — | `DRIVERS` |
| Priya | Raman | active | — | `DRIVERS` |
| Ana | Cortez | active | — | `DRIVERS` |
| Tobias | Frey | active | — | `DRIVERS` |
| Rosa | Medina | active | Rosa's user | `USER`, `CONTRACTS` |
| Luis | Ortega | active | — | `CONTRACTS` (mechanic, onboarding owner) |
| Evan | Brooks | active | — | `CONTRACTS`, `ONBOARDING` |
| Jamal | Reed | onboarding | — | `CONTRACTS` (draft), `ONBOARDING` |

### 7.7 Employee contracts (`CONTRACTS`)

| position | employee | role | contract_type | status | starts_on | renews_on | pay_basis | pay_rate_cents / pay_percent_bp |
|---|---|---|---|---|---|---|---|---|
| 1 | Marcus Hale | company_driver | w2 | active | 2022-03-14 | 2027-03-14 | per_mile | 62 |
| 2 | Dara Whitfield | company_driver | w2 | active | 2021-08-02 | 2027-08-02 | per_mile | 60 |
| 3 | Ellis Nakamura | company_driver | w2 | renewal_due | 2023-10-01 | 2026-10-01 | percent_of_line_haul | 2500 bp |
| 4 | Priya Raman | company_driver | w2 | renewal_due | 2024-09-20 | 2026-09-20 | per_mile | 58 |
| 5 | Ana Cortez | company_driver | w2 | active | 2026-01-12 | 2027-01-12 | per_mile | 58 |
| 6 | Tobias Frey | owner_operator | lease_purchase | expiring | 2023-11-15 | 2026-11-15 | per_mile | 118 |
| 7 | Rosa Medina | dispatcher | w2 | active | 2020-06-06 | 2027-06-06 | annual_salary | 6800000 |
| 8 | Luis Ortega | mechanic | w2 | active | 2023-02-09 | 2027-02-09 | hourly | 3450 |
| 9 | Evan Brooks | dispatcher | w2 | active | 2026-07-27 | 2027-07-27 | annual_salary | 5200000 |
| 10 | Jamal Reed | company_driver | w2 | draft | 2026-09-08 | 2027-09-08 | per_mile | 56 |

F-DATE reproduces every Runtruck1 string ("Mar 14, 2022", "Oct 1", "Jan 12", "Sep 8, 2027").

### 7.8 Onboarding (`ONBOARDING`)

| position | candidate_name | employee | role | stage | started_on | owner | progress | next_step | next_step_on | completed_on |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Jamal Reed | Jamal Reed | company_driver | orientation | 08-17 | Rosa Medina | 85 | Ride-along with Ana Cortez | 09-05 | — |
| 2 | Sofia Nguyen | — | company_driver | road_test | 08-24 | Luis Ortega | 60 | Road test in T-103 | 09-04 | — |
| 3 | Derek Holt | — | owner_operator | background_check | 08-28 | Rosa Medina | 35 | Waiting on MVR consent and insurance certificate | — | — |
| 4 | Kevin Brandt | — | company_driver | background_check | 09-01 | Rosa Medina | 30 | Waiting on medical card copy | — | — |
| 5 | Maya Patel | — | company_driver | application | 09-02 | Rosa Medina | 10 | Phone screen | 09-04 | — |
| 6 | Evan Brooks | Evan Brooks | dispatcher | complete | 07-13 | Rosa Medina | 100 | 90-day review | 10-25 | 07-27 |

`onboarding_document_requests` (Runtruck1 `docsPending: true` and the text of `nextStep`): Derek Holt 1 "MVR consent" pending, 2 "insurance certificate" pending; Kevin Brandt 1 "medical card" pending. Evan's `completed_on` is his contract start (Runtruck1 gives no date; §6.8 needs one in the quarter).

### 7.9 Drivers and mileage (`DRIVERS`)

| position | employee | duty_status | hos_remaining_minutes | mileage entry (recorded_on 09-03) |
|---|---|---|---|---|
| 1 | Marcus Hale | on_duty | 380 ("6h 20m") | 2140 |
| 2 | Dara Whitfield | on_duty | 545 ("9h 05m") | 1980 |
| 3 | Ellis Nakamura | on_duty | 105 ("1h 45m") | 1760 |
| 4 | Priya Raman | available | 660 ("11h 00m") | 1420 |
| 5 | Ana Cortez | available | 660 | 1180 |
| 6 | Tobias Frey | home_time | — ("—") | 640 |

`hos_as_of` is null. One `driver_mileage_entries` row per driver carries Runtruck1's week-to-date miles as reported on 2026-09-03. Runtruck1's `unit` comes from `trucks.assigned_driver_id`, `cdl` from `driver_documents`, `load` and `pay` are computed (§6.6).

### 7.10 Trucks (`TRUCKS`)

| unit_number | make | model | model_year | plate_state | plate_number | assigned driver | odometer_miles | next_service_miles | status |
|---|---|---|---|---|---|---|---|---|---|
| T-103 | Freightliner | Cascadia | 2022 | CA | 8HJ2019 | Priya Raman | 318440 | 342000 | in_service |
| T-107 | Volvo | VNL 760 | 2021 | CA | 7RD8842 | Dara Whitfield | 402190 | 425000 | in_service |
| T-109 | Kenworth | T680 | 2023 | CA | 9KM1174 | Ana Cortez | 141220 | 165000 | in_service |
| T-114 | Peterbilt | 579 | 2020 | CA | 6PL4408 | Marcus Hale | 528900 | 529800 | service_due |
| T-118 | Freightliner | Cascadia | 2019 | CA | 5TT9930 | Tobias Frey | 611780 | — | in_shop |
| T-121 | International | LT | 2022 | CA | 8WQ2251 | Ellis Nakamura | 275610 | 298000 | in_service |

### 7.11 Trailers (`TRAILERS`)

| position | unit_number | trailer_type | length_ft | status | location |
|---|---|---|---|---|---|
| 1 | RF-27 | reefer | 53 | loaded | city: Bakersfield, CA |
| 2 | RF-09 | reefer | 53 | empty | yard: Sunridge yard |
| 3 | RF-88 | reefer | 53 | loaded | en_route: "I-80" |
| 4 | DV-51 | dry_van | 53 | loaded | city: Stockton, CA |
| 5 | DV-88 | dry_van | 53 | empty | yard: Sunridge yard |
| 6 | DV-14 | dry_van | 53 | empty | city: Las Vegas, NV |
| 7 | FB-04 | flatbed | 48 | loaded | city: Redding, CA |
| 8 | FB-12 | flatbed | 48 | inspection | yard: Sunridge yard |

### 7.12 Board loads (`LOADS`) and their D7 rows

**`loads`** (all `mode` null, `archived_at` null, `hazmat`/`stackable` false, `fuel_surcharge_cents`/`accessorial_cents` 0, `payment_terms` = the customer's). `created_at` = 2026-09-03T00:00:00Z minus *i* minutes, *i* = 0 … 7 in the order listed, which is Runtruck1's board order (any load created on the demo day sorts above them).

| load_number | created_at (UTC) | customer | status | tender_ref | equipment_type | commodity | weight_lb | temperature_f | carrier | line_haul | loaded_miles | empty_miles | driver_pay | operating_cost |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 40218 | 09-03 00:00 | Northgate Foods | in_transit | PO 88-41207 | reefer_53 | Frozen produce | 41200 | -10.0 | own fleet | 245000 | 478 | 40 | 61200 | 62400 |
| 40219 | 09-02 23:59 | Bayline Distribution | at_pickup | PO 55-90114 | dry_van_53 | Palletized dry goods | 38500 | — | own fleet | 318000 | 736 | 62 | 79500 | 84500 |
| 40220 | 09-02 23:58 | Cascade Building Supply | delayed | SO 7741 | flatbed_tarped | Lumber | 44000 | — | own fleet | 291000 | 602 | 51 | 72800 | 79400 |
| 40221 | 09-02 23:57 | Harbor Point Retail | needs_driver | PO 31-2280 | dry_van_53 | Consumer goods | 30100 | — | — | 354000 | 632 | — | — | — |
| 40214 | 09-02 23:56 | Northgate Foods | needs_pod | PO 88-41190 | reefer_53 | Dairy | 36800 | 34.0 | own fleet | 198000 | 389 | 33 | 49500 | 49900 |
| 40212 | 09-02 23:55 | Bayline Distribution | delivered | PO 55-89902 | dry_van_53 | Beverages | 42000 | — | own fleet | 164000 | 271 | 23 | 41000 | 38800 |
| 40210 | 09-02 23:54 | Sierra Ag Partners | delivered | SO 2214 | dry_van_53 | Almonds | 43500 | — | own fleet | 412000 | 1142 | 116 | 103000 | 118600 |
| 40222 | 09-02 23:53 | Cascade Building Supply | dispatched | SO 7802 | flatbed_48 | Steel coil | 46000 | — | own fleet | 276000 | 578 | 49 | 69000 | 75800 |

- Runtruck1's `rate`, `miles`, `pay`, `commodity`, `weight`, `equip`, `temp`, `ref`, `carrier*` map to the columns above; `route`, `pickup`, `delivery`, `driver`, `unit`, `rpm`, `margin`, `status` label and `tagClass` are computed (§6.3). Status is Runtruck1's label mapped 1:1 (§4.4).
- `operating_cost_cents` = rate − pay − Runtruck1 margin, so the computed margin is Runtruck1's exactly.
- `empty_miles` (§6.0.2): L-40210 (the only load picked up in the previous org week) 116, so 116 / (1,142 + 116) = 9.2 %; the six loads with a pickup in the org week and a truck share 258 in proportion to their loaded miles, so 258 / (3,054 + 258) = 7.8 %; L-40221 has no truck yet (null).

**`load_stops`** (D7): sequence 1 pickup, 2 fuel, 3 delivery. Pickup and delivery stops copy the facility's `name`, `address_line1`, `city`, `state`, `timezone` and reference it; windows are Runtruck1's `stopsOf` windows (pickup 08:00–14:00, delivery 06:00–12:00, facility-local); planned slots are `loadEvents`' hash-derived times (`6 + (n mod 7) × 1.5` h and `7 + ((3n) mod 8) × 1.5` h, 2 h long). `arrived_at` and `completed_at` are null. Statuses reproduce `LoadDetailPage`'s labels exactly (§6.0.5), including its quirks: the pickups of L-40221 and L-40222 are `completed` ("Pickup · complete" before they happen) and L-40214's delivery is `pending` ("Delivery" although delivered).

| load | pickup facility · date · planned · status | delivery facility (timezone) · date · planned · status |
|---|---|---|
| 40218 | Northgate Cold Storage · 09-03 · 10:30–12:30 · completed | Reno Grocers DC (Los_Angeles) · 09-04 · 16:00–18:00 · pending |
| 40219 | Bayline DC 4 · 09-03 · 12:00–14:00 · arrived | Wasatch Crossdock (Denver) · 09-05 · 08:30–10:30 · pending |
| 40220 | Cascade Yard 2 · 09-02 · 13:30–15:30 · completed | Boise Builders Depot (Boise) · 09-04 · 13:00–15:00 · pending |
| 40221 | Port of Oakland, Berth 22 · 09-04 · 15:00–17:00 · completed | Harbor Point DC (Los_Angeles) · 09-06 · 17:30–19:30 · pending |
| 40214 | Northgate Creamery · 09-01 · 15:00–17:00 · completed | Valley Foods DC (Phoenix) · 09-02 · 10:00–12:00 · pending |
| 40212 | Bayline LA Annex · 08-31 · 12:00–14:00 · completed | Sunset Beverage DC (Los_Angeles) · 09-01 · 13:00–15:00 · completed |
| 40210 | Sierra Ag Huller 3 · 08-29 · 09:00–11:00 · completed | Front Range Foods (Denver) · 09-01 · 16:00–18:00 · completed |
| 40222 | Cascade Mill · 09-05 · 06:00–08:00 · completed | Duwamish Steel Yard (Los_Angeles) · 09-06 · 10:00–12:00 · pending |

Every pickup facility is in America/Los_Angeles. The fuel stop of every board load: `kind` fuel, `status` pending, no facility, `facility_name` "Planned · 92 gal, DEF top-off", `address_line1` "Routed automatically on the lane", city/state null, `timezone` America/Los_Angeles, `appointment_date` = the pickup date, `window_open` 16:40, `window_close` null, no planned slot.

**`dispatches`** (own fleet: `driver_id`, `truck_id`, `trailer_id` set; free-text columns null):

| load | driver | truck | trailer | status |
|---|---|---|---|---|
| 40218 | Marcus Hale | T-114 | RF-88 | assigned |
| 40219 | Dara Whitfield | T-107 | DV-51 | assigned |
| 40220 | Ellis Nakamura | T-121 | FB-12 | assigned |
| 40214 | Priya Raman | T-103 | RF-27 | completed |
| 40212 | Marcus Hale | T-114 | DV-88 | completed |
| 40210 | Tobias Frey | T-118 | DV-14 | completed |
| 40222 | Ana Cortez | T-109 | FB-04 | assigned |

L-40221 has no dispatch ("Unassigned", "—").

**`documents`** (D7, `LoadDetailPage.tsx:40-44`): three slots per board load — position 1 `rate_confirmation` (attached on all 8), 2 `bill_of_lading` (attached on L-40214, L-40212, L-40210; pending on the other 5), 3 `proof_of_delivery` (attached on L-40212, L-40210; pending on the other 6). Each attached slot: `attached_at` 2026-09-03T17:05:00Z (10:05) and one `document_versions` row, version 1, `file_name` `rate-confirmation-L-<n>.pdf` / `bill-of-lading-L-<n>.pdf` / `proof-of-delivery-L-<n>.pdf`, storage key per §5.7.2. 24 slots, 13 versions.

**`load_activity`** (D7, `LoadDetailPage.tsx:50-55`): four rows per board load, `actor_user_id` null:

| sequence | occurred_at (UTC) | org time | kind | message |
|---|---|---|---|---|
| 1 | 2026-09-03T14:12:00Z | Today 07:12 | driver_accepted | Driver accepted the load in the app |
| 2 | 2026-09-03T15:41:00Z | Today 08:41 | arrived | Arrived at {the load's pickup facility name} |
| 3 | 2026-09-03T17:05:00Z | Today 10:05 | document_uploaded | Bill of lading uploaded from the cab |
| 4 | 2026-09-03T17:06:00Z | Today 10:06 | `invoice_queued` on L-40212 and L-40210 (status delivered); `consignee_notified` on the other 6 | Invoice queued for billing / Dispatch notified the consignee |

### 7.13 Uninvoiced loads (`UNINVOICED`)

Eleven archived loads (`archived_at` 2026-09-03T07:00:00Z, i.e. midnight of the demo day in the organization), with `line_haul_cents` = Runtruck1's `amount`, `payment_terms` = the customer's, no carrier, no dispatch, no miles, and equipment, commodity and weight null (allowed for archived loads by `loads_complete_ck`). Status: `delivered` when the POD is attached, `needs_pod` when it is missing. `created_at` takes its default.

Stops: a pickup (sequence 1) and a delivery (sequence 2), both `completed`, windows 08:00–14:00 and 06:00–12:00 like the board loads, no planned slot, no fuel stop, no activity. The facility of each stop is the seeded load facility of that route city (the Runtruck1 route names cities only; each city has exactly one such facility), so the computed route equals Runtruck1's. The delivery date is Runtruck1's `delivered`; the pickup date is the delivery date minus the transit days of the same lane on the board (1 day Fresno–Reno, Bakersfield–Phoenix, Redding–Seattle; 2 days Stockton–Salt Lake City, Sacramento–Boise, Oakland–Portland; 3 days Modesto–Denver) and, for the four lanes the board does not run, 1 day Stockton–Las Vegas, 2 days Fresno–Portland and Modesto–Salt Lake City, 3 days Sacramento–Denver.

Documents: one slot, position 1, `proof_of_delivery` — `attached` (with one version `proof-of-delivery-L-<n>.pdf`, `attached_at` 2026-09-03T17:05:00Z) when Runtruck1 says Attached, `pending` when it says Missing.

| load | customer | status | amount | pickup facility · date | delivery facility · date | POD |
|---|---|---|---|---|---|---|
| 40209 | Northgate Foods | delivered | 245000 | Northgate Cold Storage · 09-01 | Reno Grocers DC · 09-02 | attached |
| 40208 | Bayline Distribution | delivered | 318000 | Bayline DC 4 · 08-31 | Wasatch Crossdock · 09-02 | attached |
| 40207 | Cascade Building Supply | needs_pod | 291000 | Cascade Yard 2 · 08-31 | Boise Builders Depot · 09-02 | pending ("Missing") |
| 40206 | Harbor Point Retail | delivered | 354000 | Port of Oakland, Berth 22 · 08-30 | Harbor Point DC · 09-01 | attached |
| 40204 | Vantage Home Goods | needs_pod | 288000 | Bayline DC 4 · 08-30 | Sunset Beverage DC · 08-31 | pending |
| 40203 | Northgate Foods | delivered | 198000 | Northgate Creamery · 08-30 | Valley Foods DC · 08-31 | attached |
| 40205 | Sierra Ag Partners | delivered | 412000 | Sierra Ag Huller 3 · 08-27 | Front Range Foods · 08-30 | attached |
| 40202 | Bayline Distribution | delivered | 362000 | Northgate Cold Storage · 08-28 | Harbor Point DC · 08-30 | attached |
| 40201 | Cascade Building Supply | delivered | 276000 | Cascade Mill · 08-28 | Duwamish Steel Yard · 08-29 | attached |
| 40200 | Sierra Ag Partners | needs_pod | 305000 | Sierra Ag Huller 3 · 08-26 | Wasatch Crossdock · 08-28 | pending |
| 40199 | Vantage Home Goods | delivered | 441000 | Cascade Yard 2 · 08-24 | Front Range Foods · 08-27 | attached |

Σ 3,490,000 = Runtruck1's "$34,900 waiting". 22 stops, 11 slots, 8 versions.

### 7.14 Loads referenced only by an invoice

Twelve archived loads so that every invoice item points at a real load (01 §4). Runtruck1 gives only their customer and invoice amount, so they are minimal: status `delivered`, `archived_at` 2026-09-03T07:00:00Z, `line_haul_cents` = the invoice amount, `payment_terms` = the customer's, and no stops, dispatch, documents, activity, carrier, miles, equipment, commodity or weight.

| load | customer | line_haul (= invoice) |
|---|---|---|
| 40198 | Cascade Building Supply | 288000 (INV-8829) |
| 40197 | Vantage Home Goods | 226000 (INV-8844) |
| 40196 | Cascade Building Supply | 276000 (INV-8842) |
| 40191 | Harbor Point Retail | 341000 (INV-8824) |
| 40190 | Sierra Ag Partners | 305000 (INV-8839) |
| 40189 | Vantage Home Goods | 189000 (INV-8838) |
| 40187 | Northgate Foods | 245000 (INV-8830) |
| 40183 | Bayline Distribution | 318000 (INV-8823) |
| 40178 | Harbor Point Retail | 218000 (INV-8821) |
| 40176 | Cascade Building Supply | 291000 (INV-8819) |
| 40172 | Vantage Home Goods | 159000 (INV-8815) |
| 40168 | Sierra Ag Partners | 386000 (INV-8811) |

### 7.15 Invoices, items, payments (`INVOICES`, `INVOICES_EXTRA`, `PAYMENTS`)

Each invoice has one `invoice_items` row: position 1, `load_id` = its Runtruck1 `load`, description "Line haul", `amount_cents` = its `amount`. `payment_terms` = the customer's, except INV-8836 (net_30, so that its stored `overdue` is past its due date; Sierra Ag's own terms are Net 60). `due_on` = `issued_on` + net days.

| invoice | customer | load | status | payment_terms | issued_on | due_on | amount |
|---|---|---|---|---|---|---|---|
| 8845 | Northgate Foods | 40218 | draft | net_30 | — | — | 245000 |
| 8841 | Northgate Foods | 40214 | sent | net_30 | 09-01 | 10-01 | 198000 |
| 8840 | Bayline Distribution | 40212 | sent | net_30 | 08-31 | 09-30 | 164000 |
| 8829 | Cascade Building Supply | 40198 | sent | net_45 | 08-16 | 09-30 | 288000 |
| 8824 | Harbor Point Retail | 40191 | paid | net_30 | 08-07 | 09-06 | 341000 |
| 8836 | Sierra Ag Partners | 40210 | overdue | net_30 | 07-24 | 08-23 | 412000 |
| 8844 | Vantage Home Goods | 40197 | sent | net_30 | 09-02 | 10-02 | 226000 |
| 8842 | Cascade Building Supply | 40196 | sent | net_45 | 09-01 | 10-16 | 276000 |
| 8839 | Sierra Ag Partners | 40190 | paid | net_60 | 08-29 | 10-28 | 305000 |
| 8838 | Vantage Home Goods | 40189 | paid | net_30 | 08-28 | 09-27 | 189000 |
| 8830 | Northgate Foods | 40187 | paid | net_30 | 08-18 | 09-17 | 245000 |
| 8823 | Bayline Distribution | 40183 | paid | net_30 | 08-05 | 09-04 | 318000 |
| 8821 | Harbor Point Retail | 40178 | overdue | net_30 | 07-29 | 08-28 | 218000 |
| 8819 | Cascade Building Supply | 40176 | overdue | net_45 | 07-15 | 08-29 | 291000 |
| 8815 | Vantage Home Goods | 40172 | overdue | net_30 | 07-02 | 08-01 | 159000 |
| 8811 | Sierra Ag Partners | 40168 | overdue | net_60 | 06-28 | 08-27 | 386000 |

Every Runtruck1 `age` equals `today − issued_on`. `factoring_companies`: "TriPoint Capital". `payments` (`amount_cents` = the invoice amount, `reference` null; the times order the Paid tab like Runtruck1's stable sort):

| invoice | received_at (UTC) | org time | method | factoring company |
|---|---|---|---|---|
| 8823 | 2026-09-03T17:00:00Z | Sep 3 10:00 | check | — |
| 8824 | 2026-09-02T22:00:00Z | Sep 2 15:00 | ach | — |
| 8838 | 2026-09-02T16:00:00Z | Sep 2 09:00 | factoring | TriPoint Capital |
| 8839 | 2026-09-01T22:00:00Z | Sep 1 15:00 | factoring | TriPoint Capital |
| 8830 | 2026-09-01T16:00:00Z | Sep 1 09:00 | ach | — |

### 7.16 Invoice batches (`BATCHES`)

Runtruck1's batches carry an invoice count and a total but not their invoices; totals are computed (§1.8), so membership is seeded. Rule: the two batches whose members can be back-solved get them exactly (B-2035 = INV-8845 + INV-8841 = $4,430; B-2033 = INV-8838 + INV-8839 = $4,940, the two factored payments); every other invoice goes to the other batch sent to its customer (for Northgate that is B-2029); the factored B-2030 has no invoice left; invoices of customers without a batch stay unbatched (INV-8836, INV-8811, INV-8844, INV-8815). Counts and totals then follow §6.7.3.

| batch | created_on | recipient | status | invoices (`invoice_batch_items`) |
|---|---|---|---|---|
| 2035 | 09-03 | customer Northgate Foods | ready | 8845, 8841 |
| 2034 | 09-02 | customer Cascade Building Supply | ready | 8829, 8842, 8819 |
| 2033 | 09-01 | factoring TriPoint Capital | sent | 8838, 8839 |
| 2032 | 08-29 | customer Bayline Distribution | sent | 8840, 8823 |
| 2031 | 08-26 | customer Harbor Point Retail | sent | 8824, 8821 |
| 2030 | 08-22 | factoring TriPoint Capital | settled | — |
| 2029 | 08-19 | customer Northgate Foods | settled | 8830 |

### 7.17 Vendors and bills (`BILLS`)

One vendor per bill, named as Runtruck1's `vendor` (em dash kept).

| vendor | category | description | due_on | amount | status | scheduled_on | paid_on |
|---|---|---|---|---|---|---|---|
| Verizon Connect ELD | Telematics | — | 08-28 | 48600 | overdue | — | — |
| Modesto Yard — Lease | Facilities | — | 09-01 | 390000 | paid | — | 09-01 |
| Comdata | Fuel card fees | — | 09-02 | 21500 | paid | — | 09-02 |
| Bridgestone Commercial | Tires | — | 09-04 | 238000 | due | — | — |
| Pilot Flying J | Fuel | — | 09-05 | 864000 | due | — | — |
| Valley Diesel & Turbo | Parts | T-118 turbo | 09-08 | 398000 | due | — | — |
| Great West Casualty | Insurance | — | 09-10 | 621000 | scheduled | 09-10 | — |
| Ryder Trailer Lease | Equipment lease | — | 09-15 | 415000 | scheduled | 09-15 | — |

Paid bills are paid on their due date (Runtruck1 has no paid date; its "Paid this month" tests the due month, which gives the same result).

### 7.18 Settlements (`SETTLEMENTS`)

`period_start` 2026-09-01, `period_end` 2026-09-07, pay basis as the driver's contract; `approved_at` null.

| driver | pay_basis | rate / bp | status | hold_reason |
|---|---|---|---|---|
| Marcus Hale | per_mile | 62 | ready | — |
| Dara Whitfield | per_mile | 60 | ready | — |
| Ellis Nakamura | percent_of_line_haul | 2500 bp | on_hold | fuel |
| Priya Raman | per_mile | 58 | ready | — |
| Ana Cortez | per_mile | 58 | paid | — |

`settlement_items`: Runtruck1 gives per-driver totals (`loads`, `miles`, `gross`, `ded`), so the `line_pay` items split them evenly (the remainder on the first items), with `load_id` and `description` null; one `deduction` item carries `ded` (description null). Amounts are stored as Runtruck1 shows them, not recomputed from the rate (0.62 × 2,140 = 1,326.80 but the gross is $1,326).

| driver | line_pay items (positions, miles, amount each) | deduction (last position) | totals |
|---|---|---|---|
| Marcus Hale | 1–4: 535 mi, 33150 | 5: −14200 | 4 loads, 2,140 mi, $1,326 − $142 = $1,184 |
| Dara Whitfield | 1–3: 660 mi, 39600 | 4: −9600 | 3, 1,980, $1,188 − $96 = $1,092 |
| Ellis Nakamura | 1–2: 587 mi, 3: 586 mi; 48500 each | 4: −21000 | 3, 1,760, $1,455 − $210 = $1,245 |
| Priya Raman | 1–2: 710 mi, 41200 | 3: −6400 | 2, 1,420, $824 − $64 = $760 |
| Ana Cortez | 1–2: 590 mi, 34200 | — | 2, 1,180, $684 ("—" deductions) |

### 7.19 Work orders (`MAINTENANCE`)

| position | unit | item | due | shop facility | estimate | status | completed_on |
|---|---|---|---|---|---|---|---|
| 1 | truck T-118 | Turbocharger replacement | due_on 09-05 | Sunridge shop | 485000 | in_shop | — |
| 2 | trailer FB-12 | DOT annual inspection | due_on 09-03 | Sunridge shop | 15000 | in_shop | — |
| 3 | truck T-121 | Brake adjustment | due_on 08-28 | Sunridge shop | 42000 | overdue | — |
| 4 | truck T-114 | PM service A | due_odometer 529800 | Sunridge shop | 64000 | due | — |
| 5 | trailer RF-27 | Reefer unit service | due_on 09-12 | Thermo King | 71000 | scheduled | — |
| 6 | truck T-107 | DOT annual inspection | due_on 09-18 | Valley Truck Center | 18500 | scheduled | — |
| 7 | truck T-103 | Tire rotation | due_odometer 342000 | Sunridge shop | 16000 | scheduled | — |
| 8 | truck T-109 | DOT annual inspection | due_on 08-22 | Valley Truck Center | 18500 | done | 08-22 |

The done order is completed on its due date (Runtruck1 has no completion date).

### 7.20 Driver documents (`DRIVER_DOCUMENTS`)

| position | driver | document_type | expires_on | expires_precision | status |
|---|---|---|---|---|---|
| 1 | Marcus Hale | cdl | 2028-04-30 | month | valid |
| 2 | Marcus Hale | medical_card | 2027-03-31 | month | valid |
| 3 | Marcus Hale | clearinghouse_query | 2026-09-20 | day | expiring |
| 4 | Dara Whitfield | cdl | 2027-11-30 | month | valid |
| 5 | Dara Whitfield | medical_card | 2027-06-30 | month | valid |
| 6 | Ellis Nakamura | cdl | 2027-02-28 | month | valid |
| 7 | Ellis Nakamura | medical_card | 2026-10-12 | day | expiring |
| 8 | Priya Raman | cdl | 2026-07-31 | month | expired |
| 9 | Priya Raman | medical_card | 2028-01-31 | month | valid |
| 10 | Ana Cortez | cdl | 2029-09-30 | month | valid |
| 11 | Ana Cortez | mvr | 2026-09-24 | day | expiring |
| 12 | Ana Cortez | annual_review | 2026-09-24 | day | expiring |
| 13 | Tobias Frey | cdl | 2028-01-31 | month | valid |
| 14 | Tobias Frey | medical_card | 2026-12-31 | month | valid |
| 15 | Tobias Frey | drug_test | — | month (default) | missing |

Runtruck1 shows a month ("Apr 2028") or a day ("Sep 20"); the precision column records which, and month dates are the month's last day.

### 7.21 Compliance reminders (`COMPLIANCE` + `WATCHLIST`)

| position | driver | item_label | due_on | due_precision |
|---|---|---|---|---|
| 1 | Priya Raman | CDL renewal | 2026-07-31 | month |
| 2 | Ellis Nakamura | Medical card | 2026-10-12 | day |
| 3 | Ana Cortez | Annual MVR review | 2026-09-24 | day |
| 4 | Marcus Hale | Clearinghouse query | 2026-09-20 | day |

### 7.22 Violations (`VIOLATIONS`)

| occurred_on | driver | truck | violation_type | severity_points | location | status |
|---|---|---|---|---|---|---|
| 08-31 | Tobias Frey | T-118 | Log form & manner | 1 | I-70 POE · Loma, CO | open |
| 08-28 | Ellis Nakamura | T-121 | Brake adjustment | 4 | I-5 scale · Cottonwood, CA | open |
| 08-19 | Marcus Hale | T-114 | Hours-of-service | 7 | US-95 POE · Winnemucca, NV | contested |
| 07-30 | Dara Whitfield | T-107 | Lighting | 6 | I-80 scale · Donner Pass, CA | closed |
| 06-12 | Tobias Frey | T-118 | Speeding 6–10 over | 4 | I-70 · Grand Junction, CO | closed |
| 05-06 | Ellis Nakamura | T-121 | Log form & manner | 1 | I-84 POE · Ontario, OR | closed |
| 03-18 | Ana Cortez | T-109 | Lighting | 6 | I-5 scale · Ashland, OR | closed |

### 7.23 Claims (`CLAIMS`)

`load_id` null (Runtruck1 names no load).

| claim | occurred_on | driver | truck / trailer | claim_type | claimant | reserved | paid | status |
|---|---|---|---|---|---|---|---|---|
| 1112 | 08-26 | Ellis Nakamura | T-121 / FB-12 | cargo_damage | customer Cascade Building Supply | 680000 | 0 | open |
| 1111 | 08-14 | Marcus Hale | T-114 / RF-88 | cargo_damage | customer Northgate Foods | 420000 | 0 | under_review |
| 1110 | 07-22 | Dara Whitfield | T-107 / DV-51 | property_damage | facility Wasatch Crossdock | 290000 | 265000 | settled |
| 1109 | 06-30 | Tobias Frey | T-118 / DV-14 | cargo_shortage | customer Sierra Ag Partners | 145000 | 0 | denied |
| 1108 | 05-09 | Ana Cortez | T-109 / FB-04 | bodily_injury | third_party "R. Delgado" | 2500000 | 1850000 | settled |
| 1107 | 03-03 | Priya Raman | T-103 / RF-27 | cargo_damage | customer Northgate Foods | 310000 | 287500 | settled |

### 7.24 Planner color codes (`DEFAULT_CATEGORIES`)

| position | key | label | tone | is_locked |
|---|---|---|---|---|
| 1 | pickup | Loaded (pickup) | amber | true |
| 2 | delivery | Empty (delivery) | green | true |
| 3 | maintenance | Maintenance | red | false |
| 4 | driver | Driver schedule | purple | false |
| 5 | meeting | Meetings | blue | false |
| 6 | admin | Billing & admin | teal | false |

### 7.25 Planner events (`PLANNER_EVENTS`)

Times are org wall clock; `place` and `load_id` are null on all 42 rows; `people` empty where Runtruck1 has none.

**Standups** (27 rows, `STANDUPS`): title "Dispatch standup", color code `meeting`, 08:00–08:30, notes "Board review: uncovered loads, HOS, delays.", people {Rosa Medina, Luis Ortega, Evan Brooks}, on every weekday from 2026-08-24 to 2026-09-30 except Labor Day 2026-09-07: Aug 24, 25, 26, 27, 28, 31; Sep 1, 2, 3, 4, 8, 9, 10, 11, 14, 15, 16, 17, 18, 21, 22, 23, 24, 25, 28, 29, 30.

**Office events** (15 rows, `ev-1` … `ev-15`):

| # | title | color code | start_date | end_date | time | notes | people |
|---|---|---|---|---|---|---|---|
| 1 | Tobias Frey — home time | driver | 09-01 | 09-06 | all day | Back on duty Mon Sep 7. | Tobias Frey |
| 2 | T-118 in shop — turbo | maintenance | 09-02 | 09-05 | all day | Sunridge shop · Modesto. Parts from Valley Diesel & Turbo. | — |
| 3 | Payroll review — week of Sep 1 | admin | 09-01 | — | 10:00–11:00 | Approve driver settlements before Friday. | Rosa Medina |
| 4 | Invoice batch B-2034 review | admin | 09-02 | — | 14:00–15:00 | — | Rosa Medina |
| 5 | FB-12 DOT annual inspection | maintenance | 09-03 | — | 13:00–15:00 | Sunridge shop · Modesto. | Luis Ortega |
| 6 | Road test — Sofia Nguyen | driver | 09-04 | — | 10:00–11:30 | In T-103. Luis Ortega evaluates. | Sofia Nguyen, Luis Ortega |
| 7 | T-114 PM service A | maintenance | 09-05 | — | 07:00–09:00 | Due at 529,800 mi. | Luis Ortega |
| 8 | Labor Day — office closed | admin | 09-07 | — | all day | — | — |
| 9 | Orientation — Jamal Reed | driver | 09-08 | — | 09:00–12:00 | Paperwork, ELD training, yard walk. | Jamal Reed, Rosa Medina |
| 10 | Safety meeting — HOS refresher | meeting | 09-08 | — | 13:00–14:00 | — | Rosa Medina, Marcus Hale, Dara Whitfield, Ellis Nakamura, Priya Raman, Ana Cortez |
| 11 | Northgate Foods quarterly review | meeting | 09-09 | — | 11:00–12:00 | With Dana Ruiz. On-time 96%, lane pricing for Q4. | Rosa Medina, Dana Ruiz |
| 12 | IFTA Q3 prep | admin | 09-10 | — | 15:00–16:00 | — | — |
| 13 | Sierra Ag collections call | admin | 09-11 | — | 09:30–10:30 | INV-8836, 41 days past due. | Rosa Medina, Ben Okafor |
| 14 | Marcus Hale — Clearinghouse query due | driver | 09-20 | — | all day | — | Marcus Hale |
| 15 | Ana Cortez — MVR & annual review due | driver | 09-24 | — | all day | — | Ana Cortez |

Titles keep Runtruck1's em dashes; notes are verbatim, including ev-11's "On-time 96%" and ev-13's "41 days past due" (D6).

`created_at` is set explicitly, **one second apart in `PLANNER_EVENTS` order** (the 27 standups by date, then ev-1 … ev-15): `PLANNER_DEFAULTS_CREATED_FROM + i` seconds, i = 0 … 41, from 2026-09-02T23:59:18Z to 23:59:59Z. The API orders office events by `created_at, start_date, start_time, id` (docs/api/planner.md §2.5), which therefore reproduces Runtruck1's `all` order `[...STANDUPS, ev-1 … ev-15]`, and every event created later sorts after them. Reset calendar re-inserts §7.24 and, for this organization (`planner_defaults` = `runtruck1_demo`), §7.25 with the same instants (§5.12.2).

---

## 8. Where computed values differ from Runtruck1 (D5)

These values are computed from the seeded records by the rules of §6 and differ from Runtruck1's hard-coded or unreproducible figures. The difference is accepted (D5); wording and formatting are unchanged. Every other value of every screen equals Runtruck1's (checked in §6).

| screen | value | Runtruck1 | computed |
|---|---|---|---|
| Dashboard | Active loads note | +4 vs. last week | +2 vs. last week |
| Dashboard | Revenue this week | $168K | $25K |
| Dashboard | Revenue this week note | +9.2% | +37.4% |
| Dashboard | Revenue chart heights Thu…Wed | 57, 78, 69, 89, **100**, 51, 39 % (Mon highlighted) | 42, 29, 26, 74, 46, 88, **100** % (Wed highlighted) |
| CRM | Revenue YTD | $1.3M | $0.1M |
| CRM | Revenue YTD note | Top 3 accounts = 73% | Top 3 accounts = 60% |
| CRM | On time | 92% | 97% |
| CRM | Open AR | $91.9K | $26.2K |
| CRM | Loads YTD (Northgate, Bayline, Cascade, Harbor Point, Sierra, Vantage) | 184, 151, 77, 44, 62, 29 | 5, 5, 6, 3, 5, 5 |
| CRM | Revenue (same order) | $412K, $338K, $196K, $121K, $154K, $74K | $11K, $15K, $17K, $9K, $18K, $13K |
| CRM | On time (same order) | 96, 94, 91, 89, 82, 93 % | 100, 100, 83, 100, 100, 100 % |
| CRM | AR balance (same order) | $18,400, $12,900, $21,300, $6,100, $29,300, $3,850 | $1,980, $1,640, $8,550, $2,180, $7,980, $3,850 |
| CRM | Top account cards (Northgate, Bayline, Sierra) | 184/$412K/96%, 151/$338K/94%, 62/$154K/82% | 5/$11K/100%, 5/$15K/100%, 5/$18K/100% |
| Fleet › Drivers | Pay YTD (Marcus, Dara, Ellis, Priya, Ana, Tobias) | $61,400, $58,900, $55,120, $52,480, $48,300, $63,750 | $1,326, $1,188, $1,455, $824, $684, $0 |
| Accounting › Invoiced | Current | $96,400 · 32 invoices | $11,520 · 5 invoices |
| Accounting › Invoiced | 1–30 days | $41,200 · 14 invoices | $13,070 · 4 invoices |
| Accounting › Invoiced | 31–60 days | $18,750 · 5 invoices | $1,590 · 1 invoices |
| Accounting › Invoiced | 60+ days | $7,900 · 2 invoices · collections | $0 · 0 invoices · collections |
| Accounting › Batches | B-2034 total | $8,120 | $8,550 |
| Accounting › Batches | B-2032 invoices / total | 4 / $11,310 | 2 / $4,820 |
| Accounting › Batches | B-2031 invoices / total | 3 / $7,670 | 2 / $5,590 |
| Accounting › Batches | B-2030 invoices / total | 5 / $14,230 | 0 / $0 |
| Accounting › Batches | B-2029 invoices / total | 3 / $8,410 | 1 / $2,450 |
| Accounting › Batches | Batches note | 22 invoices | 12 invoices |
| Accounting › Batches | Ready to send note | $12,550 to go out | $12,980 to go out |
| Accounting › Batches | Total batched | $59,110 | $30,780 |

Not a D5 difference but the one accepted visual change (D7): on the eight board loads' detail pages the stop time line reads "Sep 3 · 08:00–14:00" instead of "Pickup Sep 3 · 08:00–14:00" (and "Sep 4 · 06:00–12:00" instead of "Deliver Sep 4 · 06:00–12:00").

---

## 9. Migrations and database-level rules

### 9.1 Migrations

Migrations live in `packages/database/drizzle/` and are applied in order by `runMigrations` (`pnpm db:migrate`, the integration-test setup and `pnpm db:reset`).

| migration | kind | content |
|---|---|---|
| `0000_init.sql` | generated | every enum, the 46 tables, their keys, indexes, foreign keys and CHECKs |
| `0001_audit_append_only.sql` | hand-written (`--custom`) | the `audit_logs` append-only trigger (§9.2) |
| `0002_tenant_leading_child_indexes.sql` | generated | `0000_init` had created the per-parent unique indexes of `onboarding_document_requests`, `load_activity`, `load_stops`, `document_versions`, `invoice_items` and `settlement_items` without `organization_id`, plus a separate `(organization_id, parent_id)` index each; the schema code declares them as `(organization_id, <parent>_id, <sequence, position or version_number>)`. This migration drops the six old unique and six redundant indexes and creates the organization-leading ones (§1.3). No data change. |
| `0003_review_hardening.sql` | generated | enum `planner_default_set` and `organizations.planner_defaults` (default `standard`, §2.1); CHECK `loads_total_ck` (§5.6.1); partial index `load_stops_org_completed_idx` (§5.6.2); CHECK `planner_events_span_ck` (§5.12.2). Existing rows satisfy both CHECKs; existing organizations become `standard` (a database seeded before `0003` needs `pnpm db:reset` so Sunridge Freight gets `runtruck1_demo` and the digits-only MC/DOT of §7.1). |

Rules:
1. A schema change is made in this document first, then in `packages/database/src/schema/<domain>.ts`, then generated: `pnpm --filter @runtruck/database build`, then `cd packages/database && pnpm exec drizzle-kit generate --name <change>` (drizzle-kit reads the compiled schema, `drizzle.config.ts`).
2. **An applied migration is never edited.** Corrections are new migrations.
3. After generating, `pnpm exec drizzle-kit check` must pass and a second `generate` must report "No schema changes"; the snapshot in `drizzle/meta` is then in step with the code.
4. SQL that Drizzle cannot express (triggers, functions) goes in its own custom migration (`drizzle-kit generate --custom --name <x>`), with a comment pointing here.
5. Adding an enum value is `ALTER TYPE … ADD VALUE` in a new migration; renaming or removing one is a breaking change (§1.7).
6. The API integration suite rebuilds its database from the migrations (`apps/api/test/global-setup.ts`), so every migration is exercised on every run.

### 9.2 Audit trail is append-only

`0001_audit_append_only.sql` creates the function `public.audit_logs_append_only()` and the trigger `audit_logs_append_only_trg BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW`. An `UPDATE` or `DELETE` of an audit row raises `audit_logs is append-only: <op> is not allowed` with SQLSTATE `insufficient_privilege` (42501) for every code path of a role that cannot switch the trigger off (architecture §30).

What the trigger does **not** cover:
- `TRUNCATE` fires no row trigger (it is used only by `pnpm db:reset` and the test harness on local databases).
- The table **owner** or a **superuser** can bypass it: `SET session_replication_role = replica`, `ALTER TABLE audit_logs DISABLE TRIGGER …`, `DROP TRIGGER`, or `TRUNCATE`.
- Locally and in CI, `DATABASE_URL` connects as `runtruck`, which owns every table and is a superuser (the docker-compose image default). The guarantee therefore rests on convention there.

Required for staging and production ([21 §2](21-deployment.md), [19 §3](19-security.md) G1): migrations run as an owner role; the API and the worker connect as a **separate application role** that owns nothing, has no DDL rights and no `TRUNCATE`, is not a superuser and cannot set `session_replication_role`, holds only `SELECT, INSERT, UPDATE, DELETE` on the tables it uses, and has `REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs` (only `SELECT, INSERT`). A `BEFORE TRUNCATE` statement trigger is not added: the owner could drop it, and local resets truncate.

### 9.3 What the database enforces, and what the API enforces

The database guarantees, whatever the application does:
- tenant isolation of references (composite tenant FKs, §1.3) and per-organization uniqueness of names and human numbers;
- the shape rules written as CHECKs in §5 (money signs, one-of columns, status/date pairs such as `(status = 'paid') = (paid_on is not null)`);
- the append-only audit trail against the application role (§9.2; not against the owner or a superuser).

The API enforces (not the database): every state machine and allowed transition (load, invoice, bill, settlement, contract, work order, claim); that `load_activity` and `document_versions` are only inserted; that a planner event's related load is not archived; that human numbers come from `organization_counters`; that `due_on` equals `issued_on` + net days; dispatch rules (architecture §19); and every derived value of §6.

### 9.4 Seed, reset and test fixtures

- `pnpm db:seed` (`src/scripts/seed.ts`) inserts §7 into `DATABASE_URL` in one transaction. It refuses `NODE_ENV=production`, needs `SEED_DEMO_PASSWORD`, and does nothing when the organization with company number 30017 already exists.
- `pnpm db:reset` (`src/scripts/reset.ts`) refuses production, staging and non-local hosts, applies the migrations, truncates every table and seeds again.
- Test fixtures (`src/testing`, `seedAccess`) add, only in tests, members of the demo organization with narrower roles and a second organization "Test Carrier Co" with its own owner, to prove tenant isolation and permission denials (01 §4).
