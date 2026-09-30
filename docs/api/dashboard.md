# API — Dashboard

The Dashboard screen (`/app/dashboard`) and its one endpoint, `GET /api/v1/dashboard`. Conventions (envelopes, errors, formats, lists) are in [04-api.md](../04-api.md). The rules for every figure come from [03-database.md §6.2](../03-database.md), and this document makes them concrete for the endpoint. Where this document and 03 disagree, 03 wins (architecture §49), and the conflict must be raised.

Inputs:
- The product decisions D1–D8 in [01 §2](../01-product-requirements.md): D4 (clock), D5 (computed figures) and D6 (quirks).
- The [design brief](../reference/design-brief.md) §2, which covers the revenue chart, the hardcoded KPI texts and permissions.
- The Runtruck1 port spec [core-pages.md §2](../reference/runtruck1/core-pages.md) and the prototype's `DashboardPage.tsx`.

Contracts in code:
- `packages/types/src/dashboard.ts`: `DashboardData`, `DashboardMeta`, `DashboardSummary`, `DashboardResponse`, and the row types.
- `packages/validation/src/dashboard.ts`: `dashboardQuerySchema`.

## 0. Feature summary (architecture §44)

| | |
|---|---|
| FEATURE | Operations dashboard |
| PURPOSE | Runtruck1's Dashboard. It shows four KPI tiles, the active-loads table (up to 6 rows), the revenue bars for the last 7 days and the driver duty list. Every figure is computed from stored rows (D5). |
| USERS | Members with `dashboard.view`: Owner, Admin, Dispatcher, Accounting and Manager. |
| PERMISSIONS | `dashboard.view`. Searching the table also reads `GET /loads` (`loads.view`), see §5.6. |
| DATABASE TABLES (read) | `loads`, `load_stops`, `facilities`, `customers`, `invoice_items`, `drivers`, `employees` |
| DATABASE CHANGES | None. All the facts it needs exist in `0000_init` (03 §6.0.2): `loads.empty_miles`, `drivers.hos_remaining_minutes`. |
| API ENDPOINTS | `GET /api/v1/dashboard` |
| BUSINESS RULES | 03 §6.0.1 (clock, weeks), §6.0.3 (load helpers), §6.0.4 (uninvoiced), §6.2 (Dashboard) |
| STATE CHANGES / EVENTS / JOBS / NOTIFICATIONS / INTEGRATIONS / AI | None. The endpoint is read-only. HOS is a stored ELD fact, and there is no live integration (01 §5). |
| SECURITY | Session-derived tenant and timezone. No input other than an empty query string. Aggregates only, plus the table and driver fields listed below. |
| ERROR CASES | §2.9 |
| TESTS | §2.11 |
| ACCEPTANCE | The seed renders exactly the strings in §4. Tenant isolation and permission denial are proven by the tests in §2.11. |

## 1. Endpoints

| Method & path | Permission | Query | `data` | `meta` | Owner |
|---|---|---|---|---|---|
| `GET /dashboard` | `dashboard.view` | none (`dashboardQuerySchema`) | `DashboardData` | `DashboardMeta` (with `summary: DashboardSummary`) | this document |

The page also uses these endpoints, which other groups own:
- `GET /loads?view=all&limit=500` ([loads.md](loads.md), `loads.view`): the rows the top-bar search filters (§5.6).
- `POST /loads` ([loads.md](loads.md)): the top bar's "+ New Load".

The top bar's **"Invoice N loads"** label on `/app/accounting/uninvoiced` is not a Dashboard figure. It reads `GET /billing/uninvoiced-loads` `meta.summary` ([billing.md](billing.md)). That endpoint and this one's `summary.unbilledLoads` apply the same uninvoiced rule (03 §6.0.4) through one shared query (§3), so they always agree ("Invoice 11 loads" / "11").

## 2. `GET /api/v1/dashboard`

### 2.1 Contract

- **Controller:** `@Get('dashboard') @RequirePermissions('dashboard.view')`, handler `get(@Auth() ctx, @Query(new ZodValidationPipe(dashboardQuerySchema)) _query)`. It returns `withMeta(data, meta)`.
- **Query:** `dashboardQuerySchema = z.strictObject({})`. There are no parameters. Any key, including `q`, `limit` and `offset`, is a `400 VALIDATION_ERROR`, because the figures never depend on search text (03 §6) and the table search happens in the browser (§5.6).
- **Body:** none.
- **Response:** `200` `DashboardResponse = { data: DashboardData, meta: DashboardMeta }`.

### 2.2 Periods

Every date comes from `ClockService.today(ctx.timezone)`, which gives the organization's business date (D4). The server never uses the client's clock.

| name | rule | seed (today = 2026-09-03, Thu) |
|---|---|---|
| `today` | `ClockService.today(ctx.timezone)` | 2026-09-03 |
| org week | Monday–Sunday containing today: `weekStart = today − ((isoWeekday(today) + 6) mod 7)` days, where isoWeekday is Mon=1…Sun=7. `weekEnd = weekStart + 6`. | 2026-08-31 … 2026-09-06 |
| previous org week | `weekStart − 7` … `weekStart − 1` | 2026-08-24 … 2026-08-30 |
| chart range | `today − 7` … `today − 1` (design brief §2) | 2026-08-27 … 2026-09-02 |
| last-week reference day | `today − 7` | 2026-08-27 |

Date arithmetic uses `addDaysIso` and `daysBetween` from `@runtruck/calculations` on `YYYY-MM-DD` strings. It never goes through a local `Date` (03 §1.5).

### 2.3 Load helpers used below (03 §6.0.3)

- **board load**: `loads.archived_at IS NULL`.
- **active statuses**: `needs_driver`, `dispatched`, `at_pickup`, `in_transit`, `delayed`.
- **delivered statuses**: `needs_pod`, `delivered`.
- **first pickup**: the `load_stops` row of the load with `kind = 'pickup'` and the lowest `sequence`. If the load has no pickup, the lowest-sequence stop. **last delivery**: the row with `kind = 'delivery'` and the highest `sequence`. If there is none, the highest-sequence stop. A load without stops has neither.
- **revenue(l)**: `line_haul_cents + fuel_surcharge_cents + accessorial_cents`, computed in SQL as `l.line_haul_cents::bigint + l.fuel_surcharge_cents + l.accessorial_cents` (cast before adding, 03 §6.0.3).
- **delivered_on(l)**: only for a load in a delivered status. It is the last delivery's `completed_at` converted to a date in `load_stops.timezone` when set, otherwise its `appointment_date`.
- **route(l)**: first pickup label + `" → "` + last delivery label. A stop label is `coalesce(f.market_city, f.city) + ", " + coalesce(f.market_state, f.state)` when the stop has a facility, and `load_stops.city + ", " + load_stops.state` otherwise. The value is computed by the loads module's shared helper, so it is byte-identical to `GET /loads` `route`.

### 2.4 `data`: `DashboardData`

#### `activeLoads: DashboardActiveLoad[]` (the "Active loads" card)

Rows are board loads in an active status, ordered `loads.created_at DESC, loads.load_number DESC` (the board order, 03 §1.10 and §6.3). The first **6** are returned (`LIMIT 6`, Runtruck1 `.slice(0, 6)`).

| field | type | computed from |
|---|---|---|
| `id` | `string` (uuid) | `loads.id` |
| `loadNumber` | `number` | `loads.load_number` |
| `customerName` | `string` | `customers.name` via `(loads.organization_id, loads.customer_id)` |
| `route` | `string` | route(l), §2.3 |
| `lineHaulCents` | `number` | `loads.line_haul_cents` ("Rate") |
| `status` | `DashboardActiveLoadStatus` | `loads.status` (always an active status here) |

Seed rows in order. They are identical to Runtruck1, because the seeded `created_at` runs 09-03 00:00Z minus *i* minutes (03 §7.12):

| loadNumber | customerName | route | lineHaulCents | status |
|---|---|---|---|---|
| 40218 | Northgate Foods | Fresno, CA → Reno, NV | 245000 | in_transit |
| 40219 | Bayline Distribution | Stockton, CA → Salt Lake City, UT | 318000 | at_pickup |
| 40220 | Cascade Building Supply | Sacramento, CA → Boise, ID | 291000 | delayed |
| 40221 | Harbor Point Retail | Oakland, CA → Portland, OR | 354000 | needs_driver |
| 40222 | Cascade Building Supply | Redding, CA → Seattle, WA | 276000 | dispatched |

A load created with + New Load (`needs_driver` or `dispatched`) has the newest `created_at`, so it becomes the first row. After 6 creations, L-40222 drops out of the table while the KPI keeps counting it. That matches Runtruck1, which prepends created loads.

#### `revenueLastSevenDays: DashboardRevenueDay[]` ("Revenue, last 7 days")

There are exactly 7 entries, one per date D in the chart range, oldest first. A day with no delivery has `revenueCents: 0`.

| field | type | computed from |
|---|---|---|
| `date` | `string` (`YYYY-MM-DD`) | D |
| `revenueCents` | `number` | Σ revenue(l) over loads (board or archived) in a delivered status with delivered_on(l) = D |

Seed (03 §6.2):

| date | web label | revenueCents | loads | height | Runtruck1 height |
|---|---|---|---|---|---|
| 2026-08-27 | Thu | 441000 | L-40199 | 42% | 57% |
| 2026-08-28 | Fri | 305000 | L-40200 | 29% | 78% |
| 2026-08-29 | Sat | 276000 | L-40201 | 26% | 69% |
| 2026-08-30 | Sun | 774000 | L-40205, L-40202 | 74% | 89% |
| 2026-08-31 | Mon | 486000 | L-40204, L-40203 | 46% | **100%** (primary) |
| 2026-09-01 | Tue | 930000 | L-40206, L-40212, L-40210 | 88% | 51% |
| 2026-09-02 | Wed | 1052000 | L-40209, L-40208, L-40207, L-40214 | **100%** (primary) | 39% |

The labels Thu…Wed equal Runtruck1's `REVENUE_DAYS` exactly. The heights differ (D5). The 12 invoice-only archived loads have no stops (01 C8), so they have no delivered_on and never appear here.

#### `drivers: DashboardDriver[]` ("Drivers")

Every row of `drivers` in the organization, ordered `drivers.position, drivers.id`. There is no limit and no search, as in Runtruck1, which renders all of `DRIVERS`.

| field | type | computed from |
|---|---|---|
| `id` | `string` (uuid) | `drivers.id` |
| `name` | `string` | `employees.first_name + " " + employees.last_name` via `(drivers.organization_id, drivers.employee_id)` |
| `dutyStatus` | `DashboardDriverDutyStatus` | `drivers.duty_status` |
| `hosRemainingMinutes` | `number \| null` | `drivers.hos_remaining_minutes` |

Seed: Marcus Hale on_duty 380 · Dara Whitfield on_duty 545 · Ellis Nakamura on_duty 105 · Priya Raman available 660 · Ana Cortez available 660 · Tobias Frey home_time null.

### 2.5 `meta`: `DashboardMeta`

| field | type | value |
|---|---|---|
| `today` | `string` | today (§2.2). Seed: `"2026-09-03"` |
| `weekStart`, `weekEnd` | `string` | the org week. Seed: `"2026-08-31"`, `"2026-09-06"` |
| `summary` | `DashboardSummary` | the four KPI tiles, below |

The Dashboard is not a paginated list, so `meta` has no `total`/`limit`/`offset`. Its KPI figures are in `meta.summary`, as on every other screen (design brief §3).

#### `summary.activeLoads`: `DashboardActiveLoadsSummary`

| field | formula | seed |
|---|---|---|
| `count` | count of board loads with `status` in the active statuses | **5** (L-40218, L-40219, L-40220, L-40221, L-40222) |
| `lastWeekCount` | activeOn(today − 7): the count of loads (board or archived, any status) that have both a first pickup and a last delivery with `first_pickup.appointment_date ≤ D ≤ last_delivery.appointment_date` | **3** (L-40205 08-27…08-30, L-40200 08-26…08-28, L-40199 08-24…08-27) |
| `deltaVsLastWeek` | `count − lastWeekCount` | **2** → note "+2 vs. last week" (Runtruck1 "+4 vs. last week") |

#### `summary.revenueThisWeek`: `DashboardRevenueSummary`

| field | formula | seed |
|---|---|---|
| `thisWeekCents` | Σ revenue(l) over loads in a delivered status with delivered_on(l) in the org week | **2468000** (Aug 31 486,000 + Sep 1 930,000 + Sep 2 1,052,000; nothing on Sep 3) → "$25K" (Runtruck1 "$168K") |
| `previousWeekCents` | the same over the previous org week | **1796000** (Aug 27 441,000 + Aug 28 305,000 + Aug 29 276,000 + Aug 30 774,000) |
| `changeTenthsOfPercent` | `null` when `previousWeekCents = 0`. Otherwise `n = (thisWeekCents − previousWeekCents) × 1000`, `d = previousWeekCents`, `sign(n) × floor((2·abs(n) + d) / (2·d))`. This rounds half away from zero to 0.1 % and is computed in integer (BigInt) arithmetic. | 672,000,000 / 1,796,000 = 374.16 → **374** → "+37.4%" (Runtruck1 "+9.2%") |

#### `summary.deadheadMiles`: `DashboardDeadheadSummary`

The rule runs over loads (board or archived) whose first pickup `appointment_date` falls in the week and whose `loaded_miles` and `empty_miles` are both non-null. Let `E = Σ empty_miles` and `T = Σ (loaded_miles + empty_miles)`.

| field | formula | seed |
|---|---|---|
| `percentTenths` | `null` when there is no such load or `T = 0`. Otherwise `floor((2·1000·E + T) / (2·T))` (round half up of 1000·E/T; both are ≥ 0). | L-40218, -19, -20, -14, -12, -22: E 258, T 3,312 → 77.90 → **78** → "7.8%" (same as Runtruck1) |
| `previousWeekPercentTenths` | the same over the previous org week | L-40210: 116 / 1,258 → 92.21 → **92** |
| `pointsBetterTenths` | `previousWeekPercentTenths − percentTenths`. `null` when either is null. | **14** → "1.4 pts better" (same as Runtruck1) |

L-40221 (no truck yet) has `empty_miles` null and is excluded. The uninvoiced and invoice-only archived loads have no miles.

#### `summary.unbilledLoads`: `DashboardUnbilledSummary`

These are the uninvoiced loads of 03 §6.0.4: loads (board or archived) in a delivered status that no `invoice_items` row references, whatever the invoice's status.

| field | formula | seed |
|---|---|---|
| `count` | count of uninvoiced loads | **11** (L-40209, -08, -07, -06, -04, -03, -05, -02, -01, -00, L-40199) |
| `amountCents` | Σ revenue(l) over them | **3490000** → "$34,900 waiting" (same as Runtruck1) |

### 2.6 Ordering, search, limits

- **Order:** `activeLoads` by `created_at DESC, load_number DESC`, where load numbers are unique per organization, so the order is total. `revenueLastSevenDays` by date ascending. `drivers` by `position, id`.
- **`q`:** not accepted (§2.1). The table's live search is client-side over the Loads board rows (§5.6), exactly like Runtruck1's `matchesQuery`. The KPIs, chart and drivers never change with the search (Runtruck1 parity).
- **Limits:** `activeLoads` ≤ 6. `revenueLastSevenDays` = 7. `drivers` is the whole roster, bounded by the organization's fleet size, with no pagination (Runtruck1 renders every driver).

### 2.7 Query plan (no N+1)

The service (`DashboardService.get(ctx)`) runs a **constant number of set-based queries (6)**, whatever the number of loads or drivers. It runs them in **one read-only `REPEATABLE READ` transaction**, so the KPI count, the table and the chart come from the same snapshot. Every query and every join filters on `organization_id = ctx.organizationId`, and joins use the composite tenant keys `(organization_id, id)`.

No query reads the organization's whole history (architecture §37, §38). Stop look-ups are made **per load**, with the loads module's shared helper (§3), as `LEFT JOIN LATERAL (… LIMIT 1)` on `load_stops_load_sequence_uq`, and only for **candidate loads** found through a date index:

```sql
-- first pickup / last delivery of one load l
LEFT JOIN LATERAL (SELECT s.appointment_date, s.facility_id, s.city, s.state
                   FROM load_stops s WHERE s.organization_id = l.organization_id AND s.load_id = l.id
                   ORDER BY (s.kind <> 'pickup'), s.sequence LIMIT 1) fp ON true
LEFT JOIN LATERAL (SELECT s.appointment_date, s.facility_id, s.city, s.state,
                          (s.completed_at AT TIME ZONE s.timezone)::date AS completed_on
                   FROM load_stops s WHERE s.organization_id = l.organization_id AND s.load_id = l.id
                   ORDER BY (s.kind <> 'delivery'), s.sequence DESC LIMIT 1) ld ON true
```

| # | query | candidates (exact) | index used |
|---|---|---|---|
| 1 | Active table plus count: `SELECT … FROM (SELECT l.*, count(*) OVER () AS active_count FROM loads l WHERE l.organization_id = $org AND l.archived_at IS NULL AND l.status IN (active) ORDER BY l.created_at DESC, l.load_number DESC LIMIT 6) l JOIN customers …` with `fp`/`ld` and their `facilities` for the route labels of those ≤ 6 loads. Zero rows means count 0. | the active board loads | `loads_org_board_idx`, `load_stops_load_sequence_uq` |
| 2 | `lastWeekCount`: `count(*)` over candidates with `fp.appointment_date <= $d AND ld.appointment_date >= $d`. | loads with a stop dated `>= $d` (`SELECT DISTINCT load_id FROM load_stops WHERE organization_id = $org AND appointment_date >= $d`); exact, because the last delivery itself is such a stop | `load_stops_org_date_idx` |
| 3 | Revenue per day: `SELECT coalesce(ld.completed_on, ld.appointment_date) AS day, sum(revenue(l))::bigint … WHERE l.status IN ('needs_pod','delivered') AND day BETWEEN $prevWeekStart AND $weekEnd GROUP BY day`. The service derives the 7 chart bars, `thisWeekCents` and `previousWeekCents` from these ≤ 14 rows. The chart range always lies inside `[prevWeekStart, weekEnd]`. | loads with a stop dated in `[prevWeekStart, weekEnd]` ∪ loads with a stop completed in `[prevWeekStart − 1 day, weekEnd + 2 days)` read as UTC instants; exact, because delivered_on is the last delivery's completion date in its own timezone (every offset lies within a day of UTC) or, without one, its appointment date | `load_stops_org_date_idx`, `load_stops_org_completed_idx` |
| 4 | Deadhead: `sum(empty_miles)`, `sum(loaded_miles + empty_miles)` `GROUP BY (fp.appointment_date >= $weekStart)` over candidates with both mile columns set and `fp.appointment_date BETWEEN $prevWeekStart AND $weekEnd` | loads with a stop dated in `[prevWeekStart, weekEnd]`; exact, because the first pickup is such a stop | `load_stops_org_date_idx` |
| 5 | Unbilled: `count(*)`, `coalesce(sum(revenue(l)), 0)` over loads in delivered statuses `AND NOT EXISTS (SELECT 1 FROM invoice_items ii WHERE ii.organization_id = l.organization_id AND ii.load_id = l.id)`. This is the billing module's shared predicate (§3). It reads the delivered loads through `loads_org_status_idx` and anti-joins the invoice items; a stored billing fact is the documented fix if that ever becomes hot ([billing.md §9](billing.md)). | loads in delivered statuses | `loads_org_status_idx`, `invoice_items_org_load_idx` |
| 6 | Drivers: `drivers JOIN employees ORDER BY drivers.position, drivers.id` | the fleet | `drivers_org_position_idx` |

Sums are `bigint` in SQL. They are converted to JSON numbers after a safe-integer check. The response is never cached, because Redis is not authoritative (architecture §28) and a created load must show at once.

### 2.8 Tenancy and permissions

- The organization, user and timezone come only from the session (`AuthContext`). The endpoint takes no id and no organization input (04 §4, Rule 4). A second organization sees only its own rows: an organization with no loads or drivers gets `activeLoads: []`, seven `0` days, `drivers: []` and a zero/null summary (§4.1).
- `dashboard.view` covers every figure on the page, including revenue and unbilled totals for roles without `billing.view` (Dispatcher). The design brief §2 decides this, and [07 §7](../07-roles-permissions.md) notes it for review. The page exposes aggregates only. The table rows carry number, customer, route, rate and status; the driver rows carry name, duty status and HOS.
- Search rows come from `GET /loads`, which enforces `loads.view` itself (§5.6).

### 2.9 Errors

| HTTP | code | when |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Any query parameter is present (`issues: [{ path: "", message: "Unrecognized key: \"q\"" }]`). |
| 401 | `UNAUTHORIZED` | No or invalid session. |
| 403 | `FORBIDDEN` | The member lacks `dashboard.view` (default roles Driver and Maintenance). |
| 500 | `INTERNAL_ERROR` | Anything unexpected. It is logged with the request id and never shows SQL or internals. |

There is no 404, because the endpoint addresses no resource by id.

### 2.10 Writes, audit, events

None. The endpoint is read-only, writes no `audit_logs` row and emits no domain event. Reads are not audited (architecture §30 audits actions).

### 2.11 Tests (API integration, `apps/api/test`)

1. **Seed values:** signed in as Rosa (Admin), `GET /dashboard` returns exactly the seed values of §2.4–§2.5. That means 5 table rows in the order shown, the 7 `revenueCents`, the 6 drivers, and summary `{5, 3, 2}`, `{2468000, 1796000, 374}`, `{78, 92, 14}`, `{11, 3490000}`, with `meta.today` `2026-09-03`.
2. **Created load:** after `POST /loads` (Dispatcher) with a pickup after 2026-08-27, `summary.activeLoads.count` is 6, `deltaVsLastWeek` is 3, and `activeLoads[0].loadNumber` is 40223.
3. **Tenant isolation:** the "Test Carrier Co" owner gets the empty dashboard of §2.8. No Sunridge row or figure leaks.
4. **Permissions:** Driver and Maintenance fixture members get 403 `FORBIDDEN`. Dispatcher and Accounting get 200.
5. **Validation:** `GET /dashboard?q=x` gives 400 `VALIDATION_ERROR`.
6. **Unit tests** (service helpers): the week bounds for every weekday; half-away-from-zero rounding (for example −0.05 % → −1 tenth); `null` for a previous week with 0 revenue or no deadhead data; negative deltas.

## 3. Cross-domain dependencies

| from | what the dashboard needs | owner |
|---|---|---|
| Loads module (`apps/api`) | The exported first-pickup / last-delivery / route-label query helper (03 §6.0.3), so `route` equals `GET /loads` `route`. | loads group |
| `GET /loads?view=all&limit=500` | Board rows and their web view model with **exactly** Runtruck1's `Load` keys, and no UUID or other extra string or number fields, because `matchesQuery` would match them (§5.6). | loads group |
| Web load-status label/tone map | `needs_driver` "Needs driver" amber, `dispatched` "Dispatched" gray, `at_pickup` "At pickup" gray, `in_transit` "In transit" blue, `delayed` "Delayed" amber (03 §4.4). Shared with the Loads page. | loads group |
| Web duty-status label map | `on_duty` "On duty", `available` "Available", `home_time` "Home time" (03 §4.3). Shared with Fleet › Drivers. | fleet group |
| Billing module (`apps/api`) | The exported uninvoiced predicate (03 §6.0.4), used by `GET /billing/uninvoiced-loads` (whose `meta.summary` drives the top bar's "Invoice N loads") and by query 5. | accounting group |
| New Load mutation (web) | On success it invalidates the `['dashboard']` query key as well as the loads keys (gaps §2.5: Back must show the new load). | loads group |
| `@runtruck/calculations` | `formatWeekdayShort(date)`: `new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' }).format(new Date(date + 'T00:00:00Z'))` → "Thu". It does not exist yet. | calculations owner |

## 4. Where the Dashboard differs from Runtruck1 (D5)

Wording and formatting are Runtruck1's. Only these numbers change:

| value | Runtruck1 | computed (seed) |
|---|---|---|
| Active loads note | +4 vs. last week | +2 vs. last week |
| Revenue this week | $168K | $25K |
| Revenue this week note | +9.2% | +37.4% |
| Revenue chart heights Thu…Wed | 57, 78, 69, 89, **100**, 51, 39 % (Mon primary) | 42, 29, 26, 74, 46, 88, **100** % (Wed primary) |

These are unchanged: Active loads 5, Deadhead 7.8% and "1.4 pts better", Unbilled 11 and "$34,900 waiting", the table rows, the chart labels Thu…Wed and the driver notes.

### 4.1 Empty organization (not reachable with the seed)

"0", "+0 vs. last week"; "$0K", "—"; "—", "—"; "0", "$0 waiting". The table shows `Nothing matches “”.` (Runtruck1 quirk B2, D6). The chart shows seven 0% bars, all `var(--ui-primary)`, because every value equals the maximum 0. Runtruck1 would have rendered `NaN%` heights.

## 5. Web mapping: Dashboard (`/app/dashboard`)

### 5.1 Calls

| call | when | TanStack Query key |
|---|---|---|
| `api.get<DashboardData, DashboardMeta>('/dashboard')` | on mount | `['dashboard']` |
| `GET /loads?view=all&limit=500` (loads.md) | on mount, only when `can('loads.view')`, so the first keystroke already filters (Runtruck1 filters synchronously) | the Loads page's own key (shared cache) |

The top bar on this route (shell) shows the search input (placeholder "Search"), no Filters button, and primary "+ New Load", which opens NewLoadDialog (loads group). Runtruck1 has no loading state. Loading, refusal and error states follow the one shared rule of [implementation-brief §4](../reference/implementation-brief.md) ("Loading, refusal and error states"): the server prefetches `['dashboard']` so the first paint has the data; while it is pending or refused (403) the page renders its structure (the KPI row with values "—" and no notes, the three cards with their titles, no table rows, no bars, no driver rows, no empty-state line); any other error adds one `ui-empty` line with the API message in the "Active loads" card.

### 5.2 KPI row (`<Kpis items>`, every tile `is-clickable`)

`s = meta.summary`:

| label | value | note | onClick (query **not** cleared, B9) | seed |
|---|---|---|---|---|
| `Active loads` | `String(s.activeLoads.count)` | `` `${d >= 0 ? '+' : ''}${d} vs. last week` `` with `d = s.activeLoads.deltaVsLastWeek` | `router.push('/app/loads')` | "5" · "+2 vs. last week" |
| `Revenue this week` | `formatMoneyK(s.revenueThisWeek.thisWeekCents)` | `p === null ? '—' : `` `${p >= 0 ? '+' : ''}${(p / 10).toFixed(1)}%` `` with `p = changeTenthsOfPercent` | `router.push('/app/accounting/invoiced')` | "$25K" · "+37.4%" |
| `Deadhead miles` | `t === null ? '—' : `` `${(t / 10).toFixed(1)}%` `` with `t = percentTenths` | `b === null ? '—' : `` `${(Math.abs(b) / 10).toFixed(1)} pts ${b >= 0 ? 'better' : 'worse'}` `` with `b = pointsBetterTenths` | `router.push('/app/fleet/trucks')` | "7.8%" · "1.4 pts better" |
| `Unbilled loads` | `String(s.unbilledLoads.count)` | `` `${formatMoney(s.unbilledLoads.amountCents)} waiting` `` | `router.push('/app/accounting/uninvoiced')` | "11" · "$34,900 waiting" |

### 5.3 "Active loads" card

The markup is core-pages §2.1: `Card title="Active loads" flush`, with the action `<Link className="ui-link" href="/app/loads">View all</Link>`. The headers are `Load`, `Customer`, `Route`, `Rate` (`num`) and `Status` (`num`).

```
searching = query.trim().length > 0
rows = (searching ? boardRows.filter(r => matchesQuery(r, query)) : activeRows).slice(0, 6)
```

- `activeRows` = `data.activeLoads.map(toDashboardRow)` (§5.6).
- `boardRows` = the Loads board view-model rows (loads.md), in board order.
- Without `loads.view` (no default role with `dashboard.view` lacks it), `boardRows` falls back to `activeRows`.

A row renders `<tr className="is-clickable" onClick={() => router.push('/app/loads/' + r.id)}>` with the cells `r.id` (`strong`), `r.customer`, `r.route` (`muted`), `r.rate` (`num`) and `<Tag label={r.status} tone={r.tone}/>` (`num`). The React key is `r.id`. While searching, the title stays "Active loads" and non-active loads are listed (B3, D6). With no rows: `<div className="ui-empty">Nothing matches “{query}”.</div>`, using the raw untrimmed query and U+201C/U+201D.

### 5.4 "Revenue, last 7 days" card

```
max = Math.max(...days.map(d => d.revenueCents))
chart = days.map(d => ({
  day:  formatWeekdayShort(d.date),                                   // Thu … Wed
  h:    `${max === 0 ? 0 : Math.round(d.revenueCents / max * 100)}%`,
  fill: d.revenueCents === max ? 'var(--ui-primary)' : 'var(--ui-primary-soft)',
}))
```

`days` is `data.revenueLastSevenDays`. The inline-style markup is core-pages §2.1.1, with `repeat(${chart.length}, minmax(0, 1fr))`, key `day`, and no axes, values or tooltips. Bar height and highlight are presentation, computed in the web from the API's cents.

### 5.5 "Drivers" card

`data.drivers.map((d, i) => …)` with the markup of core-pages §2.1.2 (key `d.id`, `borderTop` when `i > 0`). Clicking a row calls `router.push('/app/fleet/drivers')`.

| field | rule | seed |
|---|---|---|
| `name` | `d.name` | "Marcus Hale" |
| `note` | `d.dutyStatus === 'on_duty' ? `` `On duty · ${formatHos(d.hosRemainingMinutes)} left` `` : DUTY_LABEL[d.dutyStatus]` | "On duty · 6h 20m left", "On duty · 9h 05m left", "On duty · 1h 45m left", "Available", "Available", "Home time" |
| `dot` | `on_duty` → `var(--ui-primary)`, `available` → `var(--ui-green)`, else `var(--ui-muted)` | primary ×3, green ×2, muted |

### 5.6 View-model rows (search parity)

Runtruck1 filtered its `Load` objects with `matchesQuery`. That function matches every own string or number field except `tagClass`, and the web's version also skips `tone`. Every row the table can filter must therefore carry **exactly** Runtruck1's keys and display strings, with nothing extra: no uuid, no cents, no enum value.

- **`toDashboardRow(a: DashboardActiveLoad)`** gives `{ id: formatLoadNumber(a.loadNumber), customer: a.customerName, route: a.route, rate: formatMoney(a.lineHaulCents), status: LOAD_STATUS_LABEL[a.status], tone: LOAD_STATUS_TONE[a.status] }`. These are Runtruck1's `Load` keys for the fields the table shows. Seed row 1: `{ id: 'L-40218', customer: 'Northgate Foods', route: 'Fresno, CA → Reno, NV', rate: '$2,450', status: 'In transit', tone: 'blue' }`. The DTO's `id` (uuid) is not copied into the row.
- **Board rows while searching** use the Loads view model (loads.md), which has Runtruck1's full `Load` key set: `id, customer, route, pickup, delivery, driver, unit, rate, status, miles, rpm, pay, margin, commodity, weight, equip, temp, ref, from, fromAddr, to, toAddr, carrier, carrierMc, carrierDot`, plus `mode`, `ltl`, `carrierRate`, `notes` and `createdAt` on created loads. For example, "delivered" matches L-40212 and L-40210, and "812044" matches every own-fleet load, as in Runtruck1.

### 5.7 Cache invalidation

`['dashboard']` is invalidated by every mutation that can change a figure. In this release that is `POST /loads` and `POST /loads/:id/documents` (loads group). Later mutations of load status, invoices or drivers must do the same.

## 6. Decisions (to record in 01 §6)

1. **No compliance watchlist on the Dashboard.** The design brief §2 row "Compliance watchlist (Dashboard and Drivers tab)" conflicts with Runtruck1. The prototype's `DashboardPage.tsx` renders no watchlist; `COMPLIANCE`/`WATCHLIST` are read only by Fleet › Drivers. R1/D6 parity is applied: `GET /dashboard` returns no reminders, and the list is served by `GET /compliance-reminders` (safety group). **Open for the product owner** (recorded in 01 §6 as "needs product owner"; architecture §49).
2. **Table search source.** While searching, the table filters the Loads board rows from `GET /loads?view=all&limit=500`, prefetched when the member has `loads.view`. `GET /dashboard` does not duplicate the board DTO. Consequences:
   - Search covers the newest 500 board loads (01 §3 bound).
   - A member without `loads.view` searches only the active rows.
3. **Wire shape.**
   - KPI tiles are in `meta.summary`, as on every other screen.
   - Percentages travel as integer tenths, rounded on the server in integer arithmetic (half away from zero). The web only formats.
   - `"—"` appears when a base is zero or missing.
   - Any query parameter is rejected.
4. **Chart presentation.**
   - The weekday label comes from each date via a new shared `formatWeekdayShort`. The range today − 7 … today − 1 yields Runtruck1's Thu…Wed without storing labels.
   - Heights and highlight are computed in the web.
   - When max = 0, every height is 0% and every bar is primary; Runtruck1 would have rendered `NaN%`.
5. **Consistency.** One read-only `REPEATABLE READ` transaction per request, and no server cache.
