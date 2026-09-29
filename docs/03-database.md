# 03 — Database Specification

Rank 3 in the source-of-truth hierarchy (architecture §49): below the product requirements ([01](01-product-requirements.md)) and security, above the architecture rules, the API specification ([04](04-api.md), `docs/api/*.md`) and the domain specifications. The code in `packages/database/src/schema/` (one file per domain) and the migrations in `packages/database/drizzle/` implement this document **name for name**. A schema change is made here first, then in code, then as a generated migration (§9).

Inputs: the product decisions D1–D8 ([01 §2](01-product-requirements.md)), the binding [design brief](reference/design-brief.md), and the Runtruck1 port specs in [reference/runtruck1/](reference/runtruck1/) (mainly [data-model.md](reference/runtruck1/data-model.md), which this document supersedes wherever they differ).

Contents: §1 conventions · §2 platform tables · §3 entity-relationship overview · §4 enum catalogue · §5 domain tables · §6 derived values (rules the API computes) · §7 seed mapping · §8 where computed values differ from Runtruck1 (D5) · §9 migrations and database-level rules.

---

## 1. Conventions

### 1.1 Naming

- Tables: plural `snake_case` (`load_stops`). Columns: `snake_case`. Enum types: singular `snake_case` (`load_status`); enum values `lower_snake_case`.
- Drizzle keys are camelCase and mapped by `casing: 'snake_case'` (`loadNumber` ↔ `load_number`). Exported table constants are the camelCase table name (`loadStops`), enum constants the camelCase enum name (`loadStatus`).
- Constraint and index names: `<table>_<what>_uq` (unique), `_idx` (index), `_ck` (check), `_fk` (foreign key), `<table>_org_id_uq` (tenant key, §1.3).
- Suffixes: `_cents` money in integer cents, `_bp` basis points, `_on` business date (`date`), `_at` instant (`timestamptz`), `_miles`/`_lb`/`_in`/`_ft` units, `_id` reference.

### 1.2 Standard columns

Every tenant table starts with the **standard columns**; the tables in §5 list them as one row:

| column | type | null | default | notes |
|---|---|---|---|---|
| `id` | `uuid` | not null | `gen_random_uuid()` | primary key (architecture §8) |
| `organization_id` | `uuid` | not null | — | FK → `organizations(id)` ON DELETE RESTRICT (`organizationId()` in `platform.ts`) |
| `created_at` | `timestamptz` | not null | `now()` | |
| `updated_at` | `timestamptz` | not null | `now()` | bumped by Drizzle `$onUpdate` on every ORM update |

Append-only tables (`load_activity`, `document_versions`, and the platform `audit_logs`) have `created_at` but no `updated_at`.

### 1.3 Tenancy (architecture Rule 3)

- `organization_id` is on every tenant row, including child rows (stops, items, versions), so every query can filter by the session's organization without a join.
- **Tenant key.** Every tenant table has `UNIQUE (organization_id, id)` named `<table>_org_id_uq`.
- **Tenant-safe foreign keys.** Every reference from one tenant table to another is a **composite** foreign key `(organization_id, <x>_id) → <x>(organization_id, id)`. A row therefore cannot point at another organization's row even if application code is wrong. Nullable reference columns use the default `MATCH SIMPLE`, so a null `<x>_id` skips the check. References to the global `users` table are single-column.
- **Tenant indexes lead with `organization_id`.** The only index that does not is `document_versions_storage_key_uq`, because object keys are unique across the whole bucket (the key itself begins with the organization id).
- Platform tables (§2) predate this rule and use single-column foreign keys; they are not redesigned (design brief §1).

### 1.4 Deletion

- Business rows are not hard-deleted by normal actions: loads are archived (`archived_at`), invoices, bills, settlements, claims and contracts change status.
- `ON DELETE CASCADE` is used only from a parent to rows it owns (stops, dispatches and activity of a load; versions of a document; items of an invoice, batch or settlement; a customer's contacts; a driver's mileage entries, qualification documents and reminders; an onboarding case's document requests). Every other reference is `ON DELETE RESTRICT`.
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

There are no search columns. The web filters the rows it holds with Runtruck1's `matchesQuery`; server-side `q` (architecture §37) is evaluated by the API over the same display strings it returns (docs/04-api.md §5).

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
| `created_at`, `updated_at` | `timestamptz` | not null | `now()` | |

Unique: `organizations_company_number_uq (company_number)`.

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

PK: `(role_id, permission_id)`. No `organization_id`: the role row carries the tenant.

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

PK: `(organization_id, key)`.

### 2.10 `audit_logs` (append-only)

Architecture §30. Written by `AuditService.record` in the same transaction as every write. A trigger rejects `UPDATE` and `DELETE` (§9.2).

| column | type | null | default | notes |
|---|---|---|---|---|
| `id` | `uuid` | not null | `gen_random_uuid()` | PK |
| `organization_id` | `uuid` | not null | | FK → `organizations(id)` ON DELETE RESTRICT |
| `actor_user_id` | `uuid` | null | | FK → `users(id)` ON DELETE RESTRICT; null for system actions (seed, workers) |
| `action` | `text` | not null | | e.g. `LOAD_CREATED`, `SETTLEMENTS_APPROVED`, `PLANNER_RESET` |
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
