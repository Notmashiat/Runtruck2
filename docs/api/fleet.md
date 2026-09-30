# API — Fleet (drivers, trucks, trailers)

Endpoint specification for Fleet › Drivers, Fleet › Trucks and Fleet › Trailers, and for the New Load "Driver & equipment" pickers. It follows the conventions of [04-api.md](../04-api.md) (envelopes, errors, lists, formats) and computes every value by the rules of [03-database.md §6.6](../03-database.md) (D5). The screens it serves are specified in [reference/runtruck1/fleet-hr-safety.md](../reference/runtruck1/fleet-hr-safety.md) §2–§5 and [new-load.md](../reference/runtruck1/new-load.md) §6.6.

- Wire types: `packages/types/src/fleet.ts`. Input schemas: `packages/validation/src/fleet.ts`.
- API modules (architecture §6): `apps/api/src/drivers/`, `apps/api/src/trucks/`, `apps/api/src/trailers/`, registered in `apps/api/src/modules/fleet-crm.ts`.
- The compliance watchlist on the Drivers tab is served by `GET /compliance-reminders`, specified in [safety.md](safety.md). This document only states what the Drivers tab needs from it (§5.1).

## 0. Feature summary (architecture §44)

| item | content |
|---|---|
| FEATURE | Fleet read views: driver roster with HOS, current load, CDL, pay YTD and week miles; power units; trailers; each with its KPI row. |
| PURPOSE | Runtruck1 parity (R1) with the data served from PostgreSQL (R2). |
| USERS | Dispatchers, fleet and safety managers, accounting (drivers only). |
| PERMISSIONS | `drivers.view` (includes pay), `trucks.view`, `trailers.view` ([07 §6.1](../07-roles-permissions.md)). |
| DATABASE TABLES | read: `drivers`, `employees`, `driver_mileage_entries`, `trucks`, `trailers`, `facilities`, `driver_documents`, `settlements`, `settlement_items`, `dispatches`, `loads`, `load_stops`. |
| DATABASE CHANGES | none. |
| API ENDPOINTS | `GET /drivers`, `GET /trucks`, `GET /trailers`. |
| BUSINESS RULES | 03 §6.6 (current load, pay YTD, week miles, HOS at risk < 120 min, miles until service, trailer counts). |
| STATE CHANGES / EVENTS / JOBS / NOTIFICATIONS / INTEGRATIONS / AI | none. The screens are read-only; every write control is an inert stub (§6). HOS and mileage are stored ELD facts; no integration in this release (01 §5). |
| SECURITY | session auth, permission guard, organization from the session only, no internal details in errors. |
| ERROR CASES | §1.5. |
| TESTS | §7. |
| ACCEPTANCE CRITERIA | the seed renders exactly the strings of §5 (every value equals Runtruck1 except Pay YTD, §8); tenant isolation and permission denial proven by integration tests; architecture §45. |

## 1. Rules shared by the three endpoints

### 1.1 Clock and windows

`today = ClockService.today(ctx.timezone)` (D4; 2026-09-03 for the seed). The **org week** is the Monday–Sunday week containing `today` (2026-08-31 … 2026-09-06). **YTD** is January 1 of `today`'s year through `today`, inclusive (2026-01-01 … 2026-09-03). Nothing reads the server's own date.

### 1.2 List mechanics

- Query: `limit` (1–500, default 100), `offset` (≥ 0), `q` (trimmed, ≤ 200 characters), plus the per-endpoint filters below. Validated by the named Zod schema through `ZodValidationPipe`; unknown parameters are ignored.
- The service builds **every row of the organization** with the fixed number of set-based queries given per endpoint (reference lists: tens to a few thousand rows per organization; [04 §5.1](../04-api.md) rule 2). Their child look-ups are bounded: the current-load search reads only live dispatches of board loads and their stops per load (§2.7), never the organization's stop history. It then:
  1. computes `meta.summary` over **all** rows. The summary ignores `q` and every filter, because Runtruck1's search and pills never change a KPI (03 §6);
  2. applies the filters, then `q` (§1.3; at most the first 5,000 rows are matched, 04 §5.1);
  3. sets `meta.total` to the filtered count and returns `data = rows.slice(offset, offset + limit)`.
- Response: `{ data: Item[], meta: { total, limit, offset, summary } }` (04 §2).
- If an organization ever exceeds ~5,000 rows on one of these lists, filtering and paging move into SQL. That is a performance change only; the contract stays the same.

### 1.3 Server-side `q`

`q` reproduces Runtruck1's `matchesQuery` (fleet-hr-safety §2.8): `needle = q.trim().toLowerCase()`; an empty needle matches everything; otherwise a row matches when any of its **searchable display strings** (listed per endpoint, formatted exactly as the web formats them in §5 with `@runtruck/calculations`) contains the needle after lowercasing. Raw numbers that Runtruck1 kept as numbers (driver `miles`) are matched as their decimal digits (`String(2140)`). Ids, enum values and cents are never searched.

The web does not send `q`; it filters the rows it holds with the same rule on the same view-model (§5), so both paths give identical results.

### 1.4 Tenancy

Every statement filters `organization_id = ctx.organizationId` on **every** table it reads, and every join also matches `organization_id` on both sides (`trucks.organization_id = drivers.organization_id AND trucks.assigned_driver_id = drivers.id`). The composite tenant foreign keys (03 §1.3) make a cross-tenant reference impossible even if a join condition were missing. No endpoint accepts an organization id. A member of another organization sees only that organization's rows (an empty list for "Test Carrier Co").

### 1.5 Errors

| HTTP | code | when |
|---|---|---|
| 400 | `VALIDATION_ERROR` | `limit` outside 1–500, negative `offset`, `q` longer than 200, unknown `dutyStatus` value. `issues[]` names the parameter. |
| 401 | `UNAUTHORIZED` | no or expired session. |
| 403 | `FORBIDDEN` | the member lacks the endpoint's permission. |
| 403 | `NO_ACTIVE_MEMBERSHIP` | the account has no active organization. |
| 500 | `INTERNAL_ERROR` | anything unexpected (logged with the request id; no details returned). |

There is no 404: these are collection reads.

### 1.6 Audit and events

None. The three endpoints are reads. Reads are not audited (architecture §30 audits changes). The future writes behind the stub buttons are listed in §6.

## 2. `GET /api/v1/drivers`

| | |
|---|---|
| Permission | `drivers.view`. It also covers Pay YTD ([07 §2.1](../07-roles-permissions.md)), and the roster facts Runtruck1 kept on its `Driver` record: the unit (from `trucks`), the current load (from `dispatches`/`loads`/`load_stops`) and the CDL month (from `driver_documents`). |
| Query | `driverListQuerySchema` → `DriverListQuery`: `limit`, `offset`, `q`, and `dutyStatus?: 'on_duty' \| 'available' \| 'home_time'` (the pill filter; the web does not send it, see §5.1). |
| Response | `DriverListResponse` = `{ data: DriverListItem[], meta: DriverListMeta }`. |
| Consumers | Fleet › Drivers (roster, KPIs, miles card); New Load "Driver" select (loads group). The Dashboard "Drivers" card is served by `GET /dashboard` ([dashboard.md](dashboard.md)). |

### 2.1 `DriverListItem`

| field | type | computed from |
|---|---|---|
| `id` | `string` (uuid) | `drivers.id` |
| `fullName` | `string` | `employees.first_name + ' ' + employees.last_name` via `drivers.employee_id` |
| `dutyStatus` | `DriverDutyStatus` | `drivers.duty_status` |
| `hosRemainingMinutes` | `number \| null` | `drivers.hos_remaining_minutes` |
| `truck` | `{ id, unitNumber } \| null` | the `trucks` row whose `assigned_driver_id` is the driver (at most one, `trucks_org_assigned_driver_uq`) |
| `currentLoad` | `DriverCurrentLoad \| null` | §2.2 |
| `cdlExpiresOn` | `string \| null` (`YYYY-MM-DD`) | `driver_documents.expires_on` of the driver's `document_type = 'cdl'` row (at most one, `driver_documents_org_driver_type_uq`); null when there is no row or it is missing |
| `payYtdCents` | `number` | Σ `settlement_items.amount_cents` with `kind = 'line_pay'` over the driver's `settlements` whose `period_start` is in YTD, any settlement status; 0 when none |
| `weekMiles` | `number` | Σ `driver_mileage_entries.miles` with `recorded_on` in the org week; 0 when none |

`DriverCurrentLoad`:

| field | type | computed from |
|---|---|---|
| `id` | `string` | `loads.id` |
| `loadNumber` | `number` | `loads.load_number` |
| `status` | `'at_pickup' \| 'in_transit' \| 'delayed' \| 'dispatched'` | `loads.status` |
| `firstPickupDate` | `string` (`YYYY-MM-DD`) | the first pickup's `appointment_date` (03 §6.0.3) |
| `originShort` | `string \| null` | stop short market of the first pickup: `coalesce(facilities.market_short, facilities.market_city, facilities.city, load_stops.city)` |
| `destinationShort` | `string \| null` | the same for the last delivery |

`originShort`/`destinationShort` are null only when the chosen stop is a fuel stop without a facility, which no load created through `POST /loads` can produce.

### 2.2 Current-load selection (03 §6.6)

Candidates are the driver's **live dispatches** (`dispatches.driver_id` = the driver, `dispatches.status <> 'cancelled'`) on **board loads** (`loads.archived_at IS NULL`) that have at least one stop:

1. loads in `at_pickup`, `in_transit` or `delayed`;
2. otherwise loads in `dispatched`;
3. otherwise none (`null`).

Within a tier: the earliest `firstPickupDate`, then the lowest `load_number`. First pickup = the `pickup` stop with the lowest `sequence`, else the lowest-sequence stop; last delivery = the `delivery` stop with the highest `sequence`, else the highest-sequence stop.

Seed: Marcus → L-40218 (in transit), Dara → L-40219 (at pickup), Ellis → L-40220 (delayed), Ana → L-40222 (dispatched); Priya's L-40214 (`needs_pod`) and Tobias's L-40210 (`delivered`) are not candidates, so both are `null`.

### 2.3 Order

`ORDER BY drivers.position, drivers.id`: Marcus Hale, Dara Whitfield, Ellis Nakamura, Priya Raman, Ana Cortez, Tobias Frey (Runtruck1's `DRIVERS` order).

### 2.4 Searchable fields (`q`)

The Runtruck1 `Driver` fields except `tagClass`, as display strings (view-model §5.1): `name`, `status` (label), `unit`, `load`, `hos`, `cdl`, `pay`, and `miles` as its raw digits. So "2140" matches Marcus Hale although miles are not a roster column, and "—" matches Priya Raman and Tobias Frey.

### 2.5 `meta.summary`: `DriverListSummary`

Computed over all of the organization's drivers (never filtered by `q` or `dutyStatus`).

| field | type | formula | seed |
|---|---|---|---|
| `asOf` | `string` | `today` | `"2026-09-03"` |
| `weekStart`, `weekEnd` | `string` | the org week | `"2026-08-31"`, `"2026-09-06"` |
| `ytdStart` | `string` | January 1 of today's year | `"2026-01-01"` |
| `rosterCount` | `number` | count of drivers | 6 |
| `onDutyCount` | `number` | count `duty_status = 'on_duty'` | 3 |
| `availableCount` | `number` | count `duty_status = 'available'` | 2 |
| `homeTimeCount` | `number` | `rosterCount − onDutyCount − availableCount` (Runtruck1's formula; equals the `home_time` count while the enum has three values) | 1 |
| `hoursAtRisk` | `DriverHoursAtRisk[]` | drivers with `duty_status = 'on_duty'` and `hos_remaining_minutes < 120` (null is never at risk), in roster order; each `{ driverId, fullName, lastName (employees.last_name), hosRemainingMinutes }` | `[{ fullName: "Ellis Nakamura", lastName: "Nakamura", hosRemainingMinutes: 105 }]` |
| `totalWeekMiles` | `number` | Σ `weekMiles` over all drivers | 9120 |
| `maxWeekMiles` | `number` | max `weekMiles` over all drivers; 0 when there are no drivers | 2140 |

The "Docs to renew" KPI is **not** in this summary: it is the reminder count of `GET /compliance-reminders` (`compliance.view`), so compliance data stays behind its own permission (§5.1, decision F1).

### 2.6 Rows against the seed

| fullName | dutyStatus | truck | currentLoad | hosRemainingMinutes | cdlExpiresOn | payYtdCents (Runtruck1) | weekMiles |
|---|---|---|---|---|---|---|---|
| Marcus Hale | on_duty | T-114 | 40218 in_transit, Fresno → Reno | 380 | 2028-04-30 | 132600 ($61,400) | 2140 |
| Dara Whitfield | on_duty | T-107 | 40219 at_pickup, Stockton → SLC | 545 | 2027-11-30 | 118800 ($58,900) | 1980 |
| Ellis Nakamura | on_duty | T-121 | 40220 delayed, Sacramento → Boise | 105 | 2027-02-28 | 145500 ($55,120) | 1760 |
| Priya Raman | available | T-103 | null | 660 | 2026-07-31 | 82400 ($52,480) | 1420 |
| Ana Cortez | available | T-109 | 40222 dispatched, pickup 2026-09-05 (Cascade Mill → Duwamish Steel Yard: Redding → Seattle) | 660 | 2029-09-30 | 68400 ($48,300) | 1180 |
| Tobias Frey | home_time | T-118 | null | null | 2028-01-31 | 0 ($63,750) | 640 |

Pay YTD is the only drivers value that differs from Runtruck1 (D5, 03 §8): only the week-of-Sep-1 settlements exist, and Tobias Frey has none.

Example item:

```json
{
  "id": "…", "fullName": "Ana Cortez", "dutyStatus": "available", "hosRemainingMinutes": 660,
  "truck": { "id": "…", "unitNumber": "T-109" },
  "currentLoad": { "id": "…", "loadNumber": 40222, "status": "dispatched", "firstPickupDate": "2026-09-05",
                   "originShort": "Redding", "destinationShort": "Seattle" },
  "cdlExpiresOn": "2029-09-30", "payYtdCents": 68400, "weekMiles": 1180
}
```

### 2.7 Query plan (no N+1)

One statement per request, whatever the number of drivers:

```sql
WITH miles AS (
  SELECT driver_id, sum(miles)::int AS week_miles
  FROM driver_mileage_entries
  WHERE organization_id = $org AND recorded_on BETWEEN $weekStart AND $weekEnd
  GROUP BY driver_id),
pay AS (
  SELECT s.driver_id, sum(si.amount_cents)::bigint AS pay_ytd
  FROM settlements s
  JOIN settlement_items si ON si.organization_id = s.organization_id AND si.settlement_id = s.id AND si.kind = 'line_pay'
  WHERE s.organization_id = $org AND s.period_start BETWEEN $ytdStart AND $today
  GROUP BY s.driver_id),
cur AS (
  SELECT DISTINCT ON (d.driver_id) d.driver_id, l.id AS load_id, l.load_number, l.status AS load_status,
         fp.appointment_date AS first_pickup_date,
         coalesce(ff.market_short, ff.market_city, ff.city, fp.city) AS origin_short,
         coalesce(lf.market_short, lf.market_city, lf.city, ld.city) AS destination_short
  FROM dispatches d
  JOIN loads l ON l.organization_id = d.organization_id AND l.id = d.load_id
   AND l.archived_at IS NULL AND l.status IN ('at_pickup', 'in_transit', 'delayed', 'dispatched')
  JOIN LATERAL (SELECT * FROM load_stops s WHERE s.organization_id = l.organization_id AND s.load_id = l.id
                ORDER BY (s.kind <> 'pickup'), s.sequence LIMIT 1) fp ON true
  JOIN LATERAL (SELECT * FROM load_stops s WHERE s.organization_id = l.organization_id AND s.load_id = l.id
                ORDER BY (s.kind <> 'delivery'), s.sequence DESC LIMIT 1) ld ON true
  LEFT JOIN facilities ff ON ff.organization_id = fp.organization_id AND ff.id = fp.facility_id
  LEFT JOIN facilities lf ON lf.organization_id = ld.organization_id AND lf.id = ld.facility_id
  WHERE d.organization_id = $org AND d.status <> 'cancelled' AND d.driver_id IS NOT NULL
  ORDER BY d.driver_id, (l.status = 'dispatched'), fp.appointment_date, l.load_number)
SELECT dr.id, e.first_name, e.last_name, dr.duty_status, dr.hos_remaining_minutes,
       t.id AS truck_id, t.unit_number, cdl.expires_on AS cdl_expires_on,
       coalesce(pay.pay_ytd, 0) AS pay_ytd, coalesce(miles.week_miles, 0) AS week_miles,
       cur.load_id, cur.load_number, cur.load_status, cur.first_pickup_date, cur.origin_short, cur.destination_short
FROM drivers dr
JOIN employees e ON e.organization_id = dr.organization_id AND e.id = dr.employee_id
LEFT JOIN trucks t ON t.organization_id = dr.organization_id AND t.assigned_driver_id = dr.id
LEFT JOIN driver_documents cdl ON cdl.organization_id = dr.organization_id AND cdl.driver_id = dr.id AND cdl.document_type = 'cdl'
LEFT JOIN miles ON miles.driver_id = dr.id
LEFT JOIN pay ON pay.driver_id = dr.id
LEFT JOIN cur ON cur.driver_id = dr.id
WHERE dr.organization_id = $org
ORDER BY dr.position, dr.id;
```

Indexes used: `drivers_org_position_idx`, `driver_mileage_entries_org_recorded_idx`, `settlements_org_period_idx`, `dispatches_org_driver_idx`, `load_stops_load_sequence_uq`, `trucks_org_assigned_driver_uq`, `driver_documents_org_driver_type_uq`. The summary is computed in memory from these rows. Sums come back as `bigint` and are converted with `Number()` (cents stay far below 2^53).

## 3. `GET /api/v1/trucks`

| | |
|---|---|
| Permission | `trucks.view` |
| Query | `truckListQuerySchema` → `TruckListQuery`: `limit`, `offset`, `q`. |
| Response | `TruckListResponse` = `{ data: TruckListItem[], meta: TruckListMeta }`. |
| Consumers | Fleet › Trucks; New Load "Truck" select and the driver-to-truck auto-fill (loads group). |

### 3.1 `TruckListItem`

| field | type | computed from |
|---|---|---|
| `id` | `string` | `trucks.id` |
| `unitNumber` | `string` | `trucks.unit_number` |
| `make` | `string` | `trucks.make` |
| `model` | `string` | `trucks.model` |
| `modelYear` | `number` | `trucks.model_year` |
| `plateState` | `string` | `trucks.plate_state` |
| `plateNumber` | `string` | `trucks.plate_number` |
| `assignedDriver` | `{ id, fullName } \| null` | `trucks.assigned_driver_id` → `drivers` → `employees` (full name as §2.1) |
| `odometerMiles` | `number` | `trucks.odometer_miles` |
| `nextServiceMiles` | `number \| null` | `trucks.next_service_miles` |
| `status` | `TruckStatus` | `trucks.status` |

### 3.2 Order

`ORDER BY trucks.unit_number COLLATE "C", trucks.id` (byte order, so the result never depends on the database locale): T-103, T-107, T-109, T-114, T-118, T-121 (Runtruck1's `TRUCKS` order).

### 3.3 Searchable fields (`q`)

`unit`, `make` ("Peterbilt 579 · 2020"), `plate` ("CA 6PL4408"), `driver`, `odo` and `service` as **comma-formatted** strings ("318,440" matches, "318440" does not), `status` (label).

### 3.4 `meta.summary`: `TruckListSummary`

| field | type | formula | seed |
|---|---|---|---|
| `truckCount` | `number` | count of trucks | 6 |
| `averageOdometerMiles` | `number \| null` | Σ `odometer_miles` / count, unrounded; null when there are no trucks | 379690 (2,278,140 / 6) |
| `inServiceCount` | `number` | count `status = 'in_service'` | 4 |
| `inShopUnitNumbers` | `string[]` | `unit_number` of trucks with `status = 'in_shop'`, in list order | `["T-118"]` |
| `serviceDue` | `TruckServiceDue[]` | trucks with `status = 'service_due'`, in list order; each `{ truckId, unitNumber, milesUntilService }` with `milesUntilService = next_service_miles − odometer_miles`, null when `next_service_miles` is null | `[{ unitNumber: "T-114", milesUntilService: 900 }]` |

All values equal Runtruck1's.

### 3.5 Rows against the seed

| unitNumber | make · model · year | plate | assignedDriver | odometerMiles | nextServiceMiles | status |
|---|---|---|---|---|---|---|
| T-103 | Freightliner Cascadia 2022 | CA 8HJ2019 | Priya Raman | 318440 | 342000 | in_service |
| T-107 | Volvo VNL 760 2021 | CA 7RD8842 | Dara Whitfield | 402190 | 425000 | in_service |
| T-109 | Kenworth T680 2023 | CA 9KM1174 | Ana Cortez | 141220 | 165000 | in_service |
| T-114 | Peterbilt 579 2020 | CA 6PL4408 | Marcus Hale | 528900 | 529800 | service_due |
| T-118 | Freightliner Cascadia 2019 | CA 5TT9930 | Tobias Frey | 611780 | null | in_shop |
| T-121 | International LT 2022 | CA 8WQ2251 | Ellis Nakamura | 275610 | 298000 | in_service |

### 3.6 Query plan

One statement: `trucks LEFT JOIN drivers ON (organization_id, assigned_driver_id) LEFT JOIN employees ON (organization_id, employee_id) WHERE trucks.organization_id = $org ORDER BY unit_number COLLATE "C", id`. Index: `trucks_org_unit_uq`. The summary is computed in memory from the rows.

## 4. `GET /api/v1/trailers`

| | |
|---|---|
| Permission | `trailers.view` |
| Query | `trailerListQuerySchema` → `TrailerListQuery`: `limit`, `offset`, `q`. |
| Response | `TrailerListResponse` = `{ data: TrailerListItem[], meta: TrailerListMeta }`. |
| Consumers | Fleet › Trailers; New Load "Trailer" select (loads group). |

### 4.1 `TrailerListItem`

| field | type | computed from |
|---|---|---|
| `id` | `string` | `trailers.id` |
| `unitNumber` | `string` | `trailers.unit_number` |
| `trailerType` | `TrailerType` | `trailers.trailer_type` |
| `lengthFt` | `number` | `trailers.length_ft` |
| `status` | `TrailerStatus` | `trailers.status` |
| `location` | `TrailerLocation` | by `trailers.location_kind`: `yard` → `{ kind: 'yard', facilityId, facilityName, city }` from the `location_facility_id` facility (`facilities.name`, `facilities.city`); `en_route` → `{ kind: 'en_route', route: location_route }`; `city` → `{ kind: 'city', city: location_city, state: location_state }` (the CHECK `trailers_location_ck` guarantees the needed columns) |

Trailer status and location are stored facts, never derived from loads (fleet-hr-safety B10, B11).

### 4.2 Order

`ORDER BY trailers.position, trailers.id`: RF-27, RF-09, RF-88, DV-51, DV-88, DV-14, FB-04, FB-12 (Runtruck1's hand-authored `TRAILERS` order).

### 4.3 Searchable fields (`q`)

`unit`, `kind` ("Reefer · 53 ft"), `status` (label), `where` ("Yard · Modesto", "En route · I-80", "Bakersfield, CA").

### 4.4 `meta.summary`: `TrailerListSummary`

| field | type | formula | seed |
|---|---|---|---|
| `trailerCount` | `number` | count of trailers | 8 |
| `typeCounts` | `Record<TrailerType, number>` | count per `trailer_type` (every key present, 0 when none) | `{ reefer: 3, dry_van: 3, flatbed: 2 }` |
| `loadedCount` | `number` | count `status = 'loaded'` | 4 |
| `rollingCount` | `number` | count `status = 'loaded'` and `location_kind = 'en_route'` | 1 |
| `atShippersCount` | `number` | `loadedCount − rollingCount` (Runtruck1's formula) | 3 |
| `emptyCount` | `number` | count `status = 'empty'` | 3 |
| `emptyAtYardCount` | `number` | count `status = 'empty'` and `location_kind = 'yard'` | 2 |
| `inspectionUnitNumbers` | `string[]` | `unit_number` of trailers with `status = 'inspection'`, in list order | `["FB-12"]` |

All values equal Runtruck1's.

### 4.5 Rows against the seed

| unitNumber | trailerType · lengthFt | status | location |
|---|---|---|---|
| RF-27 | reefer · 53 | loaded | city Bakersfield, CA |
| RF-09 | reefer · 53 | empty | yard Sunridge yard (Modesto) |
| RF-88 | reefer · 53 | loaded | en_route I-80 |
| DV-51 | dry_van · 53 | loaded | city Stockton, CA |
| DV-88 | dry_van · 53 | empty | yard Sunridge yard (Modesto) |
| DV-14 | dry_van · 53 | empty | city Las Vegas, NV |
| FB-04 | flatbed · 48 | loaded | city Redding, CA |
| FB-12 | flatbed · 48 | inspection | yard Sunridge yard (Modesto) |

### 4.6 Query plan

One statement: `trailers LEFT JOIN facilities ON (organization_id, location_facility_id) WHERE trailers.organization_id = $org ORDER BY position, id`. Index: `trailers_org_position_idx`. The summary is computed in memory.

## 5. Web mapping

All three pages are `'use client'` components under the `/app` layout. They fetch once with TanStack Query (the server page may pass `initialData` so the first paint has the data; Runtruck1 has no loading state). They request **one bounded page** (`limit=500`), never send `q`, and filter locally with Runtruck1's `matchesQuery` over the view-model rows below. Markup, classes and CSS are exactly fleet-hr-safety §2–§5.

**Label and tone maps** (web presentation; `Tag` tone):

| enum | value → label (tone) |
|---|---|
| `DriverDutyStatus` | `on_duty` → "On duty" (blue) · `available` → "Available" (gray) · `home_time` → "Home time" (gray) |
| `TruckStatus` | `in_service` → "In service" (blue) · `service_due` → "Service due" (amber) · `in_shop` → "In shop" (amber) |
| `TrailerType` | `reefer` → "Reefer" · `dry_van` → "Dry van" · `flatbed` → "Flatbed" |
| `TrailerStatus` | `loaded` → "Loaded" (blue) · `empty` → "Empty" (gray) · `inspection` → "Inspection" (amber) |

**View-model convention.** Each table row is an object with **exactly** the Runtruck1 mock row's keys (minus `tagClass`), holding the same display strings, plus one key `ref` whose value is an object (`{ id, tone, … }`). `matchesQuery` only looks at string and number values, so `ref` is never searched, and ids, enum values and cents can never match a query (fleet-hr-safety H11). React keys use `ref.id`.

### 5.1 Fleet › Drivers (`/app/fleet/drivers`)

Calls: `GET /api/v1/drivers?limit=500` and `GET /api/v1/compliance-reminders?limit=500` ([safety.md](safety.md)). The pill (`driverTab` in the shell context: 'All' | 'On duty' | 'Available') filters locally on `ref.dutyStatus`, so the miles card, which lists every driver, needs the unfiltered rows.

**Row view-model** (`DriverRowVm`, Runtruck1 `Driver`):

| key | type | from `DriverListItem` | seed (Marcus Hale) |
|---|---|---|---|
| `name` | string | `fullName` | "Marcus Hale" |
| `status` | string | duty label | "On duty" |
| `unit` | string | `truck?.unitNumber ?? '—'` | "T-114" |
| `load` | string | `currentLoad === null` → `'—'`; `status === 'dispatched'` → `` `${formatLoadNumber(loadNumber)} · ${formatShortDate(firstPickupDate)}` ``; otherwise `` `${formatLoadNumber(loadNumber)} · ${originShort ?? '—'} → ${destinationShort ?? '—'}` `` | "L-40218 · Fresno → Reno" (Ana: "L-40222 · Sep 5") |
| `hos` | string | `formatHos(hosRemainingMinutes)` ("—" for null) | "6h 20m" |
| `cdl` | string | `cdlExpiresOn ? formatMmYyyy(cdlExpiresOn) : '—'` | "04/2028" |
| `pay` | string | `formatMoney(payYtdCents)` | "$1,326" (Runtruck1 "$61,400", D5) |
| `miles` | number | `weekMiles` (raw number, searched as digits) | 2140 |
| `ref` | object | `{ id, dutyStatus, tone }` | |

Roster rows: `vms.filter(r => (driverTab === 'All' || r.status === driverTab) && matchesQuery(r, query))`. Empty: `Nothing matches “{query}”.` (also when a pill yields no rows with an empty query, B18, D6).

**KPIs** (label · value · note):

| label | value | note | seed |
|---|---|---|---|
| On the roster | `String(summary.rosterCount)` | `` `${summary.onDutyCount} on duty · ${summary.homeTimeCount} home time` `` | 6 · "3 on duty · 1 home time" |
| Available now | `String(summary.availableCount)` | literal "Both reset today" | 2 |
| Hours at risk | `String(summary.hoursAtRisk.length)` | `` summary.hoursAtRisk.map(d => `${d.lastName} · ${formatHos(d.hosRemainingMinutes)}`).join(', ') || 'Nobody under 2h' `` | 1 · "Nakamura · 1h 45m" |
| Docs to renew | `String(reminders.meta.total)` | literal "On the watchlist below" | 4 |

**Miles per driver, this week** (every row, in roster order, ignoring pill and search): name `fullName`; bar width `` `${Math.round(weekMiles / summary.maxWeekMiles * 100)}%` ``; opacity `weekMiles === summary.maxWeekMiles ? 1 : 0.55`; label `formatInt(weekMiles)`; card action `` `${formatInt(summary.totalWeekMiles)} mi total` ``. Seed: 100 / 93 / 82 / 66 / 55 / 30 %, "2,140" … "640", "9,120 mi total". Runtruck1's expressions are kept verbatim, so their edge cases (a zero maximum gives `NaN%`) behave as in Runtruck1 (D6); none is reachable with the seed.

**Compliance watchlist** (`GET /compliance-reminders`, rows in the order served, not searched): `name` = the reminder's driver name, `item` = its item label, `due` = `duePrecision === 'day' ? formatShortDate(dueOn) : formatMonthYear(dueOn)`. Seed: Priya Raman · CDL renewal · Jul 2026; Ellis Nakamura · Medical card · Oct 12; Ana Cortez · Annual MVR review · Sep 24; Marcus Hale · Clearinghouse query · Sep 20. Link "All documents →" to `/app/safety/driver-documents` (the query is not cleared).

Without `compliance.view` the reminders call is refused (403): the page still renders, with "Docs to renew" value "—" and the watchlist table head with no rows (decision F1; not reachable for Rosa, who holds every permission).

### 5.2 Fleet › Trucks (`/app/fleet/trucks`)

Calls: `GET /api/v1/trucks?limit=500`.

**Row view-model** (`TruckRowVm`, Runtruck1 `Truck`):

| key | from `TruckListItem` | seed (T-114) |
|---|---|---|
| `unit` | `unitNumber` | "T-114" |
| `make` | `` `${make} ${model} · ${modelYear}` `` | "Peterbilt 579 · 2020" |
| `plate` | `` `${plateState} ${plateNumber}` `` | "CA 6PL4408" |
| `driver` | `assignedDriver?.fullName ?? '—'` | "Marcus Hale" |
| `odo` | `formatInt(odometerMiles)` | "528,900" |
| `service` | `nextServiceMiles === null ? '—' : formatInt(nextServiceMiles)` | "529,800" (T-118: "—") |
| `status` | status label | "Service due" |
| `ref` | `{ id, tone }` | |

**KPIs:**

| label | value | note | seed |
|---|---|---|---|
| Power units | `String(summary.truckCount)` | `` `Avg ${Math.round((summary.averageOdometerMiles ?? NaN) / 1000)}K mi` `` | 6 · "Avg 380K mi" |
| In service | `String(summary.inServiceCount)` | `` `Of ${summary.truckCount} units` `` | 4 · "Of 6 units" |
| In shop | `String(summary.inShopUnitNumbers.length)` | `` inShopUnitNumbers.length ? `${inShopUnitNumbers.join(', ')} · turbo` : 'Bays clear' `` (" · turbo" is Runtruck1's literal caption, D6) | 1 · "T-118 · turbo" |
| Service due | `String(summary.serviceDue.length)` | `` serviceDue.map(s => `${s.unitNumber} in ${formatInt(s.milesUntilService ?? NaN)} mi`).join(', ') || 'Nothing due' `` (a null distance prints "NaN" exactly like Runtruck1, B5, D6) | 1 · "T-114 in 900 mi" |

### 5.3 Fleet › Trailers (`/app/fleet/trailers`)

Calls: `GET /api/v1/trailers?limit=500`.

**Row view-model** (`TrailerRowVm`, Runtruck1 `Trailer`):

| key | from `TrailerListItem` | seed |
|---|---|---|
| `unit` | `unitNumber` | "RF-88" |
| `kind` | `` `${typeLabel} · ${lengthFt} ft` `` | "Reefer · 53 ft" |
| `status` | status label | "Loaded" |
| `where` | `yard` → `` `Yard · ${location.city}` ``; `en_route` → `` `En route · ${location.route}` ``; `city` → `` `${location.city}, ${location.state}` `` | "En route · I-80" (RF-09 "Yard · Modesto", RF-27 "Bakersfield, CA") |
| `ref` | `{ id, tone }` | |

**KPIs:**

| label | value | note | seed |
|---|---|---|---|
| Trailers | `String(summary.trailerCount)` | `` `${typeCounts.reefer} reefer · ${typeCounts.dry_van} dry van · ${typeCounts.flatbed} flatbed` `` | 8 · "3 reefer · 3 dry van · 2 flatbed" |
| Loaded | `String(summary.loadedCount)` | `` `${summary.rollingCount} rolling · ${summary.atShippersCount} at shippers` `` | 4 · "1 rolling · 3 at shippers" |
| Empty | `String(summary.emptyCount)` | `` `${summary.emptyAtYardCount} at the Modesto yard` `` (literal wording) | 3 · "2 at the Modesto yard" |
| Inspection | `String(summary.inspectionUnitNumbers.length)` | `` inspectionUnitNumbers.length ? `${inspectionUnitNumbers.join(', ')} · annual DOT` : 'None pending' `` | 1 · "FB-12 · annual DOT" |

### 5.4 New Load "Driver & equipment" (own fleet)

The dialog is owned by the loads group ([loads.md](loads.md)); it reads these endpoints (each needs its `.view`, 07 §6.3) with `limit=500` and keeps their order:

| select | option value | option text | seed (first option) |
|---|---|---|---|
| Driver | `DriverListItem.id` | `` `${fullName} · ${dutyLabel}` `` | "Marcus Hale · On duty" |
| Truck | `TruckListItem.id` | `` `${unitNumber} · ${statusLabel}` `` | "T-103 · In service" |
| Trailer | `TrailerListItem.id` | `` `${unitNumber} · ${typeLabel} · ${lengthFt} ft` `` | "RF-27 · Reefer · 53 ft" |

Choosing a driver sets the truck to `driver.truck?.id` only while no truck is chosen (Runtruck1 `prev.truck || driver.unit`). No list is filtered by availability (Runtruck1 parity); dispatch rules are enforced by `POST /loads`.

## 6. Stub controls (not implemented, 01 §7)

"Filters", "+ Add Driver", "Log service", "+ Add Unit" and "+ Add Trailer" stay inert and call nothing. When they are built, each is a write with Zod validation, a transaction, an audit row and an outbox event: `POST /drivers` (`drivers.create`, audit `DRIVER_CREATED`, event `DriverCreated`), `POST /trucks` (`trucks.create`, `TRUCK_CREATED`, `TruckCreated`), `POST /trailers` (`trailers.create`, `TRAILER_CREATED`, `TrailerCreated`); "Log service" creates a work order ([safety.md](safety.md), `maintenance.create`, `WORK_ORDER_CREATED`, `WorkOrderCreated`).

## 7. Tests

- Integration (`apps/api/test`, seeded by `seedTestFixtures`): each endpoint returns the seed rows of §2.6, §3.5 and §4.5 in order, and the summaries of §2.5, §3.4 and §4.4; `q` ("2140", "318,440", "yard", "—") returns the same rows as `matchesQuery` on the §5 view-models; `limit`/`offset`/`meta.total`; `dutyStatus=on_duty` returns 3 rows and an unchanged summary; a member without the permission gets 403 `FORBIDDEN`; a "Test Carrier Co" member sees none of Sunridge's rows; bad `limit` gives 400 `VALIDATION_ERROR`.
- Unit: current-load tiering and tie-breaks (§2.2); `hoursAtRisk` threshold (119 in, 120 out, null out); YTD and org-week boundaries (settlement starting Dec 31 of last year excluded; mileage on the Sunday included).

## 8. Differences from Runtruck1 (D5)

| screen | value | Runtruck1 | computed |
|---|---|---|---|
| Fleet › Drivers | Pay YTD (Marcus, Dara, Ellis, Priya, Ana, Tobias) | $61,400, $58,900, $55,120, $52,480, $48,300, $63,750 | $1,326, $1,188, $1,455, $824, $684, $0 |

Every other Fleet value equals Runtruck1's (03 §6.6, §8) **for the untouched seed**. The roster is computed from dispatches and loads (R2, D5), while Runtruck1's `DRIVERS` rows were constants: after "+ New Load" dispatches an own-fleet driver who had no in-progress or earlier dispatched load, that driver's "Current load" changes by the §2.2 rules (worked example A of loads.md §6.6: Priya Raman "—" → "L-40223 · Sep 5"), which Runtruck1 never showed. "Current load" is text, so D5 (numbers) does not cover it; recorded in 01 §6 as decided in design. The New Load success handler invalidates `['drivers']` ([loads.md §8.3.4](loads.md)).

## 9. Decisions made in this document

| # | Decision | Why |
|---|---|---|
| F1 | "Docs to renew" is `meta.total` of `GET /compliance-reminders`, not a field of the drivers summary. Without `compliance.view` (403) the KPI shows "—" and the watchlist has no rows, per the shared loading/refusal/error rule of implementation-brief §4 (as hr.md H4, safety.md S6). | Keeps compliance data behind `compliance.view` (07 §2.1); the screen already calls that list (design brief §3). |
| F2 | `drivers.view` covers the roster's unit, current load and CDL month as well as pay. | They are fields of Runtruck1's `Driver` record; splitting them across `loads.view`/`compliance.view` would blank roster cells for Accounting and Maintenance. |
| F3 | Lists are computed in full per organization, summarized, then filtered and paged in memory; `q` is evaluated over the §5 view-model strings built by the shared builders, over at most 5,000 rows (04 §5.1). | Keeps server `q` identical to the web search (03 §1.11) and KPIs independent of search; the lists are small reference data (04 §5.1 rule 2). |
| F5 | After New Load, a driver's "Current load" reflects the created load (computed from dispatches); Runtruck1 showed constants. | R2/D5 (§8); recorded in 01 §6. |
| F4 | Runtruck1's KPI and bar expressions are applied verbatim on the web, including their `NaN` edge cases (empty fleet, missing next-service reading, zero weekly maximum). | D6; none is reachable with the seed. |
