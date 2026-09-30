# Runtruck1 → Runtruck2 port spec: DATA MODEL DERIVATION

Scope: every mock record in `app/src/data/*.ts`, the TypeScript interfaces that shape them, and every value a screen derives from them. Output: a normalized PostgreSQL + Drizzle schema that reproduces every record and every displayed string of Runtruck1, following `C:/Users/mashi/Runtruck2/docs/02-development-architecture.md` (the architecture doc; cited as "Arch §n").

Reference clock: **today = 2026-09-03, which is a Thursday** (the mock comments call it Wednesday; that is wrong — Sep 1 2026 is a Tuesday and Sep 7 is Labor Day Monday) (`data/planner.ts:7` `TODAY = '2026-09-03'`, `data/accounting.ts:5` `TODAY = 'Sep 3'`). All worked values below assume that date and the organization time zone `America/Los_Angeles`.

Every number in §6 was checked by running the prototype's own data files and page formulas under Node 24 (type-stripped copies of `data/*.ts`), not worked out by hand.

---

## 0. Key decisions (read first)

1. **Store facts; derive the display.** Every `tagClass`, `age`, `rpm`, `margin`, "Overdue", "Expiring", "Service due", "Renewal due", KPI count and KPI sum in Runtruck1 is either (a) derivable from stored facts with a rule given in §6, or (b) listed in §7 as **not derivable**, to be stored or seeded as a snapshot. The mock's display strings (`'$2,450'`, `'41 d'`, `'Sep 3'`, `'T-114 / RF-88'`) never go into the database.
2. **A pinned, tenant-aware clock is required.** Ages, overdue, expiring, "this week", "Today HH:MM", "Renewal due (30 d)" and "Expiring (60 d)" all depend on "today". The API needs a `Clock` service whose value can be overridden (e.g. `RUNTRUCK_CLOCK_TODAY=2026-09-03` in dev/demo/test). "Today" is the **organization-local** date (`organizations.timezone`), never the UTC date. Without this, every derived value drifts the day after seeding.
3. **Money is integer cents** (`integer` per line, `bigint` for aggregates/snapshots). Rates per mile are integer cents per mile. Percentages are integer basis points. **Every money sum, margin, rate per mile, age, overdue flag and KPI total is computed by the API** (Arch §5 "Financial calculations that require authoritative results", Rule 2) and returned as numbers. The web app only formats them.
4. **Human numbers stay; UUIDs are the keys.** `L-40218`, `INV-8845`, `B-2035`, `CLM-1112`, member ID `100482731` and company ID `30017` become integer columns with per-org uniqueness, allocated by a `number_sequences` row. Every PK is a UUID (Arch §8). The URL `/app/loads/L-40218` keeps using the load number, resolved server-side by `(organization_id, load_number)`.
5. **Two mock quirks force extra columns:**
   - The load **route** uses a *market* city (`'Fresno, CA → Reno, NV'`) that differs from the facility address city (`Sparks, NV`). This needs `facilities.market_city/market_state/market_short`.
   - The **planner** shows mock-load stops at hash-derived slots (`data/planner.ts:168-171`) that differ from the appointment windows on the Loads page (`08:00–14:00` / `06:00–12:00`). So `load_stops` stores both an appointment window (in `appointments`) and a planned slot (`planned_start_at/planned_end_at`).
6. **Planner events and color codes are business data** (they are `localStorage` in Runtruck1, `PlannerPage.tsx:99-101`). They move to PostgreSQL. Only view prefs (`runtruck-planner-prefs`) and theme (`runtruck-theme`) may stay client-side.
7. **Several mock aggregates cannot be reproduced from the mock records.** These are customer YTD metrics, AR aging, batch totals, driver Pay YTD, weekly driver miles, revenue bars and three dashboard KPIs (§7). There are two options:
   - (A) Seed synthetic history large enough to produce them.
   - (B) Seed `metric_snapshots` rows and serve them until live data replaces them.

   Recommendation: **B for the demo seed, but a product decision is needed.** Under B those tiles are not live.

---

## 1. Files covered

Primary area (read in full):

| Path (under `app/src/`) | Lines | Contents |
|---|---|---|
| `data/mock.ts` | 332 | NAV, USER, `Load`/`LoadStop` + LOADS (8), `stopsOf`, CARRIERS (5), DRIVERS (6), TRUCKS (6), TRAILERS (8), CUSTOMERS (6), TOP_ACCOUNTS (3), INVOICES (6), SETTLEMENTS (5), SETTLE_TAG, ACTIVE_STATUSES, SECTION_TABS, COMPLIANCE (3), AR (4), REVENUE_BARS/DAYS |
| `data/accounting.ts` | 127 | TODAY, `daysBetween`, `ageDays`, `dollars`, `money`, UNINVOICED (11), INVOICES_EXTRA (10), ALL_INVOICES, PAYMENTS (5), BATCHES (7), BILLS (8) |
| `data/fleet.ts` | 15 | WATCHLIST (COMPLIANCE + 1) |
| `data/hr.ts` | 57 | CONTRACTS (10), ONBOARDING (6) and their union types |
| `data/planner.ts` | 180 | TODAY, TONES, DEFAULT_CATEGORIES (6), `PlannerEvent`, prefs types/defaults, `cityState`, STANDUPS (27), PLANNER_EVENTS (15 + 27), `loadEvents` |
| `data/safety.ts` | 102 | `money`, MAINTENANCE (8), DRIVER_DOCUMENTS (15), VIOLATIONS (7), CLAIMS (6) |

Read in full to find which fields each screen uses and how it derives them. These files are *consumers*; other specs cover their UI.

| Path | Lines | Why |
|---|---|---|
| `lib/dates.ts` | 58 | date helpers used by planner data |
| `lib/persist.ts` | 24 | `usePersisted` (localStorage) |
| `lib/search.ts` | 10 | `matchesQuery` search semantics |
| `lib/theme.ts` | 31 | theme storage |
| `context/AppShellContext.tsx` | 51 | `loads` = created + LOADS, `approved` flag |
| `App.tsx` | 81 | routes / URL shapes |
| `components/Header.tsx` | 87 | `Invoice ${UNINVOICED.length} loads`, action buttons |
| `components/Sidebar.tsx` | 55 | USER fields |
| `components/SettingsDialog.tsx` | 114 | USER fields |
| `components/Tag.tsx` | 12 | tagClass → chip map |
| `components/Kpis.tsx` | 24 | KPI tile shape |
| `components/NewLoadDialog.tsx` | 763 | the only write path for loads; `toLoad` shows how display strings are built from raw input |
| `components/EventDialog.tsx` | 132 | planner event write path |
| `components/CalendarSettings.tsx` | 221 | color codes / prefs write path |
| `pages/app/*.tsx`, `pages/app/*/*.tsx` | 68–568 each | every KPI formula (§6) |

---

## 2. Global conventions

### 2.1 Columns every tenant-owned table carries
`id uuid primary key default gen_random_uuid()`, `organization_id uuid not null references organizations(id)`, `created_at timestamptz not null default now()`, `updated_at timestamptz not null default now()`. Business tables that users can delete also get `deleted_at timestamptz null` (soft delete). Arch forbids hard-deleting financial rows through normal actions (Arch §18).

Every index on tenant data leads with `organization_id`. Every query filters by the `organization_id` taken from the authenticated session (Arch §10, Rule 3/4).

### 2.2 Human-readable numbers
Table `number_sequences(organization_id, key text, next_value bigint)` with primary key `(organization_id, key)`. Keys and seed next values:

| key | column | display | seed next_value |
|---|---|---|---|
| `load` | `loads.load_number int` | `L-${n}` | 40223 (the prototype's `nextId` = max+1, `NewLoadDialog.tsx:196-198`) |
| `invoice` | `invoices.invoice_number int` | `INV-${n}` | 8846 |
| `invoice_batch` | `invoice_batches.batch_number int` | `B-${n}` | 2036 |
| `claim` | `claims.claim_number int` | `CLM-${n}` | 1113 |

Allocation happens with `UPDATE … RETURNING` inside the create transaction, never client-side. The prototype computes `max+1` in the browser, which races.

### 2.3 Money
- The amount of a single row is stored as `integer` cents (`amount_cents`). A snapshot or aggregate is stored as `bigint` cents.
- Formatting (web only):
  - **F-MONEY:** `money(c) = '$' + (c/100).toLocaleString('en-US')`, e.g. `245000 → '$2,450'`.
    - Every mock amount is a whole dollar. For non-whole values, pin `Intl.NumberFormat('en-US',{minimumFractionDigits:0, maximumFractionDigits:2})`. The prototype's bare `toLocaleString` would print `$1,326.8`. Confirm with product whether cents should always show.
  - **F-SIGNED:** negative amounts print `'-$142'` (`NewLoadDialog.tsx:134-136`, mock `SETTLEMENTS.ded`). Zero deductions print `'—'`.
  - **F-K:** `'$412K'` = `'$' + Math.round(dollars/1000) + 'K'`.
  - **F-K1:** `'$91.9K'` = `'$' + (Math.round(dollars/100)/10).toFixed(1) + 'K'`. Round to the hundred first: `91,850 → 91.9`. Using `toFixed(1)` alone gives `91.8`.
  - **F-M1:** `'$1.3M'` = `'$' + (Math.round(dollars/100000)/10).toFixed(1) + 'M'` (`1,295,000 → 1.3`).
- **F-RPM** rate per mile: `'$' + (line_haul_cents / miles / 100).toFixed(2)`. The API returns `rate_per_mile_cents = round(line_haul_cents / loaded_miles)` (half-up), and all 8 mock loads give the same string either way. It is `'—'` when miles = 0 or null.

### 2.4 Dates, times, time zones
- **Business dates** (invoice issued/due, bill due, contract start/renew, violation date, claim date, doc expiry, work-order due, settlement period, planner all-day events) are `date`.
- **Instants** (stop arrival and completion, appointment windows, planned slots, timed planner events, payments received, activity, audit) are `timestamptz` stored in UTC (Arch §9).
- **Stop times** display in the **facility's local wall-clock time** (`facilities.timezone`). Mock examples: `08:00–14:00`, `06:00–12:00`, and planner slots such as L-40210 delivery `16:00` in Denver. Converting a Denver 16:00 to the org time zone would show 15:00 and break pixel parity.
- **Office times** (planner office events, "Today 07:12" activity) display in the org time zone.
- **F-SHORT:** `'MMM d'` without a leading zero (`'Sep 3'`, `'Aug 31'`). Every short date in the mock is in 2026.
- **F-DATE:** `'MMM d'` when the year is the current org year, else `'MMM d, yyyy'`. This reproduces every HR date (`'Mar 14, 2022'`, `'Jan 12'`, `'Oct 1'`, `'Mar 14, 2027'`). Use it everywhere F-SHORT appears so that dates from other years stay unambiguous.
- **F-MONTHYEAR:** `'MMM yyyy'` (`'Apr 2028'`). **F-MMYYYY:** `'MM/yyyy'` (`'04/2028'`, Drivers tab CDL).
- **F-AGE:** `${days} d`, where days = org-local today − `issued_on`. It is `'—'` when not issued.
- **F-HOS:** minutes → `${Math.floor(m/60)}h ${String(m%60).padStart(2,'0')}m` (`380 → '6h 20m'`, `545 → '9h 05m'`). `null → '—'`.
- **F-TODAY-TIME:** activity timestamp `'Today HH:mm'` (24 h, zero-padded) when the instant falls on org-local today. The format for other days is undefined in the prototype; proposed `'MMM d HH:mm'`.
- Planner office events are stored as `starts_at/ends_at timestamptz` for timed events, or `start_date/end_date date` for all-day events. They are rendered in the org time zone as `'HH:MM'`.

### 2.5 Status → label → chip
The mock carries a `tagClass` per row. `Tag.tsx:3-8` maps it to a chip: `tag-accent → ui-chip-blue`, `tag-neutral → ui-chip-gray`, `tag-outline → ui-chip-amber`, `tag-green → ui-chip-green`, anything else → `ui-chip-gray`. **Nothing chip-related is stored.**
- The API returns the stored enum plus a derived `display_status` key.
- The web maps `display_status` → label and chip tone using the tables in §3.
- Every mock status maps to exactly one tagClass. This was verified for all 17 collections, so the mapping is total and deterministic.

### 2.6 Formatting of counts, miles and weights
- **F-INT:** `n.toLocaleString('en-US')` (`'1,142'`, `'9,120'`, `'41,200 lb'`, `'529,800 mi'`, `'318,440'`). Always pass `'en-US'`. `DriversTab.tsx:75,83` and `TrucksTab.tsx:20` call `toLocaleString()` without a locale, which produces an SSR hydration mismatch on non-en servers.
- Plain small counts (`'184'`, `'22 invoices'`) use `String(n)`.

---

## 3. Enum catalogue (pgEnum) with display mapping

Chip tones: B = blue (`tag-accent`), G = gray (`tag-neutral`), A = amber (`tag-outline`), Gr = green (`tag-green`).

### 3.1 Loads
`load_status`, the stored lifecycle (Arch §17): `draft, booked, dispatched, at_pickup, loaded, in_transit, at_delivery, delivered, pod_received, ready_for_billing, invoiced, paid, cancelled`.
`load_exception`: `none, delayed`.

**Derived `load_display_status`** (label, chip). The rule runs top to bottom:

| rule (first match) | label | chip |
|---|---|---|
| status in (booked, draft) and no active dispatch and not brokered | `Needs driver` | A |
| exception = delayed and status in (at_pickup, loaded, in_transit, at_delivery) | `Delayed` | A |
| status = dispatched | `Dispatched` | G |
| status = at_pickup | `At pickup` | G |
| status in (loaded, in_transit, at_delivery) | `In transit` | B |
| status = delivered (no POD document) | `Needs POD` | A |
| status in (pod_received, ready_for_billing, invoiced, paid) | `Delivered` | G |

`ACTIVE_STATUSES` (`mock.ts:288`) = the display statuses `In transit, At pickup, Dispatched, Delayed, Needs driver`. This is the API filter `view=active`.
Loads-page filter tabs: `Active` | `Needs POD` | `Delivered` | `All` (`LoadsPage.tsx:10`). Map them to `view=active|needs_pod|delivered|all`.

Other load enums:
- `load_mode`: `ftl` → `'Full truckload'`, `ltl` → `'Less than truckload'`, `partial` → `'Partial'` (`NewLoadDialog.tsx:179`). Choice labels in the form are `FTL / LTL / Partial`.
- `equipment_type` (form list at `NewLoadDialog.tsx:11`):

  | enum | label |
  |---|---|
  | `dry_van_53` | `'Dry van, 53 ft'` |
  | `reefer_53` | `'Reefer, 53 ft'` |
  | `flatbed_48` | `'Flatbed, 48 ft'` |
  | `flatbed_tarped` | `'Flatbed, tarped'` |
  | `step_deck_48` | `'Step deck, 48 ft'` |
  | `power_only` | `'Power only'` |
  | `box_truck_26` | `'Box truck, 26 ft'` |

  An equipment is reefer when the label starts with `Reefer`.
- `packaging`: `pallets, skids, crates, boxes, drums, totes, loose` → Title-case labels.
- `ltl_service`: `liftgate_pickup 'Liftgate at pickup'`, `liftgate_delivery 'Liftgate at delivery'`, `residential 'Residential delivery'`, `inside 'Inside delivery'`, `delivery_appointment 'Delivery appointment'`, `limited_access 'Limited access'`.
- `freight_class`: stored as `text` limited to `50,55,60,65,70,77.5,85,92.5,100,110,125,150,175,200,250,300,400,500`.
- `payment_terms`: `net_15 'Net 15'`, `net_30 'Net 30'`, `net_45 'Net 45'`, `net_60 'Net 60'`, `quick_pay 'Quick pay'`. Also stored as `terms_days` (15/30/45/60/0) for due-date math.
- `stop_kind`: `pickup 'Pickup'`, `delivery 'Delivery'`, `fuel 'Fuel stop'`.
- `stop_status`: `pending, arrived, completed`.
- `document_type`: `rate_confirmation 'Rate confirmation'`, `customer_load_tender 'Customer load tender'`, `bill_of_lading 'Bill of lading'`, `proof_of_delivery 'Proof of delivery'`, `lumper_receipt 'Lumper receipt'`, plus the driver-qualification types in §3.5.

### 3.2 Parties and workforce
- `customer_standing`: `key_account 'Key account'` B, `growing 'Growing'` G, `at_risk 'At risk'` A.
- `driver_duty_status`: `on_duty 'On duty'` B, `available 'Available'` G, `home_time 'Home time'` G, `off_duty 'Off duty'` G.
  - Dashboard dot color: on_duty → `var(--ui-primary)`, available → `var(--ui-green)`, else `var(--ui-muted)`.
- `driver_roster_status`: `onboarding, active, inactive`. The roster shows only `active` rows.
- `employee_role`: `company_driver 'Company driver'`, `owner_operator 'Owner-operator'`, `dispatcher 'Dispatcher'`, `mechanic 'Mechanic'`.
- `contract_type`: `w2 'W-2'`, `c1099 '1099'`, `lease_purchase 'Lease-purchase'`.
- `contract_state`: `draft, signed, terminated`.
- `renewal_kind`: `renews, ends` (ends = "term ends with no renewal on file").
- **Derived contract display:**

  | rule (first match) | label | chip |
  |---|---|---|
  | state = draft | `Draft` | G |
  | renewal_kind = ends and end within 90 d (assumption, see §8) | `Expiring` | A |
  | renews_on − today ≤ 30 d | `Renewal due` | A |
  | otherwise | `Active` | Gr |

- `pay_basis_type` and its formatting:

  | type | stored as | display |
  |---|---|---|
  | `per_mile` | `pay_rate_cents` | `'$' + (c/100).toFixed(2) + ' / mi'` → `'$0.62 / mi'` |
  | `percent_line_haul` | `pay_percent_bp` | `bp/100 + '% of line haul'` → `'25% of line haul'` |
  | `salary_annual` | cents | F-MONEY + `' / yr'` → `'$68,000 / yr'` |
  | `hourly` | cents | `'$' + (c/100).toFixed(2) + ' / hr'` → `'$34.50 / hr'` |

- `onboarding_stage`: `application 'Application'` G, `background_check 'Background check'` A, `road_test 'Road test'` B, `orientation 'Orientation'` B, `complete 'Complete'` Gr. This reproduces the mock tagClass exactly.

### 3.3 Equipment
- `truck_status`: `in_service, in_shop, out_of_service`. **Derived display:**
  - `in_shop` → `'In shop'` A.
  - `in_service` and `next_service_odometer − odometer ≤ org.service_due_threshold_miles` (default 1,000; assumption) → `'Service due'` A.
  - `in_service` otherwise → `'In service'` B.
- `trailer_type`: `reefer 'Reefer'`, `dry_van 'Dry van'`, `flatbed 'Flatbed'`. Display = `${label} · ${length_ft} ft`.
- `trailer_load_state`: `loaded 'Loaded'` B, `empty 'Empty'` G, `inspection 'Inspection'` A.
- `trailer_location_kind`: `yard, en_route, city`. Display:
  - yard → `'Yard · ' + facility.city` (`'Yard · Modesto'`)
  - en_route → `'En route · ' + corridor` (`'En route · I-80'`)
  - city → `city + ', ' + state` (`'Bakersfield, CA'`)

### 3.4 Billing, payables, payroll
- `invoice_status`: `draft, sent, paid, void`. **Derived display:**
  - `draft` → `'Draft'` A.
  - `paid` → `'Paid'` Gr.
  - `sent` and `due_on < today` → `'Overdue'` A.
  - `sent` → `'Sent'` B.
- `payment_method`: `ach 'ACH'` G, `check 'Check'` G, `factoring 'Factoring'` B (`PaidTab.tsx:53`).
- `invoice_batch_status`: `ready 'Ready'` B, `sent 'Sent'` B, `settled 'Settled'` Gr.
- `batch_recipient_kind`: `customer, factoring_company`.
  - `sentTo` = customer name, or `factor.name + ' (factoring)'` (`'TriPoint Capital (factoring)'`).
- `bill_state`: `open, scheduled, paid, void`. **Derived display:**
  - `paid` → `'Paid'` Gr.
  - `scheduled` → `'Scheduled'` B.
  - `open` and `due_on < today` → `'Overdue'` A.
  - `open` → `'Due'` A.
- `settlement_status`: `draft, ready, approved, on_hold, paid`.
  - Display: `ready 'Ready'` B, `approved 'Approved'` B, `paid 'Paid'` Gr, `on_hold` → `'Hold · ' + hold_reason` A.
  - `SETTLE_TAG` (`mock.ts:281-286`) only knows `'Hold · fuel'`. Any other hold reason falls back to gray in the prototype. Map on the enum, not the label.
- `settlement_item_kind`: `line_pay, deduction, reimbursement`.

### 3.5 Safety
- `work_order_state`: `scheduled, in_shop, done, cancelled`. **Derived display:**
  - `in_shop` → `'In shop'` A.
  - `done` → `'Done'` G.
  - `scheduled` and (`due_on < today`, or `due_odometer ≤ unit odometer`) → `'Overdue'` A.
  - `scheduled` and `due_odometer − odometer ≤ threshold` → `'Due'` A.
  - `scheduled` → `'Scheduled'` B.
- `dq_item_type`: `cdl 'CDL'`, `medical_card 'Medical card'`, `mvr 'MVR'`, `annual_review 'Annual review'`, `drug_test 'Drug test'`, `clearinghouse_query 'Clearinghouse query'`.
- **Derived DQ status:**
  - `expires_on is null` → `'Missing'` A.
  - `< today` → `'Expired'` A.
  - `≤ today + 60 d` → `'Expiring'` A.
  - otherwise `'Valid'` Gr.
- `violation_status`: `open 'Open'` A, `contested 'Contested'` B, `closed 'Closed'` G.
- `claim_type`: `cargo_damage 'Cargo damage'`, `property_damage 'Property damage'`, `bodily_injury 'Bodily injury'`, `cargo_shortage 'Cargo shortage'`.
- `claim_status`: `open 'Open'` A, `under_review 'Under review'` B, `settled 'Settled'` Gr, `denied 'Denied'` G.
- `claimant_kind`: `customer, facility, third_party`.

### 3.6 Planner
- `planner_tone`: `amber, green, red, purple, blue, teal, pink, orange, indigo, slate` (`planner.ts:11`, CSS classes `t-<tone>`).

---

## 4. Schema (Drizzle-friendly)

Notation: `col type [null] -- note`. Every table also has the §2.1 columns unless marked *(global)*. "FK" means `references x(id)`, and for tenant tables a composite `(organization_id, id)` FK is recommended so a row can never point at another tenant's row.

### 4.1 Tenancy and identity (Arch §7, §10–13)

**organizations** *(global)*

| column | type | note |
|---|---|---|
| name | text | `'Sunridge Freight'` (`mock.ts:44`) |
| company_number | int unique | `30017`, shown as "Company ID" |
| timezone | text | `'America/Los_Angeles'` |
| service_due_threshold_miles | int default 1000 | |
| settings | jsonb default '{}' | |

**users** *(global)*

| column | type | note |
|---|---|---|
| email | citext unique | `'rosa.medina@sunridgefreight.com'` |
| full_name | text | `'Rosa Medina'` |
| member_number | bigint unique | `100482731`, shown as "Member ID" |
| password_hash | text | details in the future `05-authentication.md` |
| last_login_at | timestamptz null | |

**organization_members**

| column | type | note |
|---|---|---|
| user_id | FK users | |
| job_title | text | `'Dispatch'` (the sidebar shows `${job_title} · ${org.name}`) |
| employee_id | FK employees null | |
| status | enum `active, invited, disabled` | |

Unique `(organization_id, user_id)`.

**roles**

| column | type | note |
|---|---|---|
| organization_id | uuid **null** | null = system role template |
| key | text | e.g. `owner, admin, dispatcher, accounting, manager, maintenance, safety, hr, driver` |
| name | text | |

Unique `(organization_id, key)`.

**permissions** *(global)*: `key text pk`, `description text`. The full list is in §10.

**role_permissions**: `role_id FK`, `permission_key FK`. Primary key is the pair.

**user_roles**: `user_id FK users`, `role_id FK roles`. Unique `(organization_id, user_id, role_id)`.

Seed: Rosa gets `admin` so that every Runtruck1 screen stays visible (§10.3).

### 4.2 Parties and places

**customers**

| column | type | note |
|---|---|---|
| name | text | |
| standing | customer_standing | |
| payment_terms | payment_terms | |
| terms_days | int | |
| primary_contact_id | FK customer_contacts null | |
| sort_key | int | hand order (§5.2) |

Unique `(organization_id, lower(name))`.

**customer_contacts**: `customer_id FK`, `full_name text`, `email text null`, `phone text null`, `is_primary bool`.

**carriers**

| column | type | note |
|---|---|---|
| name | text | `'Sunridge Freight'` for the own authority |
| mc_number | text null | stored `'812044'`; display `'MC 812044'` |
| dot_number | text null | stored `'2291176'`; display `'DOT 2291176'` |
| is_own_fleet | bool | display name = `name + ' (own fleet)'` when true |
| position | int | |

Partial unique index: one own-fleet row per org (`where is_own_fleet`).

**factoring_companies**: `name text` (`'TriPoint Capital'`).

**vendors**: `name text` (`'Verizon Connect ELD'`, `'Modesto Yard — Lease'`, …).

**facilities**

| column | type | note |
|---|---|---|
| name | text | |
| kind | enum `shipper, consignee, port, yard, shop, crossdock, other` | |
| customer_id | FK null | |
| vendor_id | FK null | for outside shops |
| address_line1 | text null | |
| city | text | |
| state | char(2) | |
| postal_code | text null | |
| timezone | text | |
| market_city | text null | route label city; falls back to `city` |
| market_state | char(2) null | falls back to `state` |
| market_short | text null | driver-card abbreviation, e.g. `'SLC'`; falls back to the market city |

Index `(organization_id, kind)`.

### 4.3 Workforce

**employees**

| column | type | note |
|---|---|---|
| first_name | text | |
| last_name | text | KPI notes use the last name: `'Nakamura · 1h 45m'`, `'Raman Sep 20'` |
| role | employee_role | |
| status | enum `active, onboarding, terminated` | |
| user_id | FK users null | |
| sort_key | int | |

**drivers**

| column | type | note |
|---|---|---|
| employee_id | FK employees unique | |
| roster_status | driver_roster_status | |
| duty_status | driver_duty_status | |
| sort_key | int | roster order |

**driver_hos_status** (one current row per driver; ELD snapshot)

| column | type | note |
|---|---|---|
| driver_id | FK unique | |
| drive_remaining_minutes | int null | null → `'—'` |
| as_of | timestamptz | |
| source | enum `eld, manual, seed` | |

**driver_daily_logs** (ELD mileage; feeds "Miles per driver, this week")

| column | type |
|---|---|
| driver_id | FK |
| log_date | date |
| miles | int |

Unique `(driver_id, log_date)`.

**employee_contracts**

| column | type | note |
|---|---|---|
| employee_id | FK | |
| role | employee_role | |
| contract_type | contract_type | |
| state | contract_state | |
| starts_on | date | |
| renewal_kind | renewal_kind | |
| renews_on | date | renewal date, or term end when kind = ends |
| pay_basis_type | pay_basis_type | |
| pay_rate_cents | int null | |
| pay_percent_bp | int null | |
| signed_at | timestamptz null | |

CHECK: exactly one of the rate or percent columns is set, matching the type.

**onboarding_cases**

| column | type | note |
|---|---|---|
| candidate_name | text | |
| employee_id | FK null | set once hired: Jamal, Evan |
| role | employee_role | |
| stage | onboarding_stage | |
| started_on | date | |
| owner_employee_id | FK employees | Rosa or Luis |
| progress_pct | smallint 0..100 | |
| next_step_label | text | |
| next_step_on | date null | display = `label + (on ? ' · ' + F-SHORT(on) : '')` |
| completed_on | date null | |

**onboarding_document_requests**

| column | type | note |
|---|---|---|
| case_id | FK | |
| label | text | |
| status | enum `pending, received` | |
| position | int | |

`docsPending` = exists pending.

### 4.4 Equipment

**trucks**

| column | type | note |
|---|---|---|
| unit_number | text | `'T-114'` |
| make | text | |
| model | text | |
| model_year | smallint | display `${make} ${model} · ${year}` |
| plate_state | char(2) | |
| plate_number | text | display `${state} ${number}` |
| assigned_driver_id | FK drivers null, unique | |
| odometer_miles | int | |
| odometer_read_at | timestamptz | |
| next_service_odometer | int null | null → `'—'` |
| status | truck_status | |

Unique `(organization_id, unit_number)`.

**trailers**

| column | type | note |
|---|---|---|
| unit_number | text | |
| trailer_type | trailer_type | |
| length_ft | smallint | |
| load_state | trailer_load_state | |
| location_kind | trailer_location_kind | |
| location_facility_id | FK facilities null | |
| location_corridor | text null | |
| location_city | text null | |
| location_state | char(2) null | |
| location_as_of | timestamptz | |
| sort_key | int | |

Unique `(organization_id, unit_number)`.

### 4.5 Loads (Arch §17, §19, §21)

**loads**

| column | type | note |
|---|---|---|
| load_number | int | unique `(organization_id, load_number)` |
| customer_id | FK | |
| bill_to_customer_id | FK null | |
| tender_ref | text null | display Reference = `tender_ref ?? customer_po ?? '—'` (`NewLoadDialog.tsx:171`) |
| customer_po | text null | |
| mode | load_mode **null** | mock loads have none, so the Mode row is hidden |
| equipment_type | equipment_type | |
| dispatcher_user_id | FK users null | |
| commodity | text | |
| weight_lb | int | |
| pieces | int null | |
| packaging | packaging null | |
| declared_value_cents | int null | |
| temperature_f | numeric(5,1) null | |
| hazmat | bool default false | |
| un_number | text null | |
| freight_class | text null | |
| nmfc | text null | |
| handling_units | int null | |
| length_in | int null | |
| width_in | int null | |
| height_in | int null | |
| stackable | bool null | |
| ltl_services | ltl_service[] default '{}' | |
| brokered | bool | |
| carrier_id | FK carriers null | null = "Not yet covered" |
| carrier_contact_name | text null | |
| carrier_phone | text null | |
| loaded_miles | int null | |
| payment_terms | payment_terms | |
| status | load_status | |
| exception | load_exception default 'none' | |
| driver_instructions | text null | |
| internal_notes | text null | |
| archived_at | timestamptz null | see below |
| created_by_user_id | FK users | |

Load-level rules:
- CHECK: `hazmat = false or un_number is not null`. CHECK: `mode <> 'ltl' or (freight_class is not null and handling_units > 0)`.
- `archived_at` means "closed off the dispatch board". The board lists `archived_at is null`. It exists so the 11 uninvoiced loads (§5.9) and the historical invoiced loads do not appear in the board's "Delivered"/"All" tabs.
- Indexes: `(organization_id, status)`, `(organization_id, customer_id)`, `(organization_id, created_at desc)`, and optionally a trigram index on `search_text` (§12).

**load_stops**

| column | type | note |
|---|---|---|
| load_id | FK | |
| sequence | smallint | unique `(load_id, sequence)` |
| kind | stop_kind | |
| facility_id | FK facilities null | |
| facility_name | text | snapshot; New Load uses free text |
| address_line1 | text null | |
| city | text | |
| state | char(2) | |
| postal_code | text null | |
| timezone | text | |
| appointment_date | date | the facility-local day; drives `pickup`/`delivery` = F-SHORT |
| reference_number | text null | Pickup #/Delivery # |
| site_contact | text null | |
| planned_start_at | timestamptz null | planner slot |
| planned_end_at | timestamptz null | |
| status | stop_status | |
| arrived_at | timestamptz null | |
| completed_at | timestamptz null | |
| note | text null | fuel stop text |

**appointments** (Arch §7 lists it; one per stop that has a window)

| column | type | note |
|---|---|---|
| load_stop_id | FK unique | |
| window_start_at | timestamptz | |
| window_end_at | timestamptz | equals start when only one time was given |
| confirmation_number | text null | |

No row means `'Any time'`.

**load_charges** (revenue lines)

| column | type |
|---|---|
| load_id | FK |
| charge_type | enum `line_haul, fuel_surcharge, accessorial` |
| amount_cents | int ≥ 0 |
| description | text null |

"Rate" / "Line haul" = the line_haul sum. "Total to customer" = the sum of all charges.

**load_costs**

| column | type | note |
|---|---|---|
| load_id | FK | |
| cost_type | enum `driver_pay, carrier_pay, operating_estimate` | |
| amount_cents | int | |
| settlement_item_id | FK null | |

- "Driver pay" / "Carrier cost" = driver_pay + carrier_pay. The label is `'Carrier cost'` when brokered.
- Margin = charges − all costs. Margin is `'—'` when there is no driver or carrier pay cost.

**dispatches** (Arch §19)

| column | type | note |
|---|---|---|
| load_id | FK | |
| carrier_id | FK | |
| driver_id | FK null | |
| driver_name_text | text null | brokered carrier's driver |
| truck_id | FK null | |
| truck_label | text null | |
| trailer_id | FK null | |
| trailer_label | text null | |
| status | enum `assigned, accepted, cancelled, completed` | |
| assigned_by_user_id | FK | |
| assigned_at | timestamptz | |
| accepted_at | timestamptz null | |

Partial unique index: one non-cancelled dispatch per load.
- Load "driver" display = driver full name, else `driver_name_text`, else `'Unassigned'`.
- Load "unit" display = non-empty `[truck, trailer]` joined with `' / '`, else `'—'`.

**documents** (Arch §21, metadata only; binaries in object storage)

| column | type | note |
|---|---|---|
| document_type | document_type | |
| load_id | FK null | |
| driver_id | FK null | |
| onboarding_case_id | FK null | |
| file_name | text | |
| storage_key | text | |
| mime_type | text | |
| file_size | int | |
| uploaded_by_user_id | FK | |
| source | enum `web, driver_app, seed` | |

**document_versions** (Arch §7): `document_id FK`, `version int`, `storage_key`, `file_size`, `uploaded_by_user_id`.

**load_document_requirements**

| column | type |
|---|---|
| load_id | FK |
| document_type | document_type |
| position | smallint |

- The per-load checklist shown in the Documents card. Row state: `'Attached'` Gr if a document of that type exists for the load, else `'Pending'` A.
- Mock loads get 3 rows (rate_confirmation, bill_of_lading, proof_of_delivery). New Load creates 5 rows in `DOCUMENTS` order (`NewLoadDialog.tsx:16`).

**load_activity** (user-facing timeline; written by the backend alongside `events`)

| column | type | note |
|---|---|---|
| load_id | FK | |
| occurred_at | timestamptz | |
| actor_user_id | FK null | |
| kind | enum `created, instructions, driver_accepted, arrived, document_uploaded, invoice_queued, consignee_notified, status_changed` | |
| message | text | rendered at write time from the kind plus parameters |

### 4.6 Billing (Arch §7 invoices, invoice_items, payments)

**invoices**

| column | type | note |
|---|---|---|
| invoice_number | int | unique per org |
| customer_id | FK | |
| status | invoice_status | |
| issued_on | date null | |
| terms_days | int | |
| due_on | date null | = `issued_on + terms_days` unless overridden (INV-8836, §8) |
| total_cents | bigint | = sum of items, maintained by the service |
| sent_at | timestamptz null | |
| paid_at | timestamptz null | |

Indexes: `(organization_id, status, due_on)`, `(organization_id, customer_id)`.

**invoice_items**

| column | type |
|---|---|
| invoice_id | FK |
| load_id | FK loads |
| charge_type | load_charges enum |
| description | text |
| amount_cents | int |

The "Load" column = the load number of the first item.

**payments**

| column | type | note |
|---|---|---|
| invoice_id | FK | multi-invoice payments would need a `payment_applications` join; not needed for Runtruck1 |
| received_at | timestamptz | the order-by key for the Paid tab |
| method | payment_method | |
| factoring_company_id | FK null | |
| amount_cents | int | |
| reference | text null | |

**invoice_batches**

| column | type | note |
|---|---|---|
| batch_number | int | |
| created_on | date | |
| recipient_kind | batch_recipient_kind | |
| customer_id | FK null | |
| factoring_company_id | FK null | |
| status | invoice_batch_status | |
| sent_at | timestamptz null | |
| settled_at | timestamptz null | |
| invoice_count_snapshot | int | frozen when the batch is sent (§7) |
| total_cents_snapshot | bigint | frozen when the batch is sent (§7) |

**invoice_batch_items**: `batch_id FK`, `invoice_id FK`. Unique `(batch_id, invoice_id)`.

### 4.7 Payables

**bills**

| column | type | note |
|---|---|---|
| vendor_id | FK | |
| category | text | `'Telematics'`, `'Facilities'`, `'Fuel card fees'`, `'Tires'`, `'Fuel'`, `'Parts'`, `'Insurance'`, `'Equipment lease'` |
| description | text null | display category = `category + (description ? ' · ' + description : '')` |
| truck_id | FK null | |
| due_on | date | |
| amount_cents | int | |
| state | bill_state | |
| scheduled_pay_on | date null | |
| paid_on | date null | |

### 4.8 Payroll (Arch §7 settlements, settlement_items)

**settlements**

| column | type | note |
|---|---|---|
| driver_id | FK | |
| period_start | date | |
| period_end | date | |
| pay_basis_type | pay_basis_type | snapshot at creation |
| pay_rate_cents | int null | snapshot |
| pay_percent_bp | int null | snapshot |
| status | settlement_status | |
| hold_reason | text null | |
| approved_by_user_id | FK null | |
| approved_at | timestamptz null | |
| paid_at | timestamptz null | |

Unique `(organization_id, driver_id, period_start)`.

**settlement_items**

| column | type | note |
|---|---|---|
| settlement_id | FK | |
| kind | settlement_item_kind | |
| load_id | FK null | |
| miles | int null | |
| description | text | |
| amount_cents | int | signed; deductions negative |

### 4.9 Safety and compliance

**maintenance_work_orders**

| column | type | note |
|---|---|---|
| truck_id | FK null | |
| trailer_id | FK null | CHECK exactly one of truck/trailer |
| item | text | |
| due_on | date null | |
| due_odometer | int null | CHECK at least one of the two due columns |
| shop_facility_id | FK facilities | display `${name} · ${city}` |
| estimate_cents | int | |
| state | work_order_state | |
| completed_on | date null | |
| sort_key | int | |

**driver_qualification_items**

| column | type | note |
|---|---|---|
| driver_id | FK | |
| item_type | dq_item_type | |
| expires_on | date null | null = Missing |
| document_id | FK documents null | |
| sort_key | int | |

Unique `(driver_id, item_type)`.

**violations**

| column | type |
|---|---|
| occurred_on | date |
| driver_id | FK |
| truck_id | FK |
| violation_type | text |
| severity_points | smallint |
| location_text | text |
| status | violation_status |

**claims**

| column | type | note |
|---|---|---|
| claim_number | int | |
| occurred_on | date | |
| driver_id | FK | |
| truck_id | FK | |
| trailer_id | FK null | |
| load_id | FK null | |
| claim_type | claim_type | |
| claimant_kind | claimant_kind | |
| claimant_customer_id | FK null | |
| claimant_facility_id | FK null | |
| claimant_name | text null | |
| reserved_cents | int | |
| paid_cents | int default 0 | |
| status | claim_status | |

Claimant display: the customer name, or the facility name, or `'Third party · ' + claimant_name`. This column is PII (§10.2).

### 4.10 Planner

**planner_color_codes**

| column | type | note |
|---|---|---|
| key | text | `'pickup'`, `'delivery'`, … for defaults; UUID text for user-added codes |
| label | text | |
| tone | planner_tone | |
| is_locked | bool | |
| position | int | |

Unique `(organization_id, key)`. Locked rows cannot be deleted; they are always sorted first (`PlannerPage.tsx:89-95`).

**planner_events**

| column | type | note |
|---|---|---|
| title | text | |
| color_code_id | FK | |
| all_day | bool | |
| start_date | date | |
| end_date | date null | inclusive; all-day only; > start_date |
| starts_at | timestamptz null | |
| ends_at | timestamptz null | CHECK `all_day or (starts_at < ends_at)` |
| place | text null | |
| notes | text null | |
| load_id | FK null | |
| created_by_user_id | FK | |
| deleted_at | timestamptz null | |

Index `(organization_id, start_date)`.

**planner_event_attendees**

| column | type | note |
|---|---|---|
| event_id | FK | |
| position | smallint | |
| display_name | text | |
| employee_id | FK null | |
| customer_contact_id | FK null | |
| onboarding_case_id | FK null | |

**user_preferences**

| column | type | note |
|---|---|---|
| user_id | FK | |
| key | text | e.g. `'planner'` |
| value | jsonb | |

Unique `(organization_id, user_id, key)`. Optional: the prefs are presentation state and may stay in localStorage (§9).

### 4.11 Reporting snapshots (only for the non-derivable KPIs in §7)

**metric_snapshots**

| column | type | note |
|---|---|---|
| metric_key | text | |
| subject_type | text null | |
| subject_id | uuid null | |
| period_start | date | |
| period_end | date | |
| value_numeric | numeric | |
| value_count | int null | |
| source | enum `seed, job` | |
| computed_at | timestamptz | |

Unique `(organization_id, metric_key, subject_type, subject_id, period_start)`.

### 4.12 Platform (Arch §23, §30)

**audit_logs** (append-only; no UPDATE/DELETE grant for the app role)

| column | type | note |
|---|---|---|
| actor_user_id | FK null | |
| action | text | e.g. `LOAD_CREATED`, `SETTLEMENTS_APPROVED`, `PLANNER_EVENT_DELETED` |
| entity_type | text | |
| entity_id | uuid | |
| before | jsonb | |
| after | jsonb | |
| request_id | text | |
| occurred_at | timestamptz | |

**events**

| column | type |
|---|---|
| type | text |
| aggregate_type | text |
| aggregate_id | uuid |
| payload | jsonb |
| occurred_at | timestamptz |
| published_at | timestamptz null |
| idempotency_key | text unique |

**number_sequences**: see §2.2.

---

## 5. Record-by-record mapping (mock constant → stored rows)

For every mock constant this section gives the stored form and the rule that turns it back into the exact displayed string. "(seed order)" means the list order is hand-authored. Reproduce it with the given `sort_key`/`created_at`, because no natural key matches.

### 5.1 `USER` (`mock.ts:41-48`) → organizations + users + organization_members + employees

| mock field | stored | display rule |
|---|---|---|
| `name 'Rosa Medina'` | users.full_name | as is; initials `'RM'` = first letter of each word (`SettingsDialog.tsx:60`) |
| `role 'Dispatch'` | organization_members.job_title | `${job_title} · ${org.name}` → `'Dispatch · Sunridge Freight'` |
| `company 'Sunridge Freight'` | organizations.name | |
| `email` | users.email | |
| `memberId '100482731'` | users.member_number | `String(n)` |
| `companyId '30017'` | organizations.company_number | `String(n)` |

Rosa is also `employees(first 'Rosa', last 'Medina', role dispatcher)`, linked through `organization_members.employee_id` (her contract is in CONTRACTS).

**Conflict:** her job title is "Dispatch" (`mock.ts:43`) but her contract role is "Dispatcher" (`hr.ts:28`). Store both as they are.

### 5.2 `CUSTOMERS` (`mock.ts:218-225`) + `TOP_ACCOUNTS` (`mock.ts:236-240`)

Seed order (sort_key 1–6): Northgate Foods, Bayline Distribution, Cascade Building Supply, Harbor Point Retail, Sierra Ag Partners, Vantage Home Goods. This is not revenue order: Harbor $121K comes before Sierra $154K.

| customer | primary contact (email) | payment_terms | standing |
|---|---|---|---|
| Northgate Foods | Dana Ruiz (`dana@northgate.com`) | net_30 | key_account |
| Bayline Distribution | Owen Petrakis (`ops@bayline.co`) | net_30 | key_account |
| Cascade Building Supply | Marta Lind (—) | net_45 | growing |
| Harbor Point Retail | Jules Amari (—) | net_30 | growing |
| Sierra Ag Partners | Ben Okafor (`ben@sierraag.com`) | net_60 | at_risk |
| Vantage Home Goods | Iris Chen (—) | net_30 | growing |

Not derivable. Seed these as `metric_snapshots` (§7) or compute them from history:

| customer | Loads YTD `loads` | Revenue `revenue` (F-K) | On time `onTime` | AR balance `ar` |
|---|---|---|---|---|
| Northgate Foods | 184 | $412K | 96% | $18,400 |
| Bayline Distribution | 151 | $338K | 94% | $12,900 |
| Cascade Building Supply | 77 | $196K | 91% | $21,300 |
| Harbor Point Retail | 44 | $121K | 89% | $6,100 |
| Sierra Ag Partners | 62 | $154K | 82% | $29,300 |
| Vantage Home Goods | 29 | $74K | 93% | $3,850 |

`tagClass` → derived from standing.

TOP_ACCOUNTS is **derived**:
- Filter: customers with standing in (key_account, at_risk).
- Order: key_account first, then at_risk, each by revenue_ytd desc.
- Limit 3.
- Result: Northgate, Bayline, Sierra. ✓
- `tier` = standing label. `contact` = `${contact.full_name} · ${contact.email}`: `'Dana Ruiz · dana@northgate.com'`, `'Owen Petrakis · ops@bayline.co'`, `'Ben Okafor · ben@sierraag.com'`.
- The card's Loads / Revenue / On time are the same metrics as the table.

### 5.3 `CARRIERS` (`mock.ts:138-144`) → carriers

| position | name | mc_number | dot_number | is_own_fleet |
|---|---|---|---|---|
| 0 | Sunridge Freight | 812044 | 2291176 | true |
| 1 | Valley Line Transport | 604117 | 1780342 | false |
| 2 | Cascade Reefer Express | 733905 | 2014588 | false |
| 3 | High Desert Hauling | 581230 | 1655901 | false |
| 4 | Golden State Flatbed | 690452 | 1893027 | false |

- Own-fleet display name = `'Sunridge Freight (own fleet)'`. MC display `'MC ' + n`, DOT display `'DOT ' + n`.
- New Load partner dropdown option text = `${name} · MC ${mc}`, e.g. `'Valley Line Transport · MC 604117'`.
- A load with `carrier_id is null` displays `'Not yet covered'`, `'—'`, `'—'` (only L-40221, `mock.ts:106`).

### 5.4 Facilities (derived from LOADS / MAINTENANCE / TRAILERS)

| name | kind | address_line1 | city, st | market (city, st / short) | timezone |
|---|---|---|---|---|---|
| Northgate Cold Storage | shipper | 4120 S Golden State Blvd | Fresno, CA | — | America/Los_Angeles |
| Reno Grocers DC | consignee | 1855 E Greg St | Sparks, NV | Reno, NV | America/Los_Angeles |
| Bayline DC 4 | shipper | 2900 Navy Dr | Stockton, CA | — | America/Los_Angeles |
| Wasatch Crossdock | crossdock | 1740 S 4130 W | Salt Lake City, UT | short `SLC` | America/Denver |
| Cascade Yard 2 | shipper | 8300 Elder Creek Rd | Sacramento, CA | — | America/Los_Angeles |
| Boise Builders Depot | consignee | 440 E Corporate Dr | Meridian, ID | Boise, ID | America/Boise |
| Port of Oakland, Berth 22 | port | 1599 Maritime St | Oakland, CA | — | America/Los_Angeles |
| Harbor Point DC | consignee | 6200 N Basin Ave | Portland, OR | — | America/Los_Angeles |
| Northgate Creamery | shipper | 3011 Buck Owens Blvd | Bakersfield, CA | — | America/Los_Angeles |
| Valley Foods DC | consignee | 2240 W Buckeye Rd | Phoenix, AZ | — | America/Phoenix |
| Bayline LA Annex | shipper | 5200 S Boyle Ave | Vernon, CA | Los Angeles, CA | America/Los_Angeles |
| Sunset Beverage DC | consignee | 3900 W Cheyenne Ave | North Las Vegas, NV | Las Vegas, NV | America/Los_Angeles |
| Sierra Ag Huller 3 | shipper | 1901 Crows Landing Rd | Modesto, CA | — | America/Los_Angeles |
| Front Range Foods | consignee | 5400 Havana St | Denver, CO | — | America/Denver |
| Cascade Mill | shipper | 3400 Airport Rd | Redding, CA | — | America/Los_Angeles |
| Duwamish Steel Yard | consignee | 8100 E Marginal Way S | Seattle, WA | — | America/Los_Angeles |
| Sunridge shop | shop | — | Modesto, CA | — | America/Los_Angeles |
| Sunridge yard | yard | — | Modesto, CA | — | America/Los_Angeles |
| Thermo King | shop (vendor) | — | Fresno, CA | — | America/Los_Angeles |
| Valley Truck Center | shop (vendor) | — | Stockton, CA | — | America/Los_Angeles |

Display rules:
- Mock address display: `${address_line1}, ${city}, ${state}` + (postal_code ? ` ${postal_code}` : '') → `'4120 S Golden State Blvd, Fresno, CA'`. The mock has no ZIP codes. New Load includes the ZIP: `` `${street}, ${City}, ${ST} ${zip}`.trim() `` (`NewLoadDialog.tsx:186`).
- Route label for one stop = `${market_city ?? city}, ${market_state ?? state}`.
- Driver-card short label = `market_short ?? market_city ?? city` (`'Fresno'`, `'SLC'`, `'Boise'`).

### 5.5 `DRIVERS` (`mock.ts:158-165`) → employees + drivers + driver_hos_status + driver_daily_logs + trucks.assigned_driver_id + dq items

Seed order (sort_key): Marcus, Dara, Ellis, Priya, Ana, Tobias. This equals weekly miles desc.

| name (first / last) | duty_status | hos minutes (`hos`) | truck (`unit`, via trucks.assigned_driver_id) | CDL expires (`cdl`, F-MMYYYY of dq cdl) | week miles (`miles`) | Pay YTD (`pay`, §7) |
|---|---|---|---|---|---|---|
| Marcus / Hale | on_duty | 380 (`6h 20m`) | T-114 | 2028-04-30 → `04/2028` | 2140 | $61,400 |
| Dara / Whitfield | on_duty | 545 (`9h 05m`) | T-107 | 2027-11-30 → `11/2027` | 1980 | $58,900 |
| Ellis / Nakamura | on_duty | 105 (`1h 45m`) | T-121 | 2027-02-28 → `02/2027` | 1760 | $55,120 |
| Priya / Raman | available | 660 (`11h 00m`) | T-103 | 2026-07-31 → `07/2026` | 1420 | $52,480 |
| Ana / Cortez | available | 660 (`11h 00m`) | T-109 | 2029-09-30 → `09/2029` | 1180 | $48,300 |
| Tobias / Frey | home_time | null (`—`) | T-118 | 2028-01-31 → `01/2028` | 640 | $63,750 |

- `status`/`tagClass`: from duty_status (§3.2).
- `miles`: the sum of driver_daily_logs for the org week Mon 2026-08-31 … Sun 2026-09-06. Seed a single row per driver dated 2026-09-03 with the listed miles.
- `load` ("Current load") is **derived** with this first-match rule:
  1. The driver's dispatch on a load whose status is in (at_pickup, loaded, in_transit, at_delivery) → `${L-n} · ${pickup short} → ${delivery short}`. Gives `'L-40218 · Fresno → Reno'`, `'L-40219 · Stockton → SLC'`, `'L-40220 · Sacramento → Boise'`.
  2. Else the earliest `dispatched` (not started) load → `${L-n} · ${F-SHORT(first pickup appointment_date)}`. Gives `'L-40222 · Sep 5'`.
  3. Else `'—'`. Priya's L-40214 is delivered and Tobias has nothing.

### 5.6 `TRUCKS` (`mock.ts:178-185`)

Ordered by unit_number ascending.

| unit | make | model | year | plate | driver | odometer | next_service_odometer | status → display |
|---|---|---|---|---|---|---|---|---|
| T-103 | Freightliner | Cascadia | 2022 | CA 8HJ2019 | Priya | 318440 | 342000 | in_service → In service |
| T-107 | Volvo | VNL 760 | 2021 | CA 7RD8842 | Dara | 402190 | 425000 | in_service → In service |
| T-109 | Kenworth | T680 | 2023 | CA 9KM1174 | Ana | 141220 | 165000 | in_service → In service |
| T-114 | Peterbilt | 579 | 2020 | CA 6PL4408 | Marcus | 528900 | 529800 | in_service → **Service due** (900 ≤ 1000) |
| T-118 | Freightliner | Cascadia | 2019 | CA 5TT9930 | Tobias | 611780 | null → `'—'` | in_shop → In shop |
| T-121 | International | LT | 2022 | CA 8WQ2251 | Ellis | 275610 | 298000 | in_service → In service |

`make` display: `'Freightliner Cascadia · 2022'`. `odo`/`service` use F-INT.

### 5.7 `TRAILERS` (`mock.ts:195-204`)

Seed order is hand-authored; sort_key 1–8 follows the listed order.

| unit | type · length | load_state | location_kind → display |
|---|---|---|---|
| RF-27 | reefer 53 | loaded | city Bakersfield, CA |
| RF-09 | reefer 53 | empty | yard (Sunridge yard) → `Yard · Modesto` |
| RF-88 | reefer 53 | loaded | en_route corridor `I-80` → `En route · I-80` |
| DV-51 | dry_van 53 | loaded | city Stockton, CA |
| DV-88 | dry_van 53 | empty | yard → `Yard · Modesto` |
| DV-14 | dry_van 53 | empty | city Las Vegas, NV |
| FB-04 | flatbed 48 | loaded | city Redding, CA |
| FB-12 | flatbed 48 | inspection | yard → `Yard · Modesto` |

### 5.8 `LOADS` (`mock.ts:94-119`): the 8 board loads

**Board order (`created_at desc`):** L-40218, L-40219, L-40220, L-40221, L-40214, L-40212, L-40210, L-40222. This order is hand-authored and not numeric. Seed `created_at` strictly decreasing in that order, e.g. 2026-09-03T07:00Z minus i minutes. Loads created later in the app sort above them, exactly as `[...created, ...LOADS]` does (`AppShellContext.tsx:40`).

Common to all 8:
- `mode = null`, `brokered = false`, `archived_at = null`, `payment_terms` = the customer's terms.
- `carrier_id` = Sunridge own fleet, except L-40221, where it is null.
- Every stop is kind pickup (sequence 1), then a synthetic fuel stop (sequence 2, see below), then delivery (sequence 3).
- Appointment windows: pickup 08:00–14:00 local; delivery 06:00–12:00 local. The Loads-page expand shows `${F-SHORT(date)} · 08:00–14:00` (`mock.ts:125-126`).
- `load_document_requirements` = [rate_confirmation, bill_of_lading, proof_of_delivery].

Per-load values (money in cents; "op est" = `operating_estimate` = rate − pay − margin, back-solved because margin is not derivable, §7):

| load | customer | pickup facility / date / planner slot | delivery facility / date / planner slot | status + exception → display | dispatch (driver / truck / trailer) | line_haul | driver_pay | op est | miles | commodity | weight lb | equipment | temp °F | tender_ref |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| L-40218 | Northgate Foods | Northgate Cold Storage / 2026-09-03 / 10:30–12:30 | Reno Grocers DC / 09-04 / 16:00–18:00 | in_transit → **In transit** | Marcus / T-114 / RF-88 | 245000 | 61200 | 62400 | 478 | Frozen produce | 41200 | reefer_53 | -10 | PO 88-41207 |
| L-40219 | Bayline Distribution | Bayline DC 4 / 09-03 / 12:00–14:00 | Wasatch Crossdock / 09-05 / 08:30–10:30 | at_pickup → **At pickup** | Dara / T-107 / DV-51 | 318000 | 79500 | 84500 | 736 | Palletized dry goods | 38500 | dry_van_53 | null | PO 55-90114 |
| L-40220 | Cascade Building Supply | Cascade Yard 2 / 09-02 / 13:30–15:30 | Boise Builders Depot / 09-04 / 13:00–15:00 | in_transit + delayed → **Delayed** | Ellis / T-121 / FB-12 | 291000 | 72800 | 79400 | 602 | Lumber | 44000 | flatbed_tarped | null | SO 7741 |
| L-40221 | Harbor Point Retail | Port of Oakland, Berth 22 / 09-04 / 15:00–17:00 | Harbor Point DC / 09-06 / 17:30–19:30 | booked, no dispatch → **Needs driver** | none; carrier null | 354000 | — | — | 632 | Consumer goods | 30100 | dry_van_53 | null | PO 31-2280 |
| L-40214 | Northgate Foods | Northgate Creamery / 09-01 / 15:00–17:00 | Valley Foods DC / 09-02 / 10:00–12:00 | delivered, no POD → **Needs POD** | Priya / T-103 / RF-27 | 198000 | 49500 | 49900 | 389 | Dairy | 36800 | reefer_53 | 34 | PO 88-41190 |
| L-40212 | Bayline Distribution | Bayline LA Annex / 08-31 / 12:00–14:00 | Sunset Beverage DC / 09-01 / 13:00–15:00 | invoiced → **Delivered** | Marcus / T-114 / DV-88 | 164000 | 41000 | 38800 | 271 | Beverages | 42000 | dry_van_53 | null | PO 55-89902 |
| L-40210 | Sierra Ag Partners | Sierra Ag Huller 3 / 08-29 / 09:00–11:00 | Front Range Foods / 09-01 / 16:00–18:00 | invoiced → **Delivered** | Tobias / T-118 / DV-14 | 412000 | 103000 | 118600 | 1142 | Almonds | 43500 | dry_van_53 | null | SO 2214 |
| L-40222 | Cascade Building Supply | Cascade Mill / 09-05 / 06:00–08:00 | Duwamish Steel Yard / 09-06 / 10:00–12:00 | dispatched → **Dispatched** | Ana / T-109 / FB-04 | 276000 | 69000 | 75800 | 578 | Steel coil | 46000 | flatbed_48 | null | SO 7802 |

Planner slots are facility-local wall-clock times. They are exactly the values `loadEvents` computes (`planner.ts:168-171`): pickup hour `6 + (n % 7) × 1.5`, delivery hour `7 + ((n × 3) % 8) × 1.5`, each 2 h long, where `n` is the numeric load id. Store them in `planned_start_at/planned_end_at` so no hash lives in the new code.

Mapping of the remaining mock fields to derived values:

| mock field | derivation |
|---|---|
| `route` | pickup market `→` delivery market, e.g. `'Fresno, CA → Reno, NV'`. Separator is `' → '` (U+2192). |
| `pickup` / `delivery` | F-SHORT of the first pickup / last delivery `appointment_date`. |
| `driver` / `unit` | dispatch display (§4.5). L-40221 shows `'Unassigned'` / `'—'`; the Loads table then shows `'Unassigned'` in the Truck column. |
| `rate` | F-MONEY(line_haul). |
| `miles` | F-INT(loaded_miles). |
| `rpm` | F-RPM: `$5.13, $4.32, $4.83, $5.60, $5.09, $6.05, $3.61, $4.78`. All 8 verified equal to the mock. |
| `pay` | F-MONEY(driver_pay + carrier_pay), or `'—'` if there is no pay cost (L-40221). |
| `margin` | F-SIGNED(charges − costs), or `'—'` if there is no pay cost: `$1,214, $1,540, $1,388, —, $986, $842, $1,904, $1,312`. |
| `weight` | `F-INT + ' lb'`. |
| `equip` | equipment label. |
| `temp` | reefer ? (temp != null ? `${temp} °F` : `'Set at pickup'`) : `'Ambient'`. Gives `'-10 °F'`, `'34 °F'`, and Ambient for the rest. The space before `°F` is a regular space. |
| `ref` | tender_ref. |
| `from` / `fromAddr` / `to` / `toAddr` | stop facility_name and the address display rule (§5.4). |
| `carrier` / `carrierMc` / `carrierDot` | §5.3. |

Load-detail extras, reproduced from rows:

**Documents** (the seed creates `documents` rows, source `seed`):
- Rate confirmation for all 8 loads.
- Bill of lading for L-40214, L-40212, L-40210.
- Proof of delivery for L-40212, L-40210.
This reproduces `LoadDetailPage.tsx:40-44` exactly: BOL is Attached for status Delivered or Needs POD, and POD is Attached for Delivered.

**Fuel stop:** kind `fuel`, `facility_name 'Planned · 92 gal, DEF top-off'`, `address_line1 'Routed automatically on the lane'`, planned at the pickup date 16:40 local. The window label is `${F-SHORT} · 16:40` (`LoadDetailPage.tsx:20`). The Loads-page expand filters to pickup/delivery only, so it shows "Stops (2)".

**Stop kind labels on the detail page:** the prototype uses a status-based literal rule (`LoadDetailPage.tsx:19-21`):
- Pickup is `'Pickup · at shipper'` if the load is At pickup, else `'Pickup · complete'`.
- Delivery is `'Delivery · complete'` if the load is Delivered, else `'Delivery'`.
- Window labels are prefixed `'Pickup '` / `'Deliver '`.

A data-driven rule would read `stop.status`: arrived → `'· at shipper'`, completed → `'· complete'`. It differs from the prototype for L-40221 and L-40222, whose future pickups the prototype shows as "complete", and for L-40214, whose delivery is completed but shows "Delivery" (§8).

- Recommended seed stop states: L-40218 P completed; L-40219 P arrived (08:41 local); L-40220 P completed; L-40221 P pending; L-40214 P+D completed; L-40212 P+D completed; L-40210 P+D completed; L-40222 P pending.
- For pixel identity, keep the prototype's literal rule for loads that have a fuel stop (the legacy layout). Choose one approach and record the decision.

**Activity:** 4 `load_activity` rows per mock load at org-local 2026-09-03 `07:12 'Driver accepted the load in the app'`, `08:41 'Arrived at ' + pickup facility`, `10:05 'Bill of lading uploaded from the cab'`, and `10:06` either `'Invoice queued for billing'` (Delivered loads) or `'Dispatch notified the consignee'` (all others). These are the prototype's canned lines (`LoadDetailPage.tsx:50-55`); §8 lists the contradictions.

**New Load writes** (`NewLoadDialog.tsx:138-194`):
- One `loads` row with every draft field. The prototype discards billTo, po (unless ref is empty), dispatcher, pieces, packaging, value, hazmat, UN, nmfc, dims, stackable, carrier contact/phone, terms, internal notes, stop number/contact, and fuel/accessorial amounts; the new system keeps them all.
- `load_stops` in form order, with `appointments` when a time was given.
- `load_charges` rows: line_haul, plus fuel_surcharge and accessorial when > 0.
- `load_costs`: driver_pay or carrier_pay when > 0.
- A dispatch when a driver is set or the load is brokered.
- 5 `load_document_requirements`, plus `documents` for the attached files.
- `load_activity`: `created` → `` `Load created by ${actor.full_name}` ``, and `instructions` → `` `Driver instructions: ${text}` `` when instructions were given.
- Status: brokered or has a driver → `dispatched`; else `booked` (display "Needs driver").
- Also an `audit_logs` row and a `LoadCreated` event.

Other New Load display rules:
- LTL label (detail "LTL" row) = `` [`Class ${class}`, `${units} ${packaging label lower-case}`, ...service labels].join(' · ') ``.
- Mode row = the mode label.
- Stop `when` = `` `${F-SHORT} · ${from && to ? from–to : from || to || 'Any time'}` `` (en dash U+2013).

### 5.9 `UNINVOICED` (`accounting.ts:44-56`): 11 delivered loads not on the board

These are stored as **loads** with `archived_at` set (off the board), `status = delivered` (POD missing) or `pod_received` (POD attached), and no `invoice_items`.

Each needs:
- a customer;
- a pickup stop and a delivery stop. City/state only is enough; the facility can be a placeholder named after the city because the route is the only thing displayed. The market values must reproduce the route string.
- a delivery stop `completed_at` on the listed day;
- a line_haul charge;
- a POD document when POD = Attached.

| load | customer | route | delivered | POD → chip | amount |
|---|---|---|---|---|---|
| L-40209 | Northgate Foods | Fresno, CA → Reno, NV | 2026-09-02 | Attached (Gr) | $2,450 |
| L-40208 | Bayline Distribution | Stockton, CA → Salt Lake City, UT | 09-02 | Attached | $3,180 |
| L-40207 | Cascade Building Supply | Sacramento, CA → Boise, ID | 09-02 | Missing (A) | $2,910 |
| L-40206 | Harbor Point Retail | Oakland, CA → Portland, OR | 09-01 | Attached | $3,540 |
| L-40204 | Vantage Home Goods | Stockton, CA → Las Vegas, NV | 08-31 | Missing | $2,880 |
| L-40203 | Northgate Foods | Bakersfield, CA → Phoenix, AZ | 08-31 | Attached | $1,980 |
| L-40205 | Sierra Ag Partners | Modesto, CA → Denver, CO | 08-30 | Attached | $4,120 |
| L-40202 | Bayline Distribution | Fresno, CA → Portland, OR | 08-30 | Attached | $3,620 |
| L-40201 | Cascade Building Supply | Redding, CA → Seattle, WA | 08-29 | Attached | $2,760 |
| L-40200 | Sierra Ag Partners | Modesto, CA → Salt Lake City, UT | 08-28 | Missing | $3,050 |
| L-40199 | Vantage Home Goods | Sacramento, CA → Denver, CO | 08-27 | Attached | $4,410 |

- Order: `delivered_on desc, load_number desc`. This reproduces the listed order, including the ties.
- The uninvoiced query: loads where status in (delivered, pod_received, ready_for_billing), no non-void invoice_item references the load, and the org matches. POD = exists proof_of_delivery document.
- Delivered date = facility-local date of the last delivery stop's `completed_at`.

### 5.10 `INVOICES` + `INVOICES_EXTRA` + `PAYMENTS` (`mock.ts:253-260`, `accounting.ts:60-71, 81-87`)

Each invoice has one invoice_item (line_haul) pointing at its load. The loads L-40168 … L-40198 referenced by the historical invoices must exist as archived loads with status `invoiced`/`paid` (minimal rows: customer, line_haul, stops optional). The alternative is `invoice_items.load_id null` plus a `load_number_snapshot`; seeding archived loads is recommended.

| invoice | customer | load | stored status | issued_on | due_on | total | display status | age |
|---|---|---|---|---|---|---|---|---|
| INV-8845 | Northgate Foods | L-40218 | draft | null | null | 245000 | Draft (A) | — |
| INV-8841 | Northgate Foods | L-40214 | sent | 2026-09-01 | 10-01 | 198000 | Sent (B) | 2 d |
| INV-8840 | Bayline Distribution | L-40212 | sent | 08-31 | 09-30 | 164000 | Sent | 3 d |
| INV-8829 | Cascade Building Supply | L-40198 | sent | 08-16 | 09-30 | 288000 | Sent | 18 d |
| INV-8824 | Harbor Point Retail | L-40191 | paid | 08-07 | 09-06 | 341000 | Paid (Gr) | 27 d |
| INV-8836 | Sierra Ag Partners | L-40210 | sent | 07-24 | **08-23** (override: 30-day terms) | 412000 | Overdue (A) | 41 d |
| INV-8844 | Vantage Home Goods | L-40197 | sent | 09-02 | 10-02 | 226000 | Sent | 1 d |
| INV-8842 | Cascade Building Supply | L-40196 | sent | 09-01 | 10-16 | 276000 | Sent | 2 d |
| INV-8839 | Sierra Ag Partners | L-40190 | paid | 08-29 | 10-28 | 305000 | Paid | 5 d |
| INV-8838 | Vantage Home Goods | L-40189 | paid | 08-28 | 09-27 | 189000 | Paid | 6 d |
| INV-8830 | Northgate Foods | L-40187 | paid | 08-18 | 09-17 | 245000 | Paid | 16 d |
| INV-8823 | Bayline Distribution | L-40183 | paid | 08-05 | 09-04 | 318000 | Paid | 29 d |
| INV-8821 | Harbor Point Retail | L-40178 | sent | 07-29 | 08-28 | 218000 | Overdue | 36 d |
| INV-8819 | Cascade Building Supply | L-40176 | sent | 07-15 | 08-29 | 291000 | Overdue | 50 d |
| INV-8815 | Vantage Home Goods | L-40172 | sent | 07-02 | 08-01 | 159000 | Overdue | 63 d |
| INV-8811 | Sierra Ag Partners | L-40168 | sent | 06-28 | 08-27 | 386000 | Overdue | 67 d |

All 16 mock ages match `today − issued_on` (verified).

Payments (`received_at` intra-day times are chosen so that `ORDER BY received_at desc` reproduces the prototype's tie order):

| invoice | received_at (org-local) | method | factoring company | amount | days to pay = received date − issued_on |
|---|---|---|---|---|---|
| INV-8823 | 2026-09-03 10:00 | check | — | 318000 | 29 |
| INV-8824 | 2026-09-02 15:00 | ach | — | 341000 | 26 |
| INV-8838 | 2026-09-02 09:00 | factoring | TriPoint Capital | 189000 | 5 |
| INV-8839 | 2026-09-01 15:00 | factoring | TriPoint Capital | 305000 | 3 |
| INV-8830 | 2026-09-01 09:00 | ach | — | 245000 | 14 |

Resulting Paid-tab order: INV-8823, INV-8824, INV-8838, INV-8839, INV-8830 (matches the stable JS sort).

### 5.11 `BATCHES` (`accounting.ts:99-107`)

| batch | created_on | recipient | status | invoice_count_snapshot | total_cents_snapshot | known members |
|---|---|---|---|---|---|---|
| B-2035 | 2026-09-03 | customer Northgate Foods | ready | 2 | 443000 | INV-8845 + INV-8841 (sum matches) |
| B-2034 | 09-02 | customer Cascade Building Supply | ready | 3 | 812000 | not reproducible (§8) |
| B-2033 | 09-01 | factoring TriPoint Capital | sent | 2 | 494000 | INV-8838 + INV-8839 (sum matches) |
| B-2032 | 08-29 | customer Bayline Distribution | sent | 4 | 1131000 | — |
| B-2031 | 08-26 | customer Harbor Point Retail | sent | 3 | 767000 | — |
| B-2030 | 08-22 | factoring TriPoint Capital | settled | 5 | 1423000 | — |
| B-2029 | 08-19 | customer Northgate Foods | settled | 3 | 841000 | — |

Order: batch_number desc.

### 5.12 `BILLS` (`accounting.ts:118-127`)

Order: due_on asc.

| vendor | category (· description) | due_on | amount | state (+date) | display |
|---|---|---|---|---|---|
| Verizon Connect ELD | Telematics | 2026-08-28 | 48600 | open | Overdue (A) |
| Modesto Yard — Lease | Facilities | 09-01 | 390000 | paid (paid_on 09-01) | Paid (Gr) |
| Comdata | Fuel card fees | 09-02 | 21500 | paid (09-02) | Paid |
| Bridgestone Commercial | Tires | 09-04 | 238000 | open | Due (A) |
| Pilot Flying J | Fuel | 09-05 | 864000 | open | Due |
| Valley Diesel & Turbo | Parts · `T-118 turbo` (truck_id T-118) | 09-08 | 398000 | open | Due |
| Great West Casualty | Insurance | 09-10 | 621000 | scheduled (09-10) | Scheduled (B) |
| Ryder Trailer Lease | Equipment lease | 09-15 | 415000 | scheduled (09-15) | Scheduled |

The vendor name `'Modesto Yard — Lease'` contains an em dash (U+2014) and is stored verbatim as the vendor name. The prototype keys rows by vendor (`BillsTab.tsx:39`); use the id.

### 5.13 `SETTLEMENTS` (`mock.ts:273-279`): week of Sep 1

Every row has `period_start 2026-09-01` and `period_end 2026-09-07`. Order: total miles desc.

| driver | basis snapshot | status (+reason) | line_pay items (count / Σmiles / Σamount) | deduction items (Σ) | net |
|---|---|---|---|---|---|
| Marcus Hale | per_mile 62¢ | ready | 4 / 2140 / 132600 | −14200 | $1,184 |
| Dara Whitfield | per_mile 60¢ | ready | 3 / 1980 / 118800 | −9600 | $1,092 |
| Ellis Nakamura | percent 2500 bp | on_hold `fuel` → `'Hold · fuel'` | 3 / 1760 / 145500 | −21000 | $1,245 |
| Priya Raman | per_mile 58¢ | ready | 2 / 1420 / 82400 | −6400 | $760 |
| Ana Cortez | per_mile 58¢ | paid | 2 / 1180 / 68400 | none → `'—'` | $684 |

Display fields:
- `basis`: pay basis rule (§3.2).
- `loads`: `String(count)`.
- `miles`: F-INT.
- `gross`: F-MONEY of the line-pay sum.
- `ded`: F-SIGNED, or `'—'` when 0.
- `net`: F-MONEY(gross + ded).

Seed item amounts **as stored values**, not recomputed: 0.62 × 2140 = 1326.80, but the mock shows $1,326 (§8). Item-level load_ids are null because the mock does not say which loads were paid.

### 5.14 `CONTRACTS` (`hr.ts:21-32`) and `ONBOARDING` (`hr.ts:50-57`)

Contracts (seed order via employees.sort_key: the 6 drivers in roster order, then Rosa, Luis, Evan, Jamal):

| employee | role | type | state | starts_on | renewal_kind / renews_on | pay | derived display |
|---|---|---|---|---|---|---|---|
| Marcus Hale | company_driver | w2 | signed | 2022-03-14 | renews 2027-03-14 | per_mile 62 | Active (Gr) |
| Dara Whitfield | company_driver | w2 | signed | 2021-08-02 | renews 2027-08-02 | per_mile 60 | Active |
| Ellis Nakamura | company_driver | w2 | signed | 2023-10-01 | renews 2026-10-01 | percent 2500 | Renewal due (A), 28 d |
| Priya Raman | company_driver | w2 | signed | 2024-09-20 | renews 2026-09-20 | per_mile 58 | Renewal due, 17 d |
| Ana Cortez | company_driver | w2 | signed | 2026-01-12 | renews 2027-01-12 | per_mile 58 | Active |
| Tobias Frey | owner_operator | lease_purchase | signed | 2023-11-15 | ends 2026-11-15 | per_mile 118 | Expiring (A) |
| Rosa Medina | dispatcher | w2 | signed | 2020-06-06 | renews 2027-06-06 | salary 6800000 | Active |
| Luis Ortega | mechanic | w2 | signed | 2023-02-09 | renews 2027-02-09 | hourly 3450 | Active |
| Evan Brooks | dispatcher | w2 | signed | 2026-07-27 | renews 2027-07-27 | salary 5200000 | Active |
| Jamal Reed | company_driver | w2 | draft | 2026-09-08 | renews 2027-09-08 | per_mile 56 | Draft (G) |

Start/Renews use F-DATE, which reproduces `'Mar 14, 2022'`, `'Jan 12'`, `'Oct 1'`, `'Sep 20'`, `'Nov 15'`, `'Jul 27'`, `'Sep 8'`.

Employees Luis Ortega (mechanic), Evan Brooks (dispatcher) and Jamal Reed (company_driver, status onboarding) are seeded too. Jamal gets a `drivers` row with `roster_status = onboarding`, so he is not on the 6-driver roster.

Onboarding (order: in-progress by `started_on asc`, then completed):

| candidate | employee link | role | stage | started_on | owner | progress | next_step_label · on | pending doc requests | completed_on |
|---|---|---|---|---|---|---|---|---|---|
| Jamal Reed | Jamal | company_driver | orientation | 2026-08-17 | Rosa | 85 | Ride-along with Ana Cortez · 09-05 | — | — |
| Sofia Nguyen | — | company_driver | road_test | 08-24 | Luis Ortega | 60 | Road test in T-103 · 09-04 | — | — |
| Derek Holt | — | owner_operator | background_check | 08-28 | Rosa | 35 | Waiting on MVR consent and insurance certificate · null | MVR consent (1), insurance certificate (2) | — |
| Kevin Brandt | — | company_driver | background_check | 09-01 | Rosa | 30 | Waiting on medical card copy · null | medical card (1) | — |
| Maya Patel | — | company_driver | application | 09-02 | Rosa | 10 | Phone screen · 09-04 | — | — |
| Evan Brooks | Evan | dispatcher | complete | 07-13 | Rosa | 100 | 90-day review · 10-25 | — | 2026-07-27 (assumed) |

`progress` is stored because it cannot be derived from the stage: Derek 35 and Kevin 30 share a stage.

### 5.15 Safety

**MAINTENANCE** (`safety.ts:20-29`). Seed order (sort_key) is as listed; no natural order reproduces it.

| unit (truck/trailer) | item | due | shop facility | estimate | state | derived display |
|---|---|---|---|---|---|---|
| T-118 | Turbocharger replacement | due_on 2026-09-05 | Sunridge shop · Modesto | 485000 | in_shop | In shop (A) |
| FB-12 (trailer) | DOT annual inspection | 09-03 | Sunridge shop · Modesto | 15000 | in_shop | In shop |
| T-121 | Brake adjustment | 08-28 | Sunridge shop · Modesto | 42000 | scheduled | Overdue (A) |
| T-114 | PM service A | due_odometer 529800 → `'529,800 mi'` | Sunridge shop · Modesto | 64000 | scheduled | Due (A): 900 mi to go |
| RF-27 (trailer) | Reefer unit service | 09-12 | Thermo King · Fresno | 71000 | scheduled | Scheduled (B) |
| T-107 | DOT annual inspection | 09-18 | Valley Truck Center · Stockton | 18500 | scheduled | Scheduled |
| T-103 | Tire rotation | due_odometer 342000 | Sunridge shop · Modesto | 16000 | scheduled | Scheduled: 23,560 mi to go |
| T-109 | DOT annual inspection | 08-22 | Valley Truck Center · Stockton | 18500 | done (completed_on 2026-08-22) | Done (G) |

**DRIVER_DOCUMENTS** (`safety.ts:41-57`) → `driver_qualification_items`. Seed order: driver roster order, then as listed.

| driver | item | expires_on | derived | display (rule below) |
|---|---|---|---|---|
| Marcus | cdl | 2028-04-30 | Valid (Gr) | `Apr 2028` |
| Marcus | medical_card | 2027-03-31 | Valid | `Mar 2027` |
| Marcus | clearinghouse_query | 2026-09-20 | Expiring (A) | `Sep 20` |
| Dara | cdl | 2027-11-30 | Valid | `Nov 2027` |
| Dara | medical_card | 2027-06-30 | Valid | `Jun 2027` |
| Ellis | cdl | 2027-02-28 | Valid | `Feb 2027` |
| Ellis | medical_card | 2026-10-12 | Expiring | `Oct 12` |
| Priya | cdl | 2026-07-31 | Expired (A) | `Jul 2026` |
| Priya | medical_card | 2028-01-31 | Valid | `Jan 2028` |
| Ana | cdl | 2029-09-30 | Valid | `Sep 2029` |
| Ana | mvr | 2026-09-24 | Expiring | `Sep 24` |
| Ana | annual_review | 2026-09-24 | Expiring | `Sep 24` |
| Tobias | cdl | 2028-01-31 | Valid | `Jan 2028` |
| Tobias | medical_card | 2026-12-31 | Valid | `Dec 2026` |
| Tobias | drug_test | null | Missing (A) | `—` |

**Display rule** (fits every mock value): Expiring → F-SHORT; Missing → `'—'`; Valid/Expired → F-MONTHYEAR. Month-only expiries are stored as the last day of the month. Where the real day is known, store it; the display is unchanged.

The Drivers-tab CDL column is F-MMYYYY of the cdl item.

**COMPLIANCE** (`mock.ts:318-322`) and **WATCHLIST** (`fleet.ts:12-15`) are **derived** from the DQ items:
- Filter: derived status in (Expired, Expiring).
- Label map: cdl → `'CDL renewal'`, medical_card → `'Medical card'`, clearinghouse_query → `'Clearinghouse query'`, mvr / annual_review → `'Annual MVR review'`. Collapse rows that share (driver, label, date) into one.
- Order: Expired first, then `expires_on desc`.
- Due uses the doc display rule.
- Result: Priya · CDL renewal · Jul 2026; Ellis · Medical card · Oct 12; Ana · Annual MVR review · Sep 24; Marcus · Clearinghouse query · Sep 20. ✓ (4 rows)
- The desc order is odd; the prototype order is hand-authored. Tobias's Missing drug test is excluded, as in the mock.

**VIOLATIONS** (`safety.ts:71-79`). Order: occurred_on desc.

| occurred_on | driver | truck | type | points | location_text | status |
|---|---|---|---|---|---|---|
| 2026-08-31 | Tobias | T-118 | Log form & manner | 1 | I-70 POE · Loma, CO | open |
| 2026-08-28 | Ellis | T-121 | Brake adjustment | 4 | I-5 scale · Cottonwood, CA | open |
| 2026-08-19 | Marcus | T-114 | Hours-of-service | 7 | US-95 POE · Winnemucca, NV | contested |
| 2026-07-30 | Dara | T-107 | Lighting | 6 | I-80 scale · Donner Pass, CA | closed |
| 2026-06-12 | Tobias | T-118 | Speeding 6–10 over | 4 | I-70 · Grand Junction, CO | closed |
| 2026-05-06 | Ellis | T-121 | Log form & manner | 1 | I-84 POE · Ontario, OR | closed |
| 2026-03-18 | Ana | T-109 | Lighting | 6 | I-5 scale · Ashland, OR | closed |

**CLAIMS** (`safety.ts:95-102`). Order: claim_number desc (= date desc). Paid shows F-MONEY when > 0, else `'—'`.

| claim | occurred_on | driver | truck / trailer | type | claimant | reserved | paid | status |
|---|---|---|---|---|---|---|---|---|
| CLM-1112 | 2026-08-26 | Ellis | T-121 / FB-12 | cargo_damage | customer Cascade Building Supply | 680000 | 0 | open |
| CLM-1111 | 08-14 | Marcus | T-114 / RF-88 | cargo_damage | customer Northgate Foods | 420000 | 0 | under_review |
| CLM-1110 | 07-22 | Dara | T-107 / DV-51 | property_damage | facility Wasatch Crossdock | 290000 | 265000 | settled |
| CLM-1109 | 06-30 | Tobias | T-118 / DV-14 | cargo_shortage | customer Sierra Ag Partners | 145000 | 0 | denied |
| CLM-1108 | 05-09 | Ana | T-109 / FB-04 | bodily_injury | third_party `R. Delgado` → `'Third party · R. Delgado'` | 2500000 | 1850000 | settled |
| CLM-1107 | 03-03 | Priya | T-103 / RF-27 | cargo_damage | customer Northgate Foods | 310000 | 287500 | settled |

### 5.16 Planner (`planner.ts`)

**planner_color_codes** (seeded per org, `planner.ts:22-29`):

| position | key | label | tone | is_locked |
|---|---|---|---|---|
| 0 | pickup | Loaded (pickup) | amber | true |
| 1 | delivery | Empty (delivery) | green | true |
| 2 | maintenance | Maintenance | red | false |
| 3 | driver | Driver schedule | purple | false |
| 4 | meeting | Meetings | blue | false |
| 5 | admin | Billing & admin | teal | false |

**planner_events**: 27 standups plus 15 office events.
- Standups (`planner.ts:116-125`): one row per weekday from 2026-08-24 to 2026-09-30 except 2026-09-07. That is 27 rows (6 in August, 21 in September). Each is titled `'Dispatch standup'`, uses color code meeting, runs 08:00–08:30 org time, has notes `'Board review: uncovered loads, HOS, delays.'`, and attendees Rosa Medina, Luis Ortega, Evan Brooks.
  - Store them as independent rows, not an RRULE, because each occurrence can be edited or deleted on its own.
  - The prototype ids `standup-YYYY-MM-DD` become UUIDs.
- Office events ev-1 … ev-15 (`planner.ts:129-143`) are copied verbatim:
  - timed ones → `starts_at/ends_at` from the date and the `start`/`end` in `America/Los_Angeles`;
  - all-day ones → `start_date`/`end_date` (ev-1 2026-09-01…09-06, ev-2 09-02…09-05, ev-8 09-07, ev-14 09-20, ev-15 09-24);
  - `people` → `planner_event_attendees` in order, linked to employees or contacts where the name matches (Dana Ruiz and Ben Okafor are customer contacts; Sofia Nguyen is an onboarding case).
  - Planner totals: 42 office rows. September 2026 shows 50 events: 21 standups + 15 office events + 14 load-stop events whose *start* date is in September. L-40212's pickup (Aug 31) and L-40210's pickup (Aug 29) fall in August. This is the Month-view `"50 events this month"` count with nothing hidden and no search.

**Load-stop events** are *not stored*. `GET /planner/events` computes them from `load_stops` of non-archived, non-cancelled loads:
- One event per pickup/delivery stop (fuel stops excluded).
- `id = load:{loadNumber}:{p|d|index}`.
- `title = '${L-n} · ${place}'`, where place = the market label for seeded loads, or `cityState(address)` for app-entered stops. Both reduce to the stop's route label.
- `category` = pickup | delivery.
- `date` = appointment_date.
- start/end = the planned slot when present, else the appointment window, else 08:00–09:00. When only one time was given, end = start, and the grid enforces a 15-minute minimum.
- `facility`, `notes = '${facility} · ${customer}'`, `customer`, `driver` (`'Unassigned'` when none), `truck` = the unit display or `''`, `commodity`, `people = [driver]`, `readOnly = true`.

The 16 events for the 8 board loads are exactly the slots in §5.8.

### 5.17 Static UI configuration: stays in code, not in the DB

`NAV`, `SECTION_TABS`, `ViewKey`, `ACTIVE_STATUSES` (as a named API view), `SETTLE_TAG` (becomes the enum → chip map), `TONES`, `CARD_FIELDS`, `DEFAULT_PREFS`, `ROW_H`, the New Load option lists (`EQUIPMENT`, `PACKAGING`, `FREIGHT_CLASSES`, `LTL_SERVICES`, `TERMS`, `DOCUMENTS`), and `REVENUE_DAYS`. REVENUE_DAYS is **not** derivable from the pinned clock: today−6 … today (2026-08-28 … 2026-09-03) are Fri … Thu, but the prototype shows `Thu … Wed`. For parity keep the seven labels as literals (or store them with the `revenue.daily` snapshot); deriving them shifts every label by one day. (Corrected by the completeness critic.)

These belong in `packages/types`/`packages/ui`, shared by web and API.

---

## 6. Derived values catalogue

[A] = authoritative business/financial computation: it must run in the API (`packages/calculations`) and be returned as numbers. [P] = pure presentation (formatting, percent widths, chip mapping): it may run in the web app.

**KPIs are computed over the whole unfiltered set.** The top-bar search never changes a KPI in Runtruck1. So KPI endpoints and `meta.summary` must ignore `q`.

### 6.1 Dashboard (`DashboardPage.tsx`)

| value | formula | result |
|---|---|---|
| Active loads [A] | count of board loads whose display status ∈ ACTIVE | `5` (L-40218, 19, 20, 21, 22) |
| note | snapshot `active_loads_delta_wow` (§7) | `+4 vs. last week` |
| Revenue this week | snapshot (§7) | `$168K`, note `+9.2%` |
| Deadhead miles | snapshot (§7) | `7.8%`, note `1.4 pts better` |
| Unbilled loads [A] | count of uninvoiced (§5.9) | `11`; note F-MONEY(Σ line_haul) + ` waiting` = `$34,900 waiting` |
| Active table [A filter] | first 6 active loads in board order; with a search, the first 6 of *all* loads matching `q` | 5 rows (listed in §11) |
| Revenue bars [P] | height = `round(v / max × 100)%`; max bar fill `var(--ui-primary)`, others `var(--ui-primary-soft)`; the values are the snapshot (§7) | Thu 57%, Fri 78%, Sat 69%, Sun 89%, **Mon 100%**, Tue 51%, Wed 39% |
| Drivers card [P] | on_duty → `On duty · ${F-HOS} left`, else the status label | Marcus `On duty · 6h 20m left`, Dara `On duty · 9h 05m left`, Ellis `On duty · 1h 45m left`, Priya `Available`, Ana `Available`, Tobias `Home time` |
| Header button [A] | `Invoice ${uninvoiced count} loads` | `Invoice 11 loads` |

### 6.2 Loads (`LoadsPage.tsx`) and Load detail (`LoadDetailPage.tsx`)

| value | formula | result |
|---|---|---|
| Undispatched / In transit / Delivered / Needs POD [A] | count by display status (Delayed is *not* counted as In transit) | `1` / `1` / `2` / `1` |
| Card title [P] | ``searching ? `${n} matching “${q}”` : `${n} loads` `` (curly quotes U+201C/U+201D) | Active `5 loads`, Needs POD `1 loads` (grammar bug, §8), Delivered `2 loads`, All `8 loads` |
| Detail tiles [A] | Miles = F-INT(miles); Line haul = F-MONEY(line_haul) with note `${F-RPM} / mi` (no note when rpm = —); `Driver pay` (or `Carrier cost` when brokered) = F-MONEY(pay) or `—`; Margin = F-SIGNED or `—` | L-40218: `478`, `$2,450` / `$5.13 / mi`, `$612`, `$1,214` |
| Detail heading [P] | route; subline `Load ${L-n} · ${customer} · ${display status}` | `Load L-40218 · Northgate Foods · In transit` |
| New Load summary [A server on create; P live preview] | total = line_haul + fuel + accessorials; rpm = line_haul / miles (not the total); cost = carrier rate if brokered else driver pay; margin = total − cost | the web may compute the live preview; the API recomputes on save |

### 6.3 CRM (`CustomersPage.tsx:8-13`)

The KPI strings are hard-coded in the page, but every one of them is derivable from the per-customer metrics:

| KPI | formula | result |
|---|---|---|
| Accounts [A] | count of customers | `6`; note `${key_account count} key accounts` = `2 key accounts` |
| Revenue YTD [A] | F-M1(Σ revenue_ytd = $1,295,000) | `$1.3M`; note `Top 3 accounts = ${round(Σtop3/Σ×100)}%` = 946/1295 = 73.05 → `73%` |
| On time [A] | Σ(loads_ytd × on_time) / Σ loads_ytd = 50,562 / 547 = 92.43 | `92%`; note `Weighted by loads` |
| Open AR [A] | F-K1(Σ ar = $91,850) | `$91.9K`; note `${at_risk count} account at risk` = `1 account at risk` |

### 6.4 Fleet

**Drivers** (`DriversTab.tsx:18-29`):

| value | formula | result |
|---|---|---|
| On the roster [A] | roster count | `6`; note `${on_duty} on duty · ${roster − on_duty − available} home time` = `3 on duty · 1 home time` (anyone neither on duty nor available is counted as "home time") |
| Available now [A] | available count | `2`; note `Both reset today` (hard-coded) |
| Hours at risk [A] | on_duty with drive_remaining < 120 min | `1`; note = those drivers as `${last_name} · ${F-HOS}` joined `, ` = `Nakamura · 1h 45m`, or `Nobody under 2h` when empty |
| Docs to renew [A] | watchlist count | `4`; note `On the watchlist below` |
| Miles total [A] | Σ weekly miles | `9,120 mi total` |
| Miles bars [P] | `round(m/max×100)%`, opacity 1 for the max, else 0.55 | Marcus 100%, Dara 93%, Ellis 82%, Priya 66%, Ana 55%, Tobias 30% |

**Trucks** (`TrucksTab.tsx:11-21`):

| value | formula | result |
|---|---|---|
| Power units [A] | count | `6`; note `Avg ${round(avg odo/1000)}K mi` = 2,278,140 / 6 = 379,690 → `Avg 380K mi` |
| In service [A] | display `In service` count (Service due excluded) | `4`; note `Of 6 units` |
| In shop [A] | in_shop count | `1`; note `${units joined ', '} · turbo` = `T-118 · turbo`. The `' · turbo'` suffix is hard-coded and should come from the open work order item; the empty case is `Bays clear`. |
| Service due [A] | derived count | `1`; note `${unit} in ${F-INT(next−odo)} mi` = `T-114 in 900 mi`; empty case `Nothing due` |

**Trailers** (`TrailersTab.tsx:8-20`):

| value | formula | result |
|---|---|---|
| Trailers [A] | count | `8`; note `${reefer} reefer · ${dry van} dry van · ${flatbed} flatbed` = `3 reefer · 3 dry van · 2 flatbed` |
| Loaded [A] | loaded count | `4`; note `${en_route} rolling · ${loaded − en_route} at shippers` = `1 rolling · 3 at shippers` |
| Empty [A] | empty count | `3`; note `${empty at yard} at the Modesto yard` = `2 at the Modesto yard` (the yard name is hard-coded; use the facility city) |
| Inspection [A] | inspection count | `1`; note `${units} · annual DOT` = `FB-12 · annual DOT` (the suffix is hard-coded); empty case `None pending` |

### 6.5 Accounting

**Uninvoiced** (`UninvoicedTab.tsx:8-18`):
- `Loads` [A] `11`, note `Delivered, not yet invoiced`.
- `Amount waiting` [A] `$34,900`, note `Across ${distinct customers} customers` = `Across 6 customers`.
- `Missing POD` [A] `3` (L-40207, L-40204, L-40200), note `Cannot invoice until attached`.
- `Oldest (days)` [A] = max(today − delivered) = `7`, note `${L-n} · delivered ${F-SHORT}` = `L-40199 · delivered Aug 27`. The first strict maximum wins.

**Invoiced** (`InvoicedTab.tsx`):
- Rows: status sent and not overdue, ordered `issued_on desc, invoice_number asc` → INV-8844, INV-8841, INV-8842, INV-8840, INV-8829.
- KPI tiles = the AR aging snapshot (§7): `Current $96,400 · 32 invoices`, `1–30 days $41,200 · 14 invoices`, `31–60 days $18,750 · 5 invoices`, `60+ days $7,900 · 2 invoices · collections`.
- **Note:** the prototype's Invoiced list is `status === 'Sent'`. Overdue invoices are a different stored status in the mock. In the derived model, "Sent" means sent and not past due.

**Batches** (`BatchesTab.tsx:8-19`):
- `Batches` [A] `7`, note `${Σ invoice counts} invoices` = `22 invoices`.
- `Ready to send` [A] `2`, note `${F-MONEY(Σ ready totals)} to go out` = `$12,550 to go out`.
- `Sent this week` [A] = status sent and `today − created_on < 7` → B-2033, B-2032 → `2`, note `Last 7 days`.
- `Total batched` [A] `$59,110`, note `Ready, sent and settled`.

**Past due** (`PastDueTab.tsx:10-21`):
- Rows: overdue ordered `issued_on asc` → INV-8811 (67 d), INV-8815 (63 d), INV-8819 (50 d), INV-8836 (41 d), INV-8821 (36 d).
- `Overdue invoices` `5`, note `Past terms`.
- `Amount overdue` `$14,660`, note `${age > 60 count} in collections (60+ days)` = `2 in collections (60+ days)`.
- `Oldest` `67 d`, note `INV-8811 · Sierra Ag Partners`.
- `Accounts affected` `4`, note `of ${customer count} accounts` = `of 6 accounts`.
- Age is measured from issue, not from due date (§8).

**Paid** (`PaidTab.tsx:8-27`):
- Rows in the §5.10 order. `Via` chip: Factoring blue, else gray. `Days to pay` = received date − issued_on.
- `Paid this month` `5` (received in the org's current month), note = month name `September`.
- `Amount` `$13,980`, note `Collected this month`.
- `Avg days to pay` = round(77/5 = 15.4) = `15`, note `Issued to paid`. Averaged over *all* paid rows, not just this month (identical here).
- `Paid via factoring` `2`, note `${factor name} · ${F-MONEY(Σ)}` = `TriPoint Capital · $4,940`. The factor name is hard-coded in the UI; derive it from the payments.

**Payroll** (`PayrollTab.tsx:13-28`):
- `Drivers` `5`, note `${ready} ready to approve` = `3 ready to approve`. After approval the note is `Approved for payment`.
- `Gross` `$5,477`, note `Week of ${F-SHORT(period_start)}` = `Week of Sep 1`.
- `Deductions` = F-MONEY(|Σ deductions|) = `$512`, note `Fuel advances and escrow` (hard-coded).
- `Net payable` `$4,965`, note `Awaiting approval` → `Approved`.
- Footer `Net payable this week $4,965`. Card title `Driver settlements · week of Sep 1`.
- Approving flips ready → approved. The label changes from `Ready` to `Approved` and the chip stays blue. Hold and paid rows are unchanged.

**Bills** (`BillsTab.tsx:8-20`):
- `Due this week` = display Due and `due_on − today ≤ 7` → `3`, `$15,000`.
- `Overdue` `1`, `$486`.
- `Scheduled` `2`, `$10,360 · auto-pay`.
- `Paid this month` `2`, `$4,115`. The prototype tests the *due* month (`BillsTab.tsx:13`). Recommend the `paid_on` month; the result is identical here.

### 6.6 HR

**Contracts** (`EmployeeContractsTab.tsx:8-18`):
- `Active contracts` `6`, note `${total} on file` = `10 on file`.
- `Renewals due (30 d)` `2`, note hard-coded `Raman Sep 20 · Nakamura Oct 1`. Derivable as renewal-due rows by renews_on asc: `${last_name} ${F-SHORT(renews_on)}` joined ` · `.
- `Owner-operators` `1`, note hard-coded `Frey · lease-purchase ends Nov 15`. Derivable: `${last} · ${type label lower-case} ends ${F-SHORT}`.
- `Drafts` `1`, note hard-coded `Reed · starts Sep 8`. Derivable: `${last} · starts ${F-SHORT(starts_on)}`.

**Onboarding** (`OnboardingTab.tsx:9-22`):
- `In progress` = stage ≠ complete → `5`, note `${orientation count} in orientation` = `1 in orientation`.
- `Starting this week` = started_on within the org week Mon Aug 31 – Sun Sep 6 → Kevin, Maya → `2`, note `Opened since Mon ${F-SHORT(week start)}` = `Opened since Mon Aug 31`. The prototype hard-codes the week list at `OnboardingTab.tsx:9`.
- `Awaiting documents` `2`, note hard-coded `MVR consent · medical card`. Derivable as the first pending request label of each case, lower-cased, joined ` · `.
- `Completed this quarter` `1`, note `Since Jul 1`. The prototype counts every completed case; the correct rule is completed_on ≥ quarter start, which gives the same result here.
- Progress bar width = `${progress}%`, text `${progress}%` [P].

### 6.7 Safety

**Maintenance:**
- `Open work orders` = display ≠ Done → `7`, note `${done} done · last 30 d` = `1 done · last 30 d`. The prototype counts every done order; the correct filter is completed_on ≥ today − 30.
- `In shop` `2`, note = the distinct shop labels joined `, ` → `Sunridge shop · Modesto`.
- `Overdue` `1`, note `T-121 · Brake adjustment`.
- `Est. cost open` = Σ estimate of open orders → `$7,115`, note `Parts & labor, open orders`.

**Driver documents:**
- `Documents` `15`, note `${distinct drivers} drivers on file` = `6 drivers on file`.
- `Expiring (60 d)` `4`, note `Renew before ${F-SHORT(today+60)}` = `Renew before Nov 2`.
- `Expired` `1`, note `Priya Raman · CDL`.
- `Missing` `1`, note `Tobias Frey · Drug test`. The empty case for both is `None`.

**Violations:**
- `Open` `2`, note `Corrective action pending`.
- `Points (12 mo)` = Σ points where occurred_on ≥ today − 12 months → `29`, note `CSA severity · ${count} violations` = `CSA severity · 7 violations`. The prototype sums every row without the date filter; all 7 are inside the window.
- `Contested` `1`, note `DataQ challenge filed`.
- `Closed` `4`, note `Resolved, on file`.

**Claims:**
- `Open claims` = open + under_review → `2`, note `1 under review`.
- `Reserved` = Σ reserved on open → `$11,000`, note `On open claims`.
- `Paid YTD` = Σ paid where paid > 0 → `$24,025`, note `${count} settlements` = `3 settlements`. Should also filter occurred_on in the current year; identical here.
- `Settled` `3`, note `1 denied`.

### 6.8 Planner [P, except what is noted]

- The legend and color-by values come from color codes plus distinct driver/customer/truck values of load events, sorted alphabetically.
- Tone for a value = `valueTones[key] ?? TONES[index % 10]`.
- The "events this month" count = events whose *start* date is in the cursor month, after hidden-code filtering and search. `50` for Sep 2026 with defaults.
- Everything else (week range, lanes, heights) is grid layout, covered by the planner spec.

---

## 7. Values that cannot be derived from the mock records (must be stored or snapshotted)

| value | where shown | why not derivable | recommended storage |
|---|---|---|---|
| Customer `loads`, `revenue`, `onTime`, `ar` | CRM table, Top-account cards, CRM KPIs | Only 8 + 11 + 16 loads/invoices exist. Open invoices per customer ≠ AR except for Vantage ($3,850) (§8). | `metric_snapshots` keys `customer.loads_ytd`, `customer.revenue_ytd_cents`, `customer.on_time_bp`, `customer.ar_balance_cents` (subject = customer), or live computation once history exists |
| AR aging `AR` (`mock.ts:324-329`) | Invoiced KPI tiles | Totals $164,250 over 53 invoices, versus 11 open mock invoices | `metric_snapshots` `ar_aging.current`, `ar_aging.1_30`, `ar_aging.31_60`, `ar_aging.60_plus` (value + count). Target: compute from open invoices by days past due |
| `REVENUE_BARS` | Dashboard chart | Unitless, and inconsistent with "Revenue this week $168K" (§8) | `metric_snapshots` `revenue.daily` × 7 (period = day). Target: Σ line_haul of loads delivered per day |
| `$168K`, `+9.2%`, `7.8%`, `1.4 pts better`, `+4 vs. last week` | Dashboard KPIs | hard-coded | `metric_snapshots` (`revenue.week`, `revenue.week_change_bp`, `deadhead.pct_bp`, `deadhead.change_bp`, `loads.active_delta_wow`) |
| Driver `pay` (Pay YTD) | Drivers roster | No settlement history | Seed one opening-balance settlement per driver (status paid, period 2026-01-01…2026-08-30) totalling the value, or a `driver.pay_ytd_cents` snapshot |
| Driver `miles` (this week) | Drivers bars | Not equal to the sum of their loads' miles (Marcus loads = 749, shows 2,140); Tobias has 640 and no settlement | `driver_daily_logs` (ELD) |
| Driver `hos` | Roster, Dashboard | ELD data | `driver_hos_status` |
| Load margin (operating cost part) | Load detail | margin ≠ rate − pay (the residual is $624, $845, … with no constant per-mile rate) | `load_costs.operating_estimate` (§5.8) |
| Load driver pay | Load detail | ≈ 25% of line haul with inconsistent rounding (612.5 → 612 but 727.5 → 728), and contradicts the per-mile contract rates (§8) | `load_costs.driver_pay` |
| Batch totals and counts (B-2034, B-2032, B-2031, B-2030, B-2029) | Batches | Their member invoices do not exist or do not sum (Cascade invoices sum to $8,550, not $8,120) | `invoice_batches.invoice_count_snapshot`, `total_cents_snapshot` |
| Onboarding `progress` | Onboarding | not a function of stage | `onboarding_cases.progress_pct` |
| Trailer location, trailer loaded/empty | Trailers | contradicts the loads (§8) | stored on trailers |
| Planner slot times for mock loads | Planner | hash formula, unrelated to the appointment windows | `load_stops.planned_start_at/end_at` |
| Canned activity rows and the fuel stop | Load detail | UI-fabricated for every mock load | seeded `load_activity` / `load_stops(kind=fuel)` rows, or dropped with sign-off |
| Hard-coded KPI notes that *are* derivable | `Both reset today`, `' · turbo'`, `' · annual DOT'`, `'at the Modesto yard'`, `'Raman Sep 20 · Nakamura Oct 1'`, `'Frey · lease-purchase ends Nov 15'`, `'Reed · starts Sep 8'`, `'MVR consent · medical card'`, `'TriPoint Capital'`, `'Fuel advances and escrow'`, `'Since Jul 1'`, `'Opened since Mon Aug 31'` | the formulas are in §6 | Derive them. `Both reset today`, `Fuel advances and escrow`, `Past terms`, `Corrective action pending`, `DataQ challenge filed`, `Resolved, on file`, `On open claims`, `Parts & labor, open orders`, `Weighted by loads`, `Collected this month`, `Issued to paid`, `Last 7 days`, `Ready, sent and settled` and `Delivered, not yet invoiced` are static captions and stay as literals in the UI |

---

## 8. Mock inconsistencies, bugs and conflicts with the architecture

### Money and billing

1. **INV-8836 is "Overdue" inside its terms.** Sierra Ag is Net 60, and the invoice was issued Jul 24 (41 d) (`mock.ts:223,259`). Planner ev-13 then says `'INV-8836, 41 days past due'` (`planner.ts:141`), which counts days since issue, not days past due. The seed overrides `due_on = 2026-08-23` to keep "Overdue". Product must pick the real terms.
2. **L-40210's invoice predates the load.** INV-8836 was issued Jul 24 for L-40210, which picked up Aug 29 (`mock.ts:113,259`).
3. **Invoices dated before delivery or POD.** INV-8840 was issued Aug 31, the pickup day of L-40212, which delivered Sep 1. INV-8841 was *sent* for L-40214, whose status is "Needs POD". That contradicts the Uninvoiced rule "Cannot invoice until attached" (`UninvoicedTab.tsx:16`).
4. **Draft invoice for an in-transit load.** INV-8845 is a Draft for L-40218, which is still in transit. Draft invoices appear in no accounting tab. B-2035 ("Ready") contains that draft plus the already-sent INV-8841 (the sum $4,430 matches).
5. **Three different AR totals:**
   - Customers' `ar` sums to $91,850.
   - AR aging (`mock.ts:324-329`) sums to $164,250 (53 invoices).
   - Open mock invoices total $26,180 sent+overdue.

   Only Vantage's AR ($3,850 = INV-8844 + INV-8815) matches its invoices. AR "60+ days · 2 invoices" matches the count of INV-8811 and INV-8815, but their sum is $5,450, not $7,900.
6. **Revenue figures disagree.** `REVENUE_BARS` sum to 358 units while "Revenue this week" is `$168K`. The Mon–Wed bars total 141.
7. **Batch totals don't match invoices.** Cascade's invoices sum to $8,550, but B-2034 shows $8,120 / 3 invoices. B-2032 (Bayline, 4 invoices, $11,310) and B-2031 (Harbor Point, 3, $7,670) have no matching invoices. B-2033 is "Sent" although both of its invoices are already paid by factoring (it could be "Settled").
8. **Load driver pay contradicts the contracts.** Every load's `pay` ≈ 25% of line haul (`mock.ts:95-118`). Only Ellis is on "25% of line haul"; Marcus ($0.62/mi × 478 = $296 vs $612) and owner-operator Tobias ($1.18/mi × 1,142 = $1,347.56 vs $1,030) don't match. The rounding is also inconsistent: 612.5 → 612 but 727.5 → 728.
9. **Settlement gross rounding is inconsistent.** Marcus 0.62 × 2,140 = 1,326.80 is shown as $1,326 (floored), while Priya 0.58 × 1,420 = 823.60 is shown as $824 (rounded). Store the item amounts; if the gross is recomputed, Marcus becomes $1,327 and the Gross KPI $5,478.
10. **Settlement loads don't match the board.** Marcus has 4 settled loads, but only L-40218 and L-40212 exist.
11. **"Week of Sep 1" doesn't match the Monday week.** Sep 1 2026 is a Tuesday, while the Onboarding "this week" is Mon Aug 31 – Sun Sep 6 (`OnboardingTab.tsx:9`). The payroll week start needs a decision.
12. **"Paid this month" (Bills) filters on the due-date month**, not the paid date (`BillsTab.tsx:13`).
13. **"Sent this week" (Batches) uses the created date** (`BatchesTab.tsx:9`).
14. **"Avg days to pay" averages every paid invoice**, not only this month's.
15. **The Paid tab hard-codes "TriPoint Capital"** (`PaidTab.tsx:26`), so factoring through another company would be mislabeled.

### Loads, dispatch and compliance

16. **The uninvoiced loads are copies of board loads.** L-40199 … L-40209 are delivered but absent from LOADS, and L-40209/08/07/06/03/05/01 duplicate the route *and* amount of L-40218/19/20/21/14/10/22. This is why `archived_at` is needed.
17. **Route cities differ from address cities.** `'Reno, NV'` vs `'Sparks, NV'`, `'Boise, ID'` vs `'Meridian, ID'`, `'Los Angeles, CA'` vs `'Vernon, CA'`, `'Las Vegas, NV'` vs `'North Las Vegas, NV'` (`mock.ts:95-112`). Hence the market columns.
18. **Stop times disagree between screens.** The Loads page shows pickup `08:00–14:00`, while the Planner shows L-40218's pickup at `10:30–12:30`. Both are shown to the same user. Keep both only if pixel identity is mandatory; otherwise show the planned slot inside the window.
19. **Detail-page stop labels contradict the load status** (`LoadDetailPage.tsx:19-21`). L-40221 (Needs driver, pickup Sep 4) and L-40222 (pickup Sep 5) show `'Pickup · complete'`. L-40214 (Needs POD, i.e. delivered) shows `'Delivery'`, not `'Delivery · complete'`.
20. **Canned activity contradicts the loads.** The same 4 activity lines apply to every mock load (`LoadDetailPage.tsx:50-55`). L-40221, which has no driver, shows `'Driver accepted the load in the app'` and `'Arrived at Port of Oakland, Berth 22'`. In-transit loads show `'Bill of lading uploaded from the cab'` while their BOL document is `Pending`.
21. **Uncovered loads are labelled differently by origin.** A New Load that is own-fleet and unassigned is still stored with carrier `'Sunridge Freight (own fleet)'` (`NewLoadDialog.tsx:147`). The mock's uncovered load L-40221 shows `'Not yet covered'`. Unify on `carrier_id null → 'Not yet covered'` or on own fleet.
22. **No dispatch rules are enforced (Arch Rule 5, §19).** New Load lets the user assign:
    - Priya, whose CDL expired Jul 2026;
    - Tobias, who is on home time;
    - T-118, which is in the shop;
    - FB-12, which is in inspection;
    - a trailer or truck already on another load.

    Priya also ran L-40214 with an expired CDL. The API must validate these rules.
23. **Trailer states contradict the loads.**
    - FB-12 is `'Inspection'` at the yard but is on the in-progress L-40220.
    - FB-04 is `'Loaded'` at Redding before L-40222's Sep 5 pickup.
    - RF-27 is `'Loaded'` at Bakersfield after L-40214 delivered in Phoenix.
    - DV-14 is at Las Vegas after L-40210 went to Denver.
    - DV-88 is at the Modesto yard after L-40212 ended in Las Vegas.
24. **`load` for LoadDetail falls back to `loads[0]`** for an unknown id (`LoadDetailPage.tsx:12`), so the page never shows a 404. The API must return `404 LOAD_NOT_FOUND` (Arch §15).
25. **New Load ids are allocated in the browser** as `max+1` (`NewLoadDialog.tsx:196-198`), which races. Use `number_sequences`.
26. **New Load throws away input.** It collects about 25 fields that `toLoad` discards (§5.8). They are business data and must be persisted (Arch Rule 1).
27. **`createdAt` is stored as the literal string `'Today HH:MM'`** (`NewLoadDialog.tsx:192`), so it is wrong from the next day on. Store a `timestamptz`.
28. **New loads live only in React state** (`AppShellContext.tsx:16-17,29`): "a reload drops them". The same is true of Payroll `approved` (`AppShellContext.tsx:28`). Both are business data.

### HR, safety and planner

29. **Contract rules are unstated.** "Expiring" (Tobias, 73 d) has no stated window. The ≤ 90 d rule is an assumption. Jamal's orientation event is Sep 8 (`planner.ts:137`), but his onboarding says he is already in Orientation, with a ride-along on Sep 5 (`hr.ts:51`).
30. **The watchlist doesn't follow the documents list.** It relabels (`CDL` → `CDL renewal`, and merges MVR + Annual review into `Annual MVR review`), is hand-ordered (`mock.ts:318-322`, `fleet.ts:12-15`), and omits Tobias's missing drug test.
31. **Several counts ignore their stated time window.** "Done · last 30 d", "Points (12 mo)", "Paid YTD" and "Completed this quarter" count every row regardless of date. They give the right numbers only because of the data.
32. **The "Service due" and maintenance "Due" thresholds are unstated.** 1,000 mi is an assumption that fits the data (T-114 is 900 mi away; the next closest truck is 22,390 mi away).
33. **The Safety "Settlements" tab is really Claims.** Its route is `/app/safety/settlements` (`mock.ts:314`), but it holds cargo/liability claims, which collides with driver settlements (`/app/accounting/payroll`). Keep the URL, but name the table `claims`.
34. **Grammar bug:** `'1 loads'` (`LoadsPage.tsx:38`).
35. **Duplicate React keys** are possible for `key={b.vendor}` (Bills), `key={c.employee}`, `key={o.candidate}`, `key={d.name}` and `key={t.unit}`. Use UUID ids.
36. **Calendar reset deletes shared data.** Planner "Reset calendar" restores `PLANNER_EVENTS` and `DEFAULT_CATEGORIES` (`PlannerPage.tsx:322`). Once events and color codes are shared org data, that becomes a destructive bulk delete. Reset should reset *prefs only*, or require `planner.admin`, a confirmation and an audit entry (Arch §50 "Before making a destructive change, ask for approval").
37. **Deleting a color code reassigns events.** The event count in its confirm message (`PlannerPage.tsx:170-171`) covers only the local user's events. Server-side it must be one transaction: reassign every org event, then delete the code, then write the audit log.
38. **`USER.role 'Dispatch'` is not an RBAC role.** The seeded Rosa must hold a role with every permission, or most screens become forbidden (§10.3).

---

## 9. State classification

| state | where in Runtruck1 | class | new home |
|---|---|---|---|
| Created loads | `AppShellContext` `created` (memory) | **business** | `POST /api/v1/loads` → loads + children |
| Payroll "Approve all" / "Run settlements" | `AppShellContext.approved` (memory) | **business, sensitive** | `POST /api/v1/settlements/approve` (explicit ids or a period) → status approved, `approved_by/at`, audit, `SettlementApproved` event |
| Planner events | localStorage `runtruck-planner-events` | **business** | `planner_events` via CRUD API |
| Planner color codes | localStorage `runtruck-planner-categories` | **business** (org-shared legend) | `planner_color_codes` |
| Planner prefs (view, weekStart, showWeekends, dayStart/End, density, hour24, hidden, colorBy, valueTones, cardLines) | localStorage `runtruck-planner-prefs` | presentation | localStorage, or optionally `user_preferences` |
| Theme | localStorage `runtruck-theme` + `<html data-theme>` | presentation | same; needs a cookie for SSR (§12) |
| Search query, load tab, driver tab, expanded load row, calendar cursor, selected event, open dialogs, New Load draft & section | React state | presentation | client state. A New Load draft may use sessionStorage, but never as the record |
| KPI numbers | module-level constants | derived business | API responses (`meta.summary`) |

---

## 10. Permissions

### 10.1 Permission keys (Arch §13 style)

- **Loads:** `loads.view`, `loads.view_financials`, `loads.create`, `loads.update`, `loads.update_status`, `loads.assign`, `loads.archive`.
- **Documents:** `documents.view`, `documents.upload`.
- **Messaging:** `messages.send`.
- **Planner:** `planner.view`, `planner.events.create`, `planner.events.update`, `planner.events.delete`, `planner.color_codes.manage`, `planner.admin`.
- **Fleet:** `drivers.view`, `drivers.create`, `drivers.view_pay`, `trucks.view`, `trucks.create`, `trailers.view`, `trailers.create`.
- **Parties:** `customers.view`, `customers.view_financials`, `customers.create`, `carriers.view`, `facilities.view`.
- **Billing:** `billing.view`, `billing.create`, `billing.export`, `billing.send`.
- **Payables:** `bills.view`, `bills.create`.
- **Settlements:** `settlements.view`, `settlements.create`, `settlements.approve`.
- **HR:** `hr.contracts.view`, `hr.contracts.create`, `hr.onboarding.view`, `hr.onboarding.create`.
- **Safety:** `maintenance.view`, `maintenance.create`, `compliance.view`, `compliance.request`, `violations.view`, `violations.create`, `claims.view`, `claims.create`.
- **Reports:** `reports.view` (snapshot KPIs).

### 10.2 Screen and action matrix

| screen / action (Runtruck1 label) | route | permission(s) |
|---|---|---|
| Dashboard | `/app/dashboard` | each tile or card is gated: Active loads + table → `loads.view`; Revenue / Deadhead → `reports.view`; Unbilled → `billing.view`; Drivers card → `drivers.view` |
| `+ New Load` (Dashboard, Loads) | dialog | `loads.create`; the dropdowns also need `customers.view`, `carriers.view`, `drivers.view`, `trucks.view`, `trailers.view`; choosing a driver/truck/trailer/partner carrier → `loads.assign`; attaching files → `documents.upload` |
| Loads list + expand | `/app/loads` | `loads.view` (carrier MC·DOT → `carriers.view`) |
| Load detail | `/app/loads/:number` | `loads.view`; Driver pay / Carrier cost / Margin / Carrier rate → `loads.view_financials`; Documents card → `documents.view` |
| `Message driver` | detail header | `messages.send` |
| `Update status` | detail header | `loads.update_status` |
| Planner (view; load-stop events) | `/app/planner` | `planner.view`; load-stop events also need `loads.view` |
| `+ Add Event`, Edit, Delete | planner | `planner.events.create` / `.update` / `.delete` |
| Edit colors / Add / Delete color code | Customize | `planner.color_codes.manage` |
| Reset calendar | Customize › Layout | prefs only: none. Events and codes: `planner.admin` |
| Drivers tab | `/app/fleet/drivers` | `drivers.view`; Pay YTD → `drivers.view_pay`; watchlist → `compliance.view` |
| `+ Add Driver` | | `drivers.create` |
| Trucks tab / `Log service` / `+ Add Unit` | `/app/fleet/trucks` | `trucks.view` / `maintenance.create` / `trucks.create` |
| Trailers tab / `+ Add Trailer` | `/app/fleet/trailers` | `trailers.view` / `trailers.create` |
| CRM / `+ Add Customer` | `/app/crm` | `customers.view`; Revenue, AR and Revenue/AR KPIs → `customers.view_financials` / `customers.create` |
| Facilities (coming soon) | `/app/facilities` | `facilities.view` |
| Uninvoiced / `Invoice 11 loads` | `/app/accounting/uninvoiced` | `billing.view` / `billing.create` |
| Invoiced / `Export batch` / `+ New Batch` | `/app/accounting/invoiced` | `billing.view` / `billing.export` / `billing.create` |
| Batches / `+ New Batch` | `/app/accounting/batches` | `billing.view` / `billing.create` |
| Past Due / `Send reminders` | `/app/accounting/past-due` | `billing.view` / `billing.send` |
| Paid / `Export` | `/app/accounting/paid` | `billing.view` / `billing.export` |
| Payroll / `Approve all` / `Run settlements` | `/app/accounting/payroll` | `settlements.view` / `settlements.approve` (sensitive: confirm, audit, Arch §26) |
| Bills / `+ Add Bill` | `/app/accounting/bills` | `bills.view` / `bills.create` |
| Employee Contracts / `+ New Contract` | `/app/hr/employee-contracts` | `hr.contracts.view` (pay data) / `hr.contracts.create` |
| Onboarding / `+ Start Onboarding` | `/app/hr/onboarding` | `hr.onboarding.view` / `hr.onboarding.create` |
| Maintenance / `+ Log Service` | `/app/safety/maintenance` | `maintenance.view` / `maintenance.create` |
| Driver Documents / `Request document` | `/app/safety/driver-documents` | `compliance.view` / `compliance.request` |
| Violations / `+ Log Violation` | `/app/safety/violations` | `violations.view` / `violations.create` |
| Claims ("Settlements" tab) / `+ New Claim` | `/app/safety/settlements` | `claims.view` (bodily-injury claimant names are PII) / `claims.create` |
| Settings › Profile | dialog | authenticated user; own record only |
| Settings › Appearance | dialog | none (client only) |
| Sidebar nav items | | hide items whose view permission is missing. The API still enforces every permission. |

### 10.3 Seed roles

| role | permissions |
|---|---|
| `owner`, `admin` | all |
| `dispatcher` | loads.* except archive, documents.*, messages.send, planner.* except admin, drivers/trucks/trailers/customers/carriers/facilities .view, compliance.view, maintenance.view |
| `accounting` | billing.*, bills.*, settlements.*, customers.view(+financials), loads.view(+financials), reports.view |
| `hr` | hr.*, drivers.view, drivers.view_pay |
| `safety` | compliance.*, violations.*, claims.*, maintenance.view, drivers.view, trucks.view, trailers.view |
| `maintenance` | maintenance.*, trucks.view, trailers.view |
| `manager` | all `.view` permissions + reports.view |
| `driver` | reserved for the mobile app (Arch §20) |

**Rosa Medina = `admin`**, because Runtruck1 shows her every screen.

---

## 11. What the backend must serve (read models)

Every response is `{ data, meta }` (Arch §15). Money is returned as integer cents. Dates are returned as `YYYY-MM-DD`, and instants as ISO UTC plus `tz` where display needs the facility zone. Each list endpoint returns `meta.summary` holding the KPI numbers from §6, computed without `q`.

| endpoint | returns |
|---|---|
| `GET /api/v1/me` | `user {id, fullName, email, memberNumber, jobTitle}`, `organization {id, name, companyNumber, timezone}`, `permissions[]`, `today` (the clock date, so the web never uses `new Date()` for business dates) |
| `GET /api/v1/dashboard` | `activeLoads {count, deltaWoW}`, `revenueWeek {amountCents, changeBp}`, `deadhead {pctBp, changeBp}`, `unbilled {count, amountCents}`, `activeTable[≤6]` (the load list row shape), `revenueDaily[7] {date, amountCents}`, `drivers[] {id, fullName, dutyStatus, driveRemainingMinutes}` |
| `GET /api/v1/loads?view=active\|needs_pod\|delivered\|all&q=` | rows `{id, loadNumber, tenderRef, customerPo, customer{id,name}, routeLabel, pickupDate, deliveryDate, driverName, unitLabel, truckAssigned:boolean, lineHaulCents, displayStatus, commodity, weightLb, equipmentType, temperatureF, stops[] (pickup/delivery only) {kind, facilityName, addressLabel, date, windowStart?, windowEnd?, tz}, carrier {name, isOwnFleet, mc, dot} \| null}`; `meta.summary {needsDriver, inTransit, delivered, needsPod}`, `meta.total` |
| `GET /api/v1/loads/by-number/:n` | the list row plus `mode, ltl{class, units, packaging, services[]}, loadedMiles, ratePerMileCents, payCents, payLabel ('driver'\|'carrier'), marginCents\|null, carrierRateCents\|null, stops[]` (incl. fuel) `{kind, status, facilityName, addressLabel, date, window…, plannedAt}`, `documents[] {type, label, attached:boolean, fileName?}`, `activity[] {occurredAt, message}`. `404 LOAD_NOT_FOUND` when missing |
| `POST /api/v1/loads` | Zod-validated New Load body (every draft field). Returns the load. Validation mirrors `NewLoadDialog.tsx:98-127` (customer, equipment, ≥1 pickup, ≥1 delivery, per-stop facility/street/city/state/date, dates non-decreasing, commodity, weight > 0, UN if hazmat, LTL class and units, brokered carrier and rate > 0, line haul > 0) plus the dispatch rules (§8 #22) |
| `GET /api/v1/drivers` | roster rows `{id, fullName, lastName, dutyStatus, truckUnit, currentLoadLabel, driveRemainingMinutes, cdlExpiresOn, payYtdCents (perm), weekMiles}`, `meta.summary`, `watchlist[] {driverName, label, dueDate, dueDisplayKind}` |
| `GET /api/v1/trucks`, `/trailers` | the §5.6 / §5.7 fields + `displayStatus` + summary (incl. `inShopNote` from the open work-order item) |
| `GET /api/v1/customers` | rows + metrics (`loadsYtd, revenueYtdCents, onTimeBp, arBalanceCents`, standing, primary contact name/email, terms), `featured[3]`, summary |
| `GET /api/v1/billing/uninvoiced` | `{loadNumber, customerName, routeLabel, deliveredOn, podAttached, lineHaulCents}` + summary |
| `GET /api/v1/invoices?display=sent\|overdue\|paid` | `{invoiceNumber, customerName, loadNumber, issuedOn, totalCents, ageDays, displayStatus, payment?{receivedOn, method, daysToPay, factoringCompanyName}}` + summary; `GET /api/v1/billing/ar-aging` |
| `GET /api/v1/invoice-batches` | `{batchNumber, createdOn, invoiceCount, totalCents, recipientLabel, status}` + summary |
| `GET /api/v1/bills` | `{vendorName, categoryLabel, dueOn, amountCents, displayStatus}` + summary |
| `GET /api/v1/settlements?periodStart=2026-09-01` | `{id, driverName, payBasisLabel, loads, miles, grossCents, deductionsCents, netCents, status, holdReason}` + summary; `POST /api/v1/settlements/approve` |
| `GET /api/v1/hr/contracts`, `/hr/onboarding` | the §5.14 fields + derived display + summary |
| `GET /api/v1/maintenance/work-orders`, `/compliance/driver-documents`, `/safety/violations`, `/safety/claims` | the §5.15 fields + derived display + summary |
| `GET /api/v1/planner/events?from=&to=` | office events + computed load-stop events (§5.16), each `{id, title, colorCodeKey, allDay, date, endDate?, start?, end?, tz, place, notes, people[], loadNumber?, facility?, customer?, driver?, truck?, commodity?, readOnly}`. Plus `POST/PATCH/DELETE /planner/events/:id` and `GET/POST/PATCH/DELETE /planner/color-codes` |

Every write above writes `audit_logs` and emits a domain event: `LoadCreated`, `SettlementApproved`, `PlannerEventCreated`/`Updated`/`Deleted`, `PlannerColorCodeChanged` (Arch §23, §30).

---

## 12. Data-layer porting hazards (Next.js App Router, SSR)

1. **Module-level KPI constants** (every tab computes its KPIs at import time, e.g. `BatchesTab.tsx:8-19`). In Next.js these become API data. Never compute them in server components from bundled mock arrays.
2. **The date helpers build local-time `Date` objects** (`lib/dates.ts:13-20`, `fromIso` → `new Date(y, m-1, d)`). On a UTC server versus a PDT browser, anything built from `new Date()` differs, and "today" computed from the wall clock breaks parity. Use the `today` from `/me` (the clock override), and do pure date arithmetic on `YYYY-MM-DD` strings (or Temporal/date-fns-tz).
3. **`toLocaleString()` without a locale** (`DriversTab.tsx:75,83`, `TrucksTab.tsx:20`) causes hydration mismatches. Always pass `'en-US'`.
4. **`localStorage` is read in `useState` initializers** (`lib/persist.ts:6-13`, `lib/theme.ts`). On the server this throws or falls back, which makes the first render differ. Theme needs a cookie or the pre-paint inline script that Runtruck1 has in `index.html`. Planner data comes from the API; planner prefs may hydrate after mount.
5. **`Date.now()` ids** (`PlannerPage.tsx:161,207`) are replaced by server UUIDs.
6. **`window.confirm` / `window.alert`** on destructive planner and New Load actions (`PlannerPage.tsx:167,171`, `NewLoadDialog.tsx:274`, `CalendarSettings.tsx:109`) are client-only. They must live in `'use client'` components.
7. **Search semantics.** `matchesQuery` (`lib/search.ts:4-10`) matches the query as a substring of the *display strings* of every string or number field except `tagClass`, including non-visible ones (`fromAddr`, `carrier`, `commodity`, `notes`, `createdAt`). So `q='2,450'` finds L-40218 via `'$2,450'`.
   - Server-side `q` must search a per-row `search_text` built by the backend from the same formatted strings. Use a generated or trigger-maintained column with a `pg_trgm` GIN index, per list.
   - The alternative is to fetch the full small list and filter client-side, which violates Arch §37 at scale.
   - The Paid tab also matches the computed `paid`, `via` and `days`. Payroll matches the post-approval status label.
8. **Sorting stability.** JS `sort` is stable, while SQL is not. Every list needs the explicit `ORDER BY` given in §5 (tie-breakers included). Hand-ordered lists (loads board, customers, trailers, maintenance, DQ items, contracts, drivers) need `sort_key` or `created_at`.
9. **Time zones.** Facility-local display for stops (Denver, Boise and Phoenix appear in the mock) and org-local "today" both require IANA zones in the DB. Do not rely on the server's TZ.
10. **Currency formatting of non-integer cents** (§2.3). The prototype's `money()` would print up to three decimals.
