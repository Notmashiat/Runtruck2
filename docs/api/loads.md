# API — Loads

The Loads board, the load detail page and New Load. Conventions: [04-api.md](../04-api.md). Columns: [03 §5.6](../03-database.md); derived-value rules: [03 §6.0.3–§6.0.5, §6.3](../03-database.md). Statuses: [08-load-lifecycle.md](../08-load-lifecycle.md). Dispatch rules: [09-dispatch-lifecycle.md](../09-dispatch-lifecycle.md). Documents: [documents.md](documents.md), [13-document-system.md](../13-document-system.md). Runtruck1 behaviour: [core-pages §3–§4](../reference/runtruck1/core-pages.md), [new-load](../reference/runtruck1/new-load.md).

Contracts in code:
- DTOs — `packages/types/src/loads.ts`: `LoadListItem`, `LoadListMeta`, `LoadBoardSummary`, `LoadDetail`, `LoadDetailMeta`, `LoadStopSummary`, `LoadStop`, `LoadEndpoint`, `LoadCarrierRef`, `LoadPartyRef`, `LoadUserRef`, `LoadLtlSummary`, `LoadLtlDetail`, `LoadDispatch`, `LoadActivityEntry` and the enum unions (`LoadStatus`, `LoadBoardView`, `LoadMode`, `LoadEquipmentType`, `LoadPackaging`, `LoadLtlService`, `LoadFreightClass`, `LoadPaymentTerms`, `LoadStopKind`, `LoadStopStatus`, `LoadDispatchStatus`, `LoadActivityKind`, `LoadPayKind`, `LoadHauledBy`). `LoadDocument` comes from `documents.ts`.
- Inputs — `packages/validation/src/loads.ts`: `listLoadsQuerySchema` (`ListLoadsQuery`), `loadNumberParamSchema` (`LoadNumberParam`), `loadIdParamSchema` (`LoadIdParam`), `createLoadSchema` (`CreateLoadInput` sent / `CreateLoadBody` parsed) with `createLoadStopSchema`, `createLoadLtlSchema`, `createLoadHaulSchema`; value lists `LOAD_STATUSES`, `LOAD_ACTIVE_STATUSES`, `LOAD_BOARD_VIEWS`, `LOAD_BOARD_VIEW_STATUSES`, `LOAD_MODES`, `LOAD_EQUIPMENT_TYPES`, `LOAD_PACKAGING`, `LOAD_LTL_SERVICES`, `LOAD_FREIGHT_CLASSES`, `LOAD_PAYMENT_TERMS`, `NEW_LOAD_STOP_KINDS`, `NEW_LOAD_MAX_STOPS`; New Load helpers `NEW_LOAD_SECTIONS`, `newLoadIssueSection`.

| # | Method & path (`/api/v1`) | Permission | Screen |
|---|---|---|---|
| 1 | `GET /loads` | `loads.view` | Loads board (+ Dashboard search rows, §8.4). The Planner "Related load" list is `GET /planner/related-loads` ([planner.md §3.10](planner.md)). |
| 2 | `GET /loads/by-number/:loadNumber` | `loads.view` (+ `documents.view` for the document list) | Load detail `/app/loads/L-<n>` |
| 3 | `GET /loads/:id` | `loads.view` (+ `documents.view`) | Load detail fallback; API clients |
| 4 | `POST /loads` | `loads.create` (+ `loads.assign` with an assignment) | New Load "Create load" |
| — | `POST /loads/:id/documents`, `GET /loads/:id/documents` | `documents.upload` / `documents.view` | [documents.md](documents.md) |

Reference data New Load reads comes from other domains' endpoints (07 §6.2): `GET /customers/options`, `/carriers`, `/drivers`, `/trucks`, `/trailers`, and `GET /me` (§8.3.1).

There is no update, status, assign, cancel or delete endpoint in this release: "Update status" and "Message driver" stay inert (01 §7); the future endpoints are listed in [08 §6](../08-load-lifecycle.md) and [09 §6](../09-dispatch-lifecycle.md).

---

## 1. Shared definitions

Every value below is computed by the API per request from stored rows (D5); nothing is snapshotted. "Board load" = `loads.archived_at IS NULL`. The rules are those of 03 §6.0.3, stated here per DTO field.

| DTO field | type | computed from (columns) |
|---|---|---|
| `id` | uuid | `loads.id` |
| `loadNumber` | integer | `loads.load_number` |
| `status` | `LoadStatus` | `loads.status` |
| `customer` | `{id, name}` | `loads.customer_id` → `customers.name` |
| `reference` | string \| null | `coalesce(loads.tender_ref, loads.customer_po)` |
| `route` | string \| null | *first pickup* label + ` → ` (U+2192) + *last delivery* label; a stop's label is `coalesce(f.market_city, f.city)` + ", " + `coalesce(f.market_state, f.state)` of its facility when `facility_id` is set, else `load_stops.city` + ", " + `load_stops.state`; null when the load has no stops |
| `pickupDate` / `deliveryDate` | `YYYY-MM-DD` \| null | `appointment_date` of the first pickup / last delivery |
| `origin` / `destination` | `{facilityName, address}` \| null | first pickup / last delivery: `facility_name`; `address` = the non-null of `address_line1`, `city`, `state` joined `", "` (no postal code — Runtruck1 `fromAddr`/`toAddr`) |
| `driverName` | string \| null | live dispatch (`dispatches.status <> 'cancelled'`): `employees.first_name` + " " + `last_name` of `driver_id`, else `driver_name`; null without one |
| `unit` | string \| null | live dispatch: the non-empty of (`trucks.unit_number` or `truck_number`, `trailers.unit_number` or `trailer_number`) joined `" / "`; null when empty |
| `carrier` | `LoadCarrierRef` \| null | `loads.carrier_id` → `carriers.{id, name, mc_number, dot_number, is_own_fleet}`; null = "Not yet covered" |
| `mode` | `LoadMode` \| null | `loads.mode` |
| `equipmentType`, `commodity`, `weightLb` | | `loads.equipment_type`, `commodity`, `weight_lb` |
| `temperatureF` | number \| null | `Number(loads.temperature_f)` (numeric → number: `-10.0` → `-10`) |
| `ltl` | `LoadLtlSummary` \| null | when `mode = 'ltl'`: `{freight_class, handling_units, packaging, ltl_services}` (services in stored order); else null |
| `lineHaulCents` | integer | `loads.line_haul_cents` |
| `totalCents` | integer | revenue(l) = `line_haul_cents::bigint + fuel_surcharge_cents + accessorial_cents` (revenue, "Total to customer"; ≤ 2,147,483,647 by CHECK `loads_total_ck`, 03 §6.0.3) |
| `loadedMiles` | integer \| null | `loads.loaded_miles` |
| `ratePerMileCents` | integer \| null | `loaded_miles > 0` ? `Math.round(line_haul_cents / loaded_miles)` (half up) : null |
| `payKind` | `'carrier_cost' \| 'driver_pay'` | `carrier_rate_cents IS NOT NULL` ? `carrier_cost` : `driver_pay` |
| `payCents` | integer \| null | `coalesce(carrier_rate_cents, driver_pay_cents)` |
| `marginCents` | integer \| null | `payCents` null → null; else `totalCents − payCents − coalesce(operating_cost_cents, 0)` (may be negative) |
| `carrierRateCents` | integer \| null | `loads.carrier_rate_cents` |
| `driverInstructions` | string \| null | `loads.driver_instructions` |
| `createdActivityAt` | ISO instant \| null | `occurred_at` of the load's `load_activity` row of kind `created` (only loads entered through `POST /loads` have one) |
| `stops` | `LoadStopSummary[]` | every `load_stops` row, `ORDER BY sequence` (§2) |

*First pickup* = the `pickup` stop with the lowest `sequence`, else the lowest-sequence stop; *last delivery* = the `delivery` stop with the highest `sequence`, else the highest-sequence stop (Runtruck1 `toLoad`).

## 2. Stops

`LoadStopSummary` (list and detail):

| field | from |
|---|---|
| `id`, `sequence`, `kind`, `status` | `load_stops.*` |
| `facilityName` | `facility_name` |
| `addressLabel` | the non-null of `address_line1`, `city`, `state` joined `", "`, then `" " + postal_code` when set; null when none is set (03 §6.0.3) |
| `appointmentDate` | `appointment_date` (stop-local business day) |
| `windowOpen`, `windowClose` | `window_open`, `window_close` as `HH:MM` |
| `timezone` | `load_stops.timezone` |

`LoadStop` (detail) adds `facilityId`, `addressLine1`, `city`, `state`, `postalCode`, `plannedStart`, `plannedEnd` (`HH:MM`), `referenceNumber`, `siteContact`, `arrivedAt`, `completedAt`.

Times are wall clock in the stop's timezone and are never converted (03 §1.5).

## 3. `GET /loads` — the board

- **Permission:** `loads.view` (includes the financial fields, 07 §2.1).
- **Query:** `listLoadsQuerySchema` = `limit` (1–500, default 100), `offset` (≥ 0, default 0), `q` (≤ 200 chars, trimmed), `view` = `active | needs-pod | delivered | all` (default `all`).
- **Rows:** board loads only (archived loads never appear); `view` keeps the statuses of `LOAD_BOARD_VIEW_STATUSES[view]` (active = `needs_driver, dispatched, at_pickup, in_transit, delayed`; needs-pod = `needs_pod`; delivered = `delivered`; all = every status).
- **Order:** `loads.created_at DESC, loads.load_number DESC` (03 §1.10). Seed: L-40218, L-40219, L-40220, L-40221, L-40214, L-40212, L-40210, L-40222 (seeded `created_at` = 2026-09-03T00:00Z minus 0…7 min, 03 §7.12); every load created afterwards sorts above them, newest first — Runtruck1's `[...created, ...LOADS]`.
- **Search `q`:** case-insensitive substring match (Runtruck1 `matchesQuery`) over the **display strings** of the view-model row of §8.1.3, i.e. exactly the keys Runtruck1's row had: `id` ("L-40218"), `customer`, `route`, `pickup`, `delivery`, `driver`, `unit`, `rate`, `status` (label), `miles`, `rpm`, `pay`, `margin`, `commodity`, `weight`, `equip`, `temp`, `ref`, `from`, `fromAddr`, `to`, `toAddr`, `carrier`, `carrierMc`, `carrierDot`, and when present `mode`, `ltl`, `carrierRate`, `notes`, `createdAt`. Stops and documents are not searched. The API builds the rows with the same shared builder as the web (§10 item 1), filters, then applies `offset`/`limit`, over at most the first 5,000 rows of the view in board order (the in-memory search cap of [04 §5.1](../04-api.md); §3.3). `q` and `view` combine (the web sends neither: it filters locally, §8.1).
- **Response:** `{ data: LoadListItem[], meta: LoadListMeta }`; `meta = { total, limit, offset, summary }`, `total` = rows after `view` and `q`.

### 3.1 `meta.summary` (`LoadBoardSummary`)

Counted over **board loads**, ignoring `view`, `q`, `limit` and `offset` (Runtruck1's KPIs never change with the pill or the search).

| field | formula | seed | Runtruck1 |
|---|---|---|---|
| `undispatched` (KPI "Undispatched") | `count(*) WHERE status = 'needs_driver'` | 1 | 1 |
| `inTransit` (KPI "In transit") | `count(*) WHERE status = 'in_transit'` (`delayed` not counted) | 1 | 1 |
| `delivered` (KPI "Delivered") | `count(*) WHERE status = 'delivered'` | 2 | 2 |
| `needsPod` (KPI "Needs POD") | `count(*) WHERE status = 'needs_pod'` | 1 | 1 |
| `views.active` | `count(*) WHERE status IN active statuses` | 5 | 5 ("5 loads") |
| `views['needs-pod']` | `count(*) WHERE status = 'needs_pod'` | 1 | 1 ("1 loads") |
| `views.delivered` | `count(*) WHERE status = 'delivered'` | 2 | 2 |
| `views.all` | `count(*)` | 8 | 8 |

No value of this endpoint differs from Runtruck1 (D5): every figure is a count over stored statuses, which are Runtruck1's.

### 3.2 Seed rows (exact DTO values)

All eight: `mode` null, `ltl` null, `carrierRateCents` null, `driverInstructions` null, `createdActivityAt` null, `payKind` `driver_pay`, `totalCents` = `lineHaulCents`; `carrier` = own fleet `{name "Sunridge Freight", mcNumber "812044", dotNumber "2291176", isOwnFleet true}` except L-40221 (`null`). Stops: 1 pickup, 2 fuel, 3 delivery (§4.2).

| loadNumber | status | customer | reference | route | pickupDate | deliveryDate | driverName | unit | lineHaulCents | loadedMiles | ratePerMileCents | payCents | marginCents | equipmentType | commodity | weightLb | temperatureF |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 40218 | in_transit | Northgate Foods | PO 88-41207 | Fresno, CA → Reno, NV | 2026-09-03 | 2026-09-04 | Marcus Hale | T-114 / RF-88 | 245000 | 478 | 513 | 61200 | 121400 | reefer_53 | Frozen produce | 41200 | -10 |
| 40219 | at_pickup | Bayline Distribution | PO 55-90114 | Stockton, CA → Salt Lake City, UT | 2026-09-03 | 2026-09-05 | Dara Whitfield | T-107 / DV-51 | 318000 | 736 | 432 | 79500 | 154000 | dry_van_53 | Palletized dry goods | 38500 | null |
| 40220 | delayed | Cascade Building Supply | SO 7741 | Sacramento, CA → Boise, ID | 2026-09-02 | 2026-09-04 | Ellis Nakamura | T-121 / FB-12 | 291000 | 602 | 483 | 72800 | 138800 | flatbed_tarped | Lumber | 44000 | null |
| 40221 | needs_driver | Harbor Point Retail | PO 31-2280 | Oakland, CA → Portland, OR | 2026-09-04 | 2026-09-06 | null | null | 354000 | 632 | 560 | null | null | dry_van_53 | Consumer goods | 30100 | null |
| 40214 | needs_pod | Northgate Foods | PO 88-41190 | Bakersfield, CA → Phoenix, AZ | 2026-09-01 | 2026-09-02 | Priya Raman | T-103 / RF-27 | 198000 | 389 | 509 | 49500 | 98600 | reefer_53 | Dairy | 36800 | 34 |
| 40212 | delivered | Bayline Distribution | PO 55-89902 | Los Angeles, CA → Las Vegas, NV | 2026-08-31 | 2026-09-01 | Marcus Hale | T-114 / DV-88 | 164000 | 271 | 605 | 41000 | 84200 | dry_van_53 | Beverages | 42000 | null |
| 40210 | delivered | Sierra Ag Partners | SO 2214 | Modesto, CA → Denver, CO | 2026-08-29 | 2026-09-01 | Tobias Frey | T-118 / DV-14 | 412000 | 1142 | 361 | 103000 | 190400 | dry_van_53 | Almonds | 43500 | null |
| 40222 | dispatched | Cascade Building Supply | SO 7802 | Redding, CA → Seattle, WA | 2026-09-05 | 2026-09-06 | Ana Cortez | T-109 / FB-04 | 276000 | 578 | 478 | 69000 | 131200 | flatbed_48 | Steel coil | 46000 | null |

`origin`/`destination` = Runtruck1's `from`/`fromAddr`, `to`/`toAddr` verbatim (e.g. L-40218 `{Northgate Cold Storage, "4120 S Golden State Blvd, Fresno, CA"}` → `{Reno Grocers DC, "1855 E Greg St, Sparks, NV"}`). The route uses the facility market (Reno, Boise, Los Angeles, Las Vegas) while the address keeps the address city (03 §5.3.1).

### 3.3 Errors, tenancy, queries

- **Errors:** 400 `VALIDATION_ERROR` (bad `view`, `limit` > 500, negative `offset`, `q` > 200) · 401 `UNAUTHORIZED` · 403 `FORBIDDEN`.
- **Tenancy:** every statement filters `organization_id = ctx.organizationId`; child rows are fetched by `(organization_id, load_id = ANY($ids))`, so a foreign row can never join in (and the composite FKs forbid one existing).
- **Queries (constant, no N+1):**
  1. Page: `loads l JOIN customers c ON (c.organization_id, c.id) = (l.organization_id, l.customer_id) LEFT JOIN carriers k ON … LEFT JOIN LATERAL (SELECT occurred_at FROM load_activity a WHERE a.organization_id = l.organization_id AND a.load_id = l.id AND a.kind = 'created' ORDER BY a.sequence LIMIT 1) ca ON true WHERE l.organization_id = $org AND l.archived_at IS NULL AND l.status = ANY($statuses) ORDER BY l.created_at DESC, l.load_number DESC LIMIT $limit OFFSET $offset`, with `count(*) OVER ()` for `total` (index `loads_org_board_idx`).
  2. Stops of the page: `load_stops s LEFT JOIN facilities f ON (f.organization_id, f.id) = (s.organization_id, s.facility_id) WHERE s.organization_id = $org AND s.load_id = ANY($ids) ORDER BY s.load_id, s.sequence` (index `load_stops_load_sequence_uq`).
  3. Live dispatches of the page: `dispatches d LEFT JOIN drivers dr … LEFT JOIN employees e … LEFT JOIN trucks t … LEFT JOIN trailers tr … WHERE d.organization_id = $org AND d.load_id = ANY($ids) AND d.status <> 'cancelled'` (index `dispatches_org_load_active_uq`).
  4. Summary: `SELECT status, count(*) FROM loads WHERE organization_id = $org AND archived_at IS NULL GROUP BY status` (index `loads_org_status_idx`).
  Without `q`, `LIMIT`/`OFFSET` are applied in SQL (query 1) and queries 2–3 read only the page's loads. With `q` (API clients only; the web never sends it) the service follows [04 §5.1](../04-api.md): query 1 runs with `LIMIT 5000` and no offset (the scan cap), queries 2–3 read those loads, the view-model rows are matched in memory and the matches are sliced by `offset`/`limit`; `total` counts matches inside the scanned rows, and board loads beyond the newest 5,000 of the view are not searched. A search column is not introduced (03 §1.11).
  **The board is not bounded in this release.** Nothing archives a load ([08 §6](../08-load-lifecycle.md)), so every created load stays on the board. The web's single page (`limit=500`, 01 §3) then covers only the newest 500 board loads: pills, search and the card title count those rows, while the KPIs (`meta.summary`) count every board load. Unreachable with the seed (8 board loads); tracked as decision L13 until an archive rule exists.

## 4. Load detail — `GET /loads/by-number/:loadNumber` and `GET /loads/:id`

- **Permission:** `loads.view`. The `documents` list is filled only when the caller also holds `documents.view`; otherwise it is `null` (07 §8 item 1). Activity is part of `loads.view` ("View loads, stops and load activity").
- **Params:** `loadNumberParamSchema` — `loadNumber` is the integer (`40218`, not `L-40218`; digits only, 1–2147483647) — or `loadIdParamSchema` (`id` uuid).
- **Resolution:** `(organization_id = ctx.organizationId, load_number)` / `(organization_id, id)`. **Board and archived loads both resolve** (`archivedAt` says which). Unknown number or id, or one of another organization: 404 `LOAD_NOT_FOUND` ("Load was not found."). This answers 01 §6 C8 on the API side; the Runtruck1 fallback to the first board load is done by the web (§8.2.1, D6).
- **Response:** `{ data: LoadDetail, meta: {} }` (`LoadDetailMeta`).

### 4.1 `LoadDetail` fields beyond `LoadListItem`

| field | from |
|---|---|
| `billToCustomer` | `bill_to_customer_id` → `customers.{id, name}`; null = same as customer |
| `tenderRef`, `customerPo`, `dispatcherName` | columns |
| `pieces`, `packaging`, `declaredValueCents`, `hazmat`, `unNumber` | columns |
| `ltl` | `LoadLtlDetail`: the summary plus `nmfc`, `length_in`, `width_in`, `height_in`, `stackable` |
| `carrierContactName`, `carrierPhone` | columns |
| `fuelSurchargeCents`, `accessorialCents`, `emptyMiles`, `driverPayCents`, `operatingCostCents` | columns |
| `paymentTerms` | `loads.payment_terms` |
| `internalNotes` | column |
| `archivedAt`, `createdAt` | `loads.archived_at`, `loads.created_at` |
| `createdBy` | `created_by_user_id` → `users.{id, full_name}`; null for seeded loads |
| `dispatch` | the live dispatch (`LoadDispatch`) or null: ids, `driverName` (employee name or free text), `truckUnit`/`trailerUnit` (unit number or free text), `status`, `assignedAt`, `assignedBy` |
| `stops` | `LoadStop[]` by `sequence` |
| `documents` | `LoadDocument[]` by `position` ([documents.md §1](documents.md)) or null |
| `activity` | `load_activity` rows by `sequence`: `{id, sequence, occurredAt, kind, message, actor}` (`actor_user_id` → `users.full_name`) |

### 4.2 Seed (detail values; identical to Runtruck1 except the D7 time line)

- Stops of every board load: (1) pickup — status `completed` except L-40219 `arrived`; window 08:00–14:00; (2) fuel — `pending`, `facilityName` "Planned · 92 gal, DEF top-off", `addressLabel` "Routed automatically on the lane", `appointmentDate` = the pickup date, `windowOpen` "16:40", `windowClose` null; (3) delivery — `completed` on L-40212 and L-40210, else `pending`; window 06:00–12:00.
- Documents: 3 slots (rate confirmation attached on all; bill of lading attached on L-40214, L-40212, L-40210; POD attached on L-40212, L-40210) — [documents.md §2](documents.md).
- Activity: 4 rows, `actor` null — 2026-09-03T14:12Z `driver_accepted` "Driver accepted the load in the app"; 15:41Z `arrived` "Arrived at {pickup facility}"; 17:05Z `document_uploaded` "Bill of lading uploaded from the cab"; 17:06Z `invoice_queued` "Invoice queued for billing" (L-40212, L-40210) or `consignee_notified` "Dispatch notified the consignee" (the others).
- Archived example: `GET /loads/by-number/40209` → L-40209, `delivered`, `archivedAt` 2026-09-03T07:00:00Z, route "Fresno, CA → Reno, NV", no carrier, no dispatch, `equipmentType`/`commodity`/`weightLb` null, 2 completed stops, 1 POD slot (attached), no activity. `GET /loads/by-number/40198` → no stops, `route` null.

### 4.3 Errors and queries

- **Errors:** 400 `VALIDATION_ERROR` (malformed number or uuid) · 401 · 403 `FORBIDDEN` (no `loads.view`) · 404 `LOAD_NOT_FOUND`.
- **Queries (five, constant):** (1) the load with customer, bill-to, carrier, creator (`users`) and the `created` activity instant; (2) stops + facilities; (3) the live dispatch + driver/employee/truck/trailer + assigner; (4) documents with current version, version count and uploader (only with `documents.view`, [documents.md §2](documents.md)); (5) activity + actor names. All filter `organization_id = ctx.organizationId`.

## 5. Activity (read only)

`load_activity` rows are written by `POST /loads` (§6.4) and by the seed; the message text is stored with the row (03 §5.6.4). This release writes only kinds `created` ("Load created by {creator full name}") and `driver_instructions` ("Driver instructions: {driver_instructions}"). Uploading a document writes none ([13 §5](../13-document-system.md)).

## 6. `POST /loads` — New Load

- **Permission:** `loads.create`; additionally `loads.assign` when the body sets a driver, truck or trailer (own fleet) or is hauled by a partner carrier (07 §8 item 2, [09 §3.1](../09-dispatch-lifecycle.md) E1). Checked in the service with `hasPermissions`; 403 `FORBIDDEN` otherwise.
- **Body:** `createLoadSchema` (`CreateLoadInput`), JSON. The organization, creator, load number, status, carrier of an own-fleet load and every total are **never** read from the body.
- **Response:** `201 { data: LoadDetail, meta: {} }` — the created load read back as in §4 (documents all `pending`; the web then uploads files, [documents.md §5.2](documents.md)).

### 6.1 Body (`CreateLoadInput`)

| field | type | Runtruck1 draft field | notes |
|---|---|---|---|
| `customerId` | uuid \| null | `customer` | rule "Customer" |
| `billToCustomerId` | uuid \| null | `billTo` | null = "Same as customer" |
| `tenderRef`, `customerPo` | string ≤ 100 \| null | `ref`, `po` | |
| `mode` | `ftl \| ltl \| partial` | `mode` | |
| `equipmentType` | `LoadEquipmentType` \| null | `equipment` | rule "Equipment" |
| `dispatcherName` | string ≤ 120 \| null | `dispatcher` | |
| `stops[]` (≤ 50) | `CreateLoadStopInput` | `stops` | running order |
| `stops[].kind` | `pickup \| delivery` | `kind` | |
| `stops[].facilityName` | string ≤ 200 \| null | `facility` | rule `Stop n: facility` |
| `stops[].addressLine1`, `city` | string ≤ 200 / ≤ 100 \| null | `address`, `city` | rule `Stop n: street, city and state` |
| `stops[].state` | string ≤ 2 \| null (upper-cased) | `state` | same rule |
| `stops[].postalCode` | string ≤ 20 \| null | `zip` | |
| `stops[].appointmentDate` | `YYYY-MM-DD` (real date) \| null | `date` | rules `Stop n: date`, `Stop n: date is before stop n-1` |
| `stops[].windowOpen`, `windowClose` | `HH:MM` \| null | `from`, `to` | not ordered (Runtruck1 did not check) |
| `stops[].referenceNumber` | string ≤ 100 \| null | `number` ("Pickup #"/"Delivery #") | |
| `stops[].siteContact` | string ≤ 200 \| null | `contact` | |
| `commodity` | string ≤ 200 \| null | `commodity` | rule "Commodity" |
| `weightLb` | integer 0–1,000,000 \| null | `weight` | rule "Weight" (> 0) |
| `pieces` | integer ≥ 0 \| null | `pieces` | |
| `packaging` | `LoadPackaging` (default `pallets`) | `packaging` | |
| `declaredValueCents` | cents \| null | `value` | |
| `temperatureF` | number −999.9…999.9 \| null | `temp` | only with `reefer_53` |
| `hazmat` | boolean | `hazmat` | |
| `unNumber` | string ≤ 20 \| null | `unNumber` | rule "UN number for hazmat"; only with `hazmat` |
| `ltl` | `CreateLoadLtlInput` \| null | LTL page | only with `mode = 'ltl'` |
| `ltl.freightClass` | `LoadFreightClass` \| null | `freightClass` | rule "Freight class" |
| `ltl.nmfc` | string ≤ 50 \| null | `nmfc` | |
| `ltl.handlingUnits` | integer ≥ 0 \| null | `handlingUnits` | rule "Handling units" (> 0) |
| `ltl.lengthIn`, `widthIn`, `heightIn` | integer ≥ 0 \| null | `length`, `width`, `height` | |
| `ltl.stackable` | boolean | `stackable` | |
| `ltl.services` | `LoadLtlService[]`, unique, click order | `services` | |
| `haul` | discriminated on `hauledBy` | `brokered` | |
| `haul` (`own_fleet`) | `{driverId, truckId, trailerId: uuid \| null, driverPayCents: cents \| null}` | `driver`, `truck`, `trailer`, `driverPay` | driver pay 0 = none |
| `haul` (`partner_carrier`) | `{carrierId: uuid \| null, carrierRateCents: cents \| null, carrierContactName ≤ 120, carrierPhone ≤ 40, driverName ≤ 120, truckNumber ≤ 40, trailerNumber ≤ 40}` | `carrier`, `carrierRate`, `carrierContact`, `carrierPhone`, `driver`, `truck`, `trailer` | rules "Carrier", "Carrier rate" |
| `lineHaulCents` | cents (default 0) | `lineHaul` | rule "Line haul rate" (> 0) |
| `fuelSurchargeCents`, `accessorialCents` | cents (default 0) | `fuel`, `accessorials` | |
| `loadedMiles` | integer 0–100,000 \| null | `miles` | |
| `paymentTerms` | `LoadPaymentTerms` | `terms` | |
| `driverInstructions` | string ≤ 4000 \| null | `instructions` | |
| `internalNotes` | string ≤ 4000 \| null | `internal` | |

Every free-text value is trimmed; an empty string becomes null. Money is integer cents ≥ 0 and ≤ 2,147,483,647, and so is the total to customer `lineHaulCents + fuelSurchargeCents + accessorialCents` (issue at `lineHaulCents` "Total to customer is too large.", CHECK `loads_total_ck`); quantities are whole numbers ≥ 0. Every field Runtruck1 collected and dropped (bill to, PO, dispatcher, terms, fuel and accessorials as amounts, pieces, packaging, declared value, hazmat, UN number, NMFC, dimensions, stackable, carrier contact and phone, stop number and contact, internal notes, and the files) is persisted (Rule 1).

### 6.2 Validation (one schema for the web and the API)

`createLoadSchema` has two layers:

1. **Shape** (format and bounds): types, uuids, enums, real calendar dates, `HH:MM`, lengths, integer cents ≥ 0, the upper bounds above, `stops.length ≤ 50`, unique services. Messages name the field, e.g. "Fuel surcharge can't be negative.", "Facility is too long (at most 200 characters)."
2. **Runtruck1's rules** (NewLoadDialog.tsx `validate()`), in its order and with its exact messages, as issues at these paths:

| # | condition (after trimming) | path | message | New Load section |
|---|---|---|---|---|
| 1 | `customerId` null | `customerId` | Customer | Load info |
| 2 | `equipmentType` null | `equipmentType` | Equipment | Load info |
| 3 | no stop of kind pickup | `stops` | At least one pickup | Stops |
| 4 | no stop of kind delivery | `stops` | At least one delivery | Stops |
| 5 | per stop *i* (n = i+1): `facilityName` null | `stops.i.facilityName` | Stop n: facility | Stops |
| 6 | `addressLine1`, `city` or `state` null | `stops.i.address` | Stop n: street, city and state | Stops |
| 7 | `appointmentDate` null | `stops.i.appointmentDate` | Stop n: date | Stops |
| 8 | both dates set and this date < the **previous stop's** (only the adjacent one, as Runtruck1) | `stops.i.appointmentDate` | Stop n: date is before stop i | Stops |
| 9 | `commodity` null | `commodity` | Commodity | Freight |
| 10 | `weightLb` null or ≤ 0 | `weightLb` | Weight | Freight |
| 11 | `hazmat` and `unNumber` null | `unNumber` | UN number for hazmat | Freight |
| 12 | `mode = 'ltl'` and `ltl.freightClass` null | `ltl.freightClass` | Freight class | LTL |
| 13 | `mode = 'ltl'` and `ltl.handlingUnits` null or ≤ 0 | `ltl.handlingUnits` | Handling units | LTL |
| 14 | partner carrier and `carrierId` null | `haul.carrierId` | Carrier | Carrier |
| 15 | partner carrier and `carrierRateCents` null or ≤ 0 | `haul.carrierRateCents` | Carrier rate | Carrier |
| 16 | `lineHaulCents` ≤ 0 | `lineHaulCents` | Line haul rate | Rates |

   Then one bound Runtruck1 lacked: the total to customer must fit an `integer` (`lineHaulCents + fuelSurchargeCents + accessorialCents` > 2,147,483,647 → issue at `lineHaulCents` "Total to customer is too large."), so no revenue sum can overflow (03 §6.0.3). Then three consistency rules for fields Runtruck1 hides (the web never sends them): `ltl` set while `mode ≠ 'ltl'` ("LTL details apply only to LTL loads."), `unNumber` without `hazmat` ("A UN number is recorded only for hazmat loads."), `temperatureF` with non-reefer equipment ("A temperature is recorded only for reefer equipment.").

   Rules run whenever the shape layer produced no type error (Zod 4 skips refinements only after aborting issues), so a draft with a negative fuel surcharge still lists every Runtruck1 rule. A fresh draft yields exactly Runtruck1's 11 issues: Customer, Equipment; Stop 1: facility, Stop 1: street, city and state, Stop 1: date, the same three for Stop 2; Commodity, Weight; Line haul rate.

`newLoadIssueSection(path)` maps a dotted issue path to its New Load section (table above; `haul.driverId|truckId|trailerId|driverName|truckNumber|trailerNumber` → "Driver & equipment", `haul.driverPayCents` → "Rates", other `haul.*` → "Carrier", unknown → "Review").

What is **not** validated, as in Runtruck1 (D6): ZIP and phone formats, the state's letters, window open vs close, stop dates in the past, driver/truck/trailer availability ([09 §3.2](../09-dispatch-lifecycle.md)).

### 6.3 Server-side checks after the schema (in this order)

| # | check | failure |
|---|---|---|
| S1 | `loads.assign` when the body assigns (§6 permission) | 403 `FORBIDDEN` |
| S2 | `customerId` and `billToCustomerId` are customers of the organization | 400 `VALIDATION_ERROR`, issue `customerId` / `billToCustomerId` "Customer was not found." |
| S3 | own fleet: `driverId`, `truckId`, `trailerId` exist in the organization; the driver's employee is `active` | 400, issue `haul.driverId` "Driver was not found." / "This driver is not active.", `haul.truckId` "Truck was not found.", `haul.trailerId` "Trailer was not found." |
| S4 | partner: `carrierId` is a carrier of the organization with `is_own_fleet = false` | 400, issue `haul.carrierId` "Carrier was not found." / "Choose a partner carrier." |

Unknown and other-organization ids get the same answer (tenancy is not revealed). Path ids answer 404; body references answer 400 with an issue so the web can place it in its section.

### 6.4 What is written (one transaction)

1. **Number:** `INSERT INTO organization_counters (organization_id, key, next_value) VALUES ($org, 'load', 2) ON CONFLICT (organization_id, key) DO UPDATE SET next_value = organization_counters.next_value + 1, updated_at = now() RETURNING next_value - 1` (03 §1.9; a new organization starts at 1; the seed's counter makes the first one **40223**). The row lock serialises concurrent creates; `loads_org_number_uq` is the backstop (409 `LOAD_NUMBER_CONFLICT`, not expected).
2. **`loads`:** every body field of §6.1 in its column; `organization_id` = `ctx.organizationId`; `created_by_user_id` = `ctx.userId`; `created_at` = database `now()` (orders the board); `status` per [08 §4](../08-load-lifecycle.md) (`dispatched` when hauled by a partner or an own driver is chosen, else `needs_driver`); `carrier_id` = the partner, or the organization's own-fleet carrier for own fleet (null if the organization has none); `driver_pay_cents` = own-fleet pay (0 → null) and `carrier_rate_cents` = partner rate — never both; `ltl_services` in the order sent; `archived_at`, `empty_miles`, `operating_cost_cents` null.
3. **`load_stops`:** one row per body stop, `sequence` = index + 1, `status` `pending`, `facility_id` null, `facility_name` and address as sent (trimmed, state upper-cased), `timezone` = the organization's timezone (no facility), planned slot null (the planner then uses the window when both ends are set, else 08:00–09:00, 03 §6.4).
4. **`dispatches`:** per [09 §4](../09-dispatch-lifecycle.md) — own fleet with any of driver/truck/trailer, or partner with any of driver name/truck #/trailer #; `status` `assigned`, `assigned_at` = `ClockService.now(org tz)`, `assigned_by_user_id` = `ctx.userId`.
5. **`documents`:** five `pending` slots, positions 1–5 in `LOAD_DOCUMENT_TYPES` order (03 §5.7.1).
6. **`load_activity`:** sequence 1 `created` "Load created by {creator full name}"; sequence 2 `driver_instructions` "Driver instructions: {driver_instructions}" when set; both `occurred_at` = `ClockService.now(org tz)`, `actor_user_id` = `ctx.userId`.
7. **Audit** (`AuditService.record`, `entity_type` `load`, `entity_label` `L-<n>`): `LOAD_CREATED` `next: {loadNumber, status, customerId, billToCustomerId, carrierId, lineHaulCents, fuelSurchargeCents, accessorialCents, stopCount}`; plus `LOAD_ASSIGNED` when S1 applied ([09 §4](../09-dispatch-lifecycle.md)).
8. **Events** (`EventsService.emit`): `LoadCreated` `{loadId, loadNumber, status}`; `LoadAssigned` `{loadId, dispatchId, carrierId, driverId, truckId, trailerId}` when S1 applied; `LoadDispatched` `{loadId, loadNumber}` when the status is `dispatched`.

### 6.5 Errors

| HTTP | code | when |
|---|---|---|
| 400 | `VALIDATION_ERROR` + `issues` | §6.2 shape or rules; §6.3 S2–S4 |
| 401 | `UNAUTHORIZED` | no session |
| 403 | `FORBIDDEN` / `CROSS_ORIGIN_REJECTED` | no `loads.create`; S1; cross-site write |
| 409 | `LOAD_NUMBER_CONFLICT` | the uniqueness backstop fired |
| 500 | `INTERNAL_ERROR` | anything else (logged with the request id) |

No idempotency key in this release: the web ignores repeated "Create load" clicks while the request is pending (§8.3.4).

### 6.6 Worked examples (Runtruck1 new-load §9) — expected results

**A — own fleet, FTL, reefer.** Body: Northgate Foods, `mode` ftl, `reefer_53`; stops pickup "Northgate Cold Storage", "4120 S Golden State Blvd", "Fresno", "ca", "93725", 2026-09-05, 08:00–12:00, and delivery "Reno Grocers DC", "1855 E Greg St", "Sparks", "NV", "89431", 2026-09-06, open 06:00; commodity "Frozen produce", 41200 lb, −10 °F; own fleet Priya Raman, T-103, RF-09, driver pay 61200; line haul 245000, fuel 18000, accessorials 7500, 478 mi; terms net_30; instructions "Check in at gate 3".
Result: `loadNumber` 40223, `status` dispatched, `route` "Fresno, CA → Sparks, NV", `pickupDate` 2026-09-05, `deliveryDate` 2026-09-06, `driverName` "Priya Raman", `unit` "T-103 / RF-09", `carrier` own fleet, `totalCents` 270500, `ratePerMileCents` 513, `payKind` driver_pay, `payCents` 61200, `marginCents` 209300, `reference` null, stops `addressLabel` "4120 S Golden State Blvd, Fresno, CA 93725" / "1855 E Greg St, Sparks, NV 89431", 5 pending slots, activity "Load created by Rosa Medina", "Driver instructions: Check in at gate 3". Displayed: "478", "$2,450" with "$5.13 / mi", Driver pay "$612", Margin "$2,093"; stop lines "Sep 5 · 08:00–12:00", "Sep 6 · 06:00".

**B — partner carrier, LTL, negative margin.** Body: Bayline Distribution, `tenderRef` "PO 55-90200", ltl, `dry_van_53`; pickup Bayline DC 4 (no ZIP, 2026-09-04, no window), delivery Wasatch Crossdock (84104, 2026-09-06, close 14:00); 6200 lb; `ltl` `{freightClass '70', handlingUnits 4, services [liftgate_delivery, delivery_appointment]}` (packaging pallets); partner Valley Line Transport, carrier rate 150000; line haul 120000, fuel 10000, no miles.
Result: `status` dispatched (partner, no driver), `driverName` null, `unit` null, `ratePerMileCents` null, `payKind` carrier_cost, `payCents` 150000, `marginCents` −20000, `carrierRateCents` 150000. Displayed: miles "—", Line haul "$1,200" without note, Carrier cost "$1,500", Margin "-$200", Carrier rate "$1,500", LTL "Class 70 · 4 pallets · Liftgate at delivery · Delivery appointment", stop lines "Sep 4 · Any time", "Sep 6 · 14:00".

### 6.7 Tenancy

The organization comes only from the session; every reference is resolved inside `ctx.organizationId` (§6.3); every inserted row carries it; the composite foreign keys (03 §1.3) make a cross-tenant stop, dispatch, document or reference impossible even if the service were wrong. The load number is per organization.

## 7. D5 / D6 / D7 summary for this domain

- **D5:** no figure differs from Runtruck1. Board KPIs, pill counts, every row, rpm, pay and margin reproduce Runtruck1 exactly from the seed (§3.2; margins through the stored `operating_cost_cents`, 03 §6.0.2).
- **D7:** the one accepted visual difference — on the eight seeded loads' detail pages the pickup/delivery time line reads "Sep 3 · 08:00–14:00" instead of "Pickup Sep 3 · 08:00–14:00" (and "Sep 4 · 06:00–12:00" instead of "Deliver Sep 4 · 06:00–12:00").
- **D6 quirks kept:** "1 loads"; KPIs ignore the pill and the search; search spans all board loads; unknown numbers fall back to the first board load; stop labels "Pickup · complete" on L-40221/L-40222 and "Delivery" on L-40214 (seeded stop statuses, C7); an uncovered created load shows the own fleet; Review's positional route; Bill to that keeps the first customer; terms overwritten on every customer change; LTL services in click order; no availability checks.
- **Differences only for inputs Runtruck1 mishandled** (§9 L4–L6): negative or sub-cent amounts, fractional weights, oversized text.

## 8. Web mapping

Formatters are from `@runtruck/calculations`; label and tone maps are the web's (proposed shared home: §10 item 1). "—" is U+2014.

### 8.1 Loads board — `/app/loads`

#### 8.1.1 Calls

- `GET /loads?view=all&limit=500` once per mount (one bounded page, 01 §3), board order. The pills and the top-bar search filter these rows **locally** (Runtruck1 `listFor` + `matchesQuery`), so switching pills and typing are instant and search spans every board load regardless of the pill.
- Initial data is fetched on the server (RSC) or the first row's `openId` is set once when the data first arrives, so the first row is expanded on arrival (core-pages §11 hazard 5).
- After `POST /loads` and after uploads, the `GET /loads` query is invalidated (gaps §2.5: Back must list the new load).

#### 8.1.2 Screen values

| element | Runtruck1 | from |
|---|---|---|
| KPI Undispatched / In transit / Delivered / Needs POD | `countOf(...)` | `String(meta.summary.undispatched / inTransit / delivered / needsPod)` |
| Pills | `listFor(loads, tab)` | rows filtered by `LOAD_BOARD_VIEW_STATUSES` (`Active` → active, `Needs POD` → needs-pod, `Delivered` → delivered, `All` → all) |
| Card title | `` `${rows.length} loads` `` / `` `${rows.length} matching “${query}”` `` | same, over the local rows |
| Load # | `l.id` | `formatLoadNumber(loadNumber)` |
| Tender # | `l.ref` | `reference ?? '—'` |
| Truck | `unassigned ? 'Unassigned' (muted) : unit` | `unit ?? '—'`, then Runtruck1's `unit === '—'` test |
| Route | `l.route` | `route ?? '—'` |
| Pickup | `l.pickup` | `formatShortDate(pickupDate)` ("Sep 3") |
| Driver | `l.driver` | `driverName ?? 'Unassigned'` |
| Rate | `l.rate` | `formatMoney(lineHaulCents)` ("$2,450") |
| Status chip | `Tag label={status}` | `LOAD_STATUS_LABEL[status]`, tone `LOAD_STATUS_TONE[status]` (needs_driver amber, dispatched gray, at_pickup gray, in_transit blue, delayed amber, needs_pod amber, delivered gray) |
| Expand "Stops (n)" | `stopsOf(l)` | `stops.filter(s => s.kind !== 'fuel')`; n = that length |
| Stop kind line | `` `${kind} · Stop ${i+1}` `` class pickup/delivery | `` `${kind === 'pickup' ? 'Pickup' : 'Delivery'} · Stop ${i + 1}` ``, class `pickup`/`delivery` |
| Stop name / address | `name`, `address` | `facilityName`, `addressLabel ?? ''` |
| Stop time | `when` | `` `${formatShortDate(appointmentDate)} · ${stopWindow(s)}` `` where `stopWindow` = `open–close` (U+2013) when both, else the one set, else "Any time" |
| System load # / Tender # / Commodity / Weight / Equipment / Rate | fields | view-model `id`, `ref`, `commodity`, `weight`, `equip`, `rate` (§8.1.3) |
| Customer column | `customer`, `` `${temp} · ${equip}` `` | `customer.name`, view-model `temp`, `equip` |
| Open load → | `/app/loads/{id}` | `/app/loads/${formatLoadNumber(loadNumber)}` |
| Truck & driver | Truck (Unassigned when '—'), Driver | as the table |
| Carrier Name / MC · DOT | `carrier`, `` `${carrierMc} · ${carrierDot}` `` | view-model `carrier`, `carrierMc`, `carrierDot` |

Seed result: identical to Runtruck1 (core-pages §3.1–§3.2): Active "5 loads" (L-40218, -19, -20, -21, -22), Needs POD "1 loads", Delivered "2 loads", All "8 loads"; KPIs 1 / 1 / 2 / 1; first row expanded.

#### 8.1.3 View-model row (search parity)

One row per `LoadListItem`, with **exactly Runtruck1's `Load` keys and strings**; `matchesQuery` (apps/web `lib/search.ts`) runs over it. It holds no uuid or other string key Runtruck1 lacked (a uuid would make ids searchable); the DTO rides along under a non-string key.

| key | value |
|---|---|
| `id` | `formatLoadNumber(loadNumber)` |
| `customer` | `customer.name` |
| `route` | `route ?? '—'` |
| `pickup` / `delivery` | `pickupDate` / `deliveryDate` → `formatShortDate`, or '—' |
| `driver` | `driverName ?? 'Unassigned'` |
| `unit` | `unit ?? '—'` |
| `rate` | `formatMoney(lineHaulCents)` |
| `status` | `LOAD_STATUS_LABEL[status]` |
| `tone` | `LOAD_STATUS_TONE[status]` (skipped by `matchesQuery`, like `tagClass`) |
| `miles` | `loadedMiles !== null && loadedMiles > 0 ? formatInt(loadedMiles) : '—'` |
| `rpm` | `formatRatePerMile(ratePerMileCents)` ("$5.13" or '—') |
| `pay` | `formatMoneyOrDash(payCents)` |
| `margin` | `formatMoneyOrDash(marginCents)` ("-$200" when negative) |
| `commodity` | `commodity ?? '—'` |
| `weight` | `formatInt(weightLb) + ' lb'` ("41,200 lb"); '—' when `weightLb` is null |
| `equip` | `LOAD_EQUIPMENT_LABEL[equipmentType]` or '—' |
| `temp` | `equipmentType === 'reefer_53'` ? (`temperatureF !== null` ? `` `${temperatureF} °F` `` : 'Set at pickup') : 'Ambient' |
| `ref` | `reference ?? '—'` |
| `from` / `fromAddr` | `origin.facilityName` / `origin.address` ('' when null) |
| `to` / `toAddr` | `destination.facilityName` / `destination.address` |
| `carrier` | `carrier === null ? 'Not yet covered' : carrier.name + (carrier.isOwnFleet ? ' (own fleet)' : '')` |
| `carrierMc` / `carrierDot` | `carrier?.mcNumber` → `` `MC ${n}` `` / `dotNumber` → `` `DOT ${n}` ``, else '—' |
| `mode` *(only when `mode !== null`)* | `LOAD_MODE_LABEL[mode]` ("Full truckload", "Less than truckload", "Partial") |
| `ltl` *(only when `ltl !== null`)* | the parts `'Class ' + freightClass`, `handlingUnits + ' ' + LOAD_PACKAGING_LABEL[packaging].toLowerCase()`, then `LOAD_LTL_SERVICE_LABEL[service]` for each service in order, joined `' · '` ("Class 70 · 4 pallets · Liftgate at delivery · Delivery appointment") |
| `carrierRate` *(only when `carrierRateCents !== null`)* | `formatMoney(carrierRateCents)` |
| `notes` *(only when `driverInstructions !== null`)* | `driverInstructions` |
| `createdAt` *(only when `createdActivityAt !== null`)* | `formatActivityTime(createdActivityAt, me.organization.timezone, me.today)` ("Today 14:05") |
| `stops` | array (not searched) |

Checks against the seed (gaps §5 #29): "sunridge" matches 7 of 8 loads; "PO 88" matches L-40218 and L-40214; "today" matches only loads created with New Load.

### 8.2 Load detail — `/app/loads/:loadNumber`

#### 8.2.1 Calls and the D6 fallback

1. Parse the URL segment: `n = parseLoadNumber(param)`; it counts only if `formatLoadNumber(n) === param` (case- and format-exact, as Runtruck1's `l.id === id`: `l-40218` and `L-040218` fall back).
2. If it counts: `GET /loads/by-number/${n}`.
3. If it did not count, or the answer is 404 `LOAD_NOT_FOUND`, or `data.archivedAt !== null`: show the **first board load** (Runtruck1 `loads[0]`): `GET /loads?view=all&limit=1`, then `GET /loads/${rows[0].id}`. The URL is left as typed. If the board is empty, the page renders nothing inside `.ui-main` (Runtruck1 would crash; 01 §6 C1).
4. A 403 is shown as the app's standard refusal (not a fallback).

#### 8.2.2 Screen values

| element | Runtruck1 | from `LoadDetail` |
|---|---|---|
| h2 | `sel.route` | `route ?? '—'` |
| Subline | `Load {id} · {customer} · {status}` | `` `Load ${formatLoadNumber(loadNumber)} · ${customer.name} · ${LOAD_STATUS_LABEL[status]}` `` |
| KPI Miles | `sel.miles` | view-model `miles` |
| KPI Line haul (+ note) | `sel.rate`, note `` `${rpm} / mi` `` unless '—' | `formatMoney(lineHaulCents)`; note `` `${formatRatePerMile(ratePerMileCents)} / mi` `` only when `ratePerMileCents !== null` |
| KPI 3 label / value | `carrierRate ? 'Carrier cost' : 'Driver pay'`, `sel.pay` | `payKind === 'carrier_cost' ? 'Carrier cost' : 'Driver pay'`, `formatMoneyOrDash(payCents)` |
| KPI Margin | `sel.margin` | `formatMoneyOrDash(marginCents)` |
| Freight & pay | Mode (if set), Commodity, Weight, Equipment, Temperature, Reference, LTL (if set) | `mode` label only when `mode !== null`; view-model `commodity`, `weight`, `equip`, `temp`, `ref`; `ltl` string only when `ltl !== null` |
| Carrier | Carrier, MC #, DOT #, Carrier rate (if set) | view-model `carrier`, `carrierMc`, `carrierDot`; "Carrier rate" `formatMoney(carrierRateCents)` only when not null |
| Stops | every stop | `stops` by `sequence`: kind label (below), class `pickup`/`delivery`/none, `facilityName`, `addressLabel ?? ''`, time line `` `${formatShortDate(appointmentDate)} · ${stopWindow(s)}` `` |
| Stop kind label | literal per branch | 03 §6.0.5: pickup `pending` "Pickup", `arrived` "Pickup · at shipper", `completed` "Pickup · complete"; delivery `completed` "Delivery · complete", else "Delivery"; fuel "Fuel stop" (no class) |
| Placeholder | "Live map / ELD trace" | static |
| Documents | name + Attached/Pending chip | [documents.md §5.1](documents.md); card hidden when `documents === null` |
| Activity | `when`, `what` | `formatActivityTime(occurredAt, me.organization.timezone, me.today)`, `message` |

Seed result: identical to Runtruck1's per-load matrix (core-pages §4.3), except the D7 time line (§7). New loads render exactly as Runtruck1's created-load branch (worked examples, §6.6).

The top bar ("← Loads", inert "Message driver", inert "Update status") belongs to the shell; nothing here calls the API.

### 8.3 New Load dialog (opened from "+ New Load" on Dashboard and Loads)

#### 8.3.1 Reads (other domains; 07 §6.2)

| dropdown / text | call | fields used | order | display |
|---|---|---|---|---|
| Customer, Bill to | `GET /customers/options?limit=500` ([customers.md §2.8](customers.md); no YTD or AR aggregates are computed for a select list) | `CustomerOption.id`, `.name`, `.paymentTerms` | `customers.position` | option text `name`; Customer change sets `billTo` only if empty and `terms` to the customer's terms (Runtruck1 quirks kept) |
| Partner carrier; own-fleet note; Review "Carrier" | `GET /carriers?limit=500` | `CarrierListItem.id`, `.name`, `.mcNumber`, `.dotNumber`, `.isOwnFleet` | `carriers.position` | partners (`!isOwnFleet`): `` `${name} · MC ${mcNumber}` ``; note: `` `${own.name} (own fleet) · MC ${own.mcNumber} · DOT ${own.dotNumber}. Assign the driver, truck and trailer in Driver & equipment.` `` |
| Driver (own fleet) | `GET /drivers?limit=500` | `DriverListItem.id`, `.fullName`, `.dutyStatus`, `.truck?.id` | `drivers.position` | `` `${fullName} · ${DUTY_LABEL[dutyStatus]}` `` ("Marcus Hale · On duty"); choosing one sets `truck = prev.truck \|\| driver's truck id` |
| Truck | `GET /trucks?limit=500` | `TruckListItem.id`, `.unitNumber`, `.status` | `unit_number` | `` `${unitNumber} · ${TRUCK_STATUS_LABEL[status]}` `` ("T-114 · Service due") |
| Trailer | `GET /trailers?limit=500` | `TrailerListItem.id`, `.unitNumber`, `.trailerType`, `.lengthFt` | `trailers.position` | `` `${unitNumber} · ${TRAILER_TYPE_LABEL[trailerType]} · ${lengthFt} ft` `` ("RF-27 · Reefer · 53 ft") |
| Dispatcher default | `GET /me` (session, `MeResponse`) | `user.fullName` | | "Rosa Medina" |
| Carrier help "Haul it with the Sunridge fleet…" | `GET /me` | `organization.shortName` | | "Sunridge" |

Static option lists (modes, equipment, packaging, freight classes, services, terms, documents) come from the value lists in `@runtruck/validation` with the web's labels, in Runtruck1's order.

#### 8.3.2 Draft → body (`CreateLoadInput`)

The draft keeps Runtruck1's string fields; the body is built only for validation and submit:

| body | from the draft |
|---|---|
| `customerId`, `billToCustomerId` | select value (uuid) or null for "" |
| `tenderRef`, `customerPo`, `dispatcherName`, `commodity`, text fields | as typed (the schema trims; '' → null) |
| `mode` | FTL → `ftl`, LTL → `ltl`, Partial → `partial` |
| `equipmentType` | select value (enum) or null |
| `stops[]` | `{kind: 'pickup' \| 'delivery', facilityName: facility, addressLine1: address, city, state, postalCode: zip, appointmentDate: date \|\| null, windowOpen: from \|\| null, windowClose: to \|\| null, referenceNumber: number, siteContact: contact}` |
| money (`lineHaulCents`, `fuelSurchargeCents`, `accessorialCents`) | `'' → 0`, else `Math.round(Number(s) * 100)` |
| `declaredValueCents`, `driverPayCents`, `carrierRateCents` | `'' → null`, else `Math.round(Number(s) * 100)` |
| quantities (`weightLb`, `pieces`, `loadedMiles`, LTL units and dimensions) | `'' → null`, else `Math.round(Number(s))` |
| `packaging`, `paymentTerms` | label → enum |
| `temperatureF` | only when equipment is `reefer_53` and `temp !== ''`: `Number(temp)`; else null |
| `hazmat`, `unNumber` | `unNumber` only when `hazmat`, else null |
| `ltl` | only when mode is LTL: `{freightClass \|\| null, nmfc, handlingUnits, lengthIn, widthIn, heightIn, stackable, services (click order, label → enum)}`; else null |
| `haul` | brokered: `{hauledBy: 'partner_carrier', carrierId, carrierRateCents, carrierContactName: carrierContact, carrierPhone, driverName: driver, truckNumber: truck, trailerNumber: trailer}`; own fleet: `{hauledBy: 'own_fleet', driverId, truckId, trailerId, driverPayCents}` |
| `driverInstructions`, `internalNotes` | `instructions`, `internal` |
| files | kept as `File` per document type; uploaded after create ([documents.md §5.2](documents.md)) |

#### 8.3.3 Badges, invalid fields and Review

- `errors` = `createLoadSchema.safeParse(body)` issues grouped by `newLoadIssueSection(issue.path.join('.'))`, preserving issue order — the same `Partial<Record<Section, string[]>>` Runtruck1's `validate()` returned, with identical messages and order for every input Runtruck1 handled (fresh draft: "11 things left to fill in", badges Load info 2, Stops 6, Freight 2, Rates 1).
- `missing(section, msg)`, nav badges, the Stops banner, "N thing(s) left to fill in" and the Review section links are Runtruck1's code over that object. Stop fields keep Runtruck1's direct invalid flags (`showErrors && !facility.trim()` …).
- The Review stats (Customer, Mode · equipment, Stops, Route, Freight, Carrier, Driver, Total to customer) and the Rates summary (Total to customer, Rate / mile, Driver pay / Carrier cost, Margin) are the live **preview**, computed in the browser with Runtruck1's formulas (new-load §8); the API recomputes every stored value on save (§1).
- The draft holds **select values** where Runtruck1 held display text (§8.3.2: the customer and bill-to uuids, the own-fleet driver, truck and trailer uuids, the equipment enum). Every place where Runtruck1 printed or tested such a draft field maps the value back to Runtruck1's text first, so the screen reads exactly as Runtruck1's:

  | element | Runtruck1 (NewLoadDialog.tsx) | Runtruck2 |
  |---|---|---|
  | Review "Customer" | `d.customer \|\| '—'` | `customerOptions.find(c => c.id === d.customer)?.name ?? '—'` (options of §8.3.1) |
  | Review "Mode · equipment" | `` `${d.mode} · ${d.equipment \|\| '—'}` `` | `` `${d.mode} · ${d.equipment ? LOAD_EQUIPMENT_LABEL[d.equipment] : '—'}` `` (`d.mode` keeps "FTL" / "LTL" / "Partial") |
  | Review "Driver" | `d.driver \|\| 'Unassigned'` | brokered: `d.driver \|\| 'Unassigned'` (free-text driver name); own fleet: `drivers.find(x => x.id === d.driver)?.fullName ?? 'Unassigned'` (options of §8.3.1) |
  | Review "Carrier" | `d.brokered ? d.carrier \|\| '—' : CARRIERS[0].name` | as [carriers.md §3](carriers.md) (unchanged) |
  | Freight "Temperature (°F)" field shown | `d.equipment.startsWith('Reefer')` | `d.equipment === 'reefer_53'` (the only reefer value, 03 §4.4) |
  | Review note "It goes on the board as …" | `d.brokered \|\| d.driver ? 'Dispatched' : 'Needs driver'` | unchanged (a chosen driver id is truthy, as a chosen name was) |

  Stops, Route, Freight and Total to customer read typed text and numbers and are unchanged. Check (web unit test and the New Load E2E): worked example A (§6.6) filled in the dialog reads Review "Customer" **Northgate Foods**, "Mode · equipment" **FTL · Reefer, 53 ft**, "Driver" **Priya Raman**, and its Freight section shows "Temperature (°F)".

#### 8.3.4 Create

1. If `errors` has any section: `showErrors = true`, go to the first bad section (Runtruck1).
2. Else `POST /loads` with the body. While it is pending, further clicks are ignored (no visual change).
3. **400 `VALIDATION_ERROR`:** merge `issues` into `errors` by `newLoadIssueSection(issue.path)`; `showErrors = true`; go to the first bad section.
4. **Any other error** (403, 409, 5xx): add the error `message` as one issue under **"Review"** and go there — New Load's existing error list shows it ("Review — You do not have permission to do that."); no new UI element.
5. **201:** upload the chosen files ([documents.md §5.2](documents.md)), invalidate the `['loads']`, `['dashboard']`, `['planner']`, `['drivers']` and `['customers']` queries (Fleet › Drivers "Current load" and the CRM aggregates are computed from loads, [fleet.md §8](fleet.md), [customers.md §6](customers.md)), close the dialog, navigate (push) to `/app/loads/${formatLoadNumber(data.loadNumber)}`.

### 8.4 Other screens that use loads data

- **Dashboard "Active loads" table** ([dashboard.md](dashboard.md) §5.3, §5.6): without a search the rows come from `GET /dashboard` `activeLoads`; while searching, the table filters the rows of `GET /loads?view=all&limit=500` with the view-model of §8.1.3 and `matchesQuery`, then `slice(0, 6)`. The dashboard's `route` must equal this endpoint's `route` byte for byte, so it uses the helper of §8.5.
- **Planner EventDialog "Related load"** ([planner.md](planner.md) §3.10): `GET /planner/related-loads` returns `{id, loadNumber, route}` of board loads in board order, built with the helper of §8.5. Planner stop events are built by the planner endpoint from the stop rows (03 §6.4), not from this DTO.
- **Fleet › Drivers "Current load"** ([fleet.md](fleet.md) §2.2) and **New Load's driver/truck/trailer selects** ([fleet.md](fleet.md) §5.4): the fleet group computes the short markets with the same stop rules; it can use `shortMarket` from the helper of §8.5.

### 8.5 Helper the loads module exports to other API modules

`apps/api/src/loads/load-endpoints.ts` exports one batched query, used by `GET /loads`, `GET /loads/:id`, the dashboard, the planner and fleet so that every route label is computed once and identically:

`loadEndpoints(db, organizationId, loadIds) → Map<loadId, {firstPickup, lastDelivery, route}>`, where `firstPickup`/`lastDelivery` = `{stopId, sequence, facilityName, address (no postal code), appointmentDate, routeLabel, shortMarket}` or null (rules of §1 and 03 §6.0.3: `routeLabel` from the facility market or the stop city; `shortMarket` = `coalesce(market_short, market_city, city)` or the stop city) and `route` = `routeLabel → routeLabel` or null. One statement: `load_stops LEFT JOIN facilities WHERE organization_id = $1 AND load_id = ANY($2) ORDER BY load_id, sequence`, reduced in memory; no N+1.

## 9. Decisions to record (01 §6)

| # | decision |
|---|---|
| L1 | **C8 resolved.** `GET /loads/by-number/:n` and `GET /loads/:id` return archived loads too (the API is truthful; `archivedAt` is set). The web's detail page shows the first board load for an unknown, malformed, differently-cased or archived number, as Runtruck1 did for any number not on its board (D6); with an empty board it renders nothing. |
| L2 | `GET /loads` defaults to `view=all`; the web loads the whole board once (≤ 500 rows) and filters pills and search locally; KPIs come from `meta.summary`. |
| L3 | `loads.created_at` is the real database time (it orders the board, so demo-day loads sort above the seed); business instants — activity `occurred_at`, dispatch `assigned_at`, document `attached_at`/`uploaded_at` — use `ClockService.now()`, so a new load's activity reads "Today HH:MM" under `DEMO_TODAY`. The time is organization time, not the browser's. |
| L4 | New Load numbers are stored in storage units: money in whole cents (a sub-cent entry is rounded: Runtruck1 showed "$2,450.555"), weights, miles, pieces, handling units and dimensions in whole units (0.4 lb rounds to 0 and then fails "Weight"), temperature to 0.1 °F within ±999.9. Negative amounts and values above the integer range are refused with a field issue. Runtruck1 accepted them silently (e.g. a negative fuel surcharge lowered the total). |
| L5 | Free text is trimmed and length-bounded (limits in §6.1) and a load has at most 50 stops. Runtruck1 had no limits; bounded input is a security requirement. |
| L6 | Fields Runtruck1 hides are consistent or absent: LTL details only on LTL loads, a UN number only with hazmat, a temperature only on reefer equipment, driver pay only on own-fleet loads, carrier fields only on brokered loads (the web never sends the hidden values; Runtruck1 never saved them). |
| L7 | Body references that do not resolve in the caller's organization answer 400 `VALIDATION_ERROR` with a field issue (identical for unknown and foreign ids); path ids answer 404. |
| L8 | Non-validation failures of "Create load" appear as an issue under New Load's "Review" section; repeated clicks are ignored while pending; no idempotency key yet. |
| L9 | "Load created by {name}" names the creator (Runtruck1 named the viewer); identical for Rosa Medina. |
| L10 | Driver pay 0 means none (stored null, displayed "—"), as Runtruck1 displayed it. |
| L11 | New Load stops are free text (`facility_id` null) in the organization's timezone; they are not matched to known facilities, so the route uses the typed city (Runtruck1 `place()`). |
| L12 | Dispatch rules E1–E7 enforced, D1–D8 deferred ([09 §3](../09-dispatch-lifecycle.md)); POD upload completes `needs_pod` loads when the uploader also holds `loads.update` ([08 §3](../08-load-lifecycle.md) T12, [08 §7](../08-load-lifecycle.md)); document limits and upload-after-create ([13 §8](../13-document-system.md)). |
| L13 | The board has no archive rule in this release (08 §6). Beyond 500 board loads the web's one page shows the newest 500 (pills, search, card title) while the KPIs count all; server `q` scans at most 5,000 board loads of the view (04 §5.1). Tracked until billing closes loads off the board. |
| L14 | New Load's draft holds select values (uuids, enum keys); Review and the Freight temperature field map them back to Runtruck1's text (§8.3.3), so the dialog reads as Runtruck1's. |
| L15 | The total to customer is bounded by the `integer` range (issue "Total to customer is too large.", CHECK `loads_total_ck`), so revenue sums cannot overflow. Runtruck1 had no bound. |

## 10. Needed changes in files other groups own

1. **`packages/calculations`** (shared by API `q` and web): add `src/loads.ts` with the label and tone maps (`LOAD_STATUS_LABEL`, `LOAD_STATUS_TONE`, `LOAD_MODE_LABEL`, `LOAD_EQUIPMENT_LABEL`, `LOAD_PACKAGING_LABEL`, `LOAD_LTL_SERVICE_LABEL`, `LOAD_DOCUMENT_TYPE_LABEL`), `stopKindLabel(kind, status)`, `stopWindow(open, close)`, and `toLoadSearchRow(item, {timeZone, today})` implementing §8.1.3, so the server `q` and the web search are one function.
2. **Customers, carriers, fleet list endpoints** keep serving the fields of §8.3.1 in those orders (`CustomerListItem`, `CarrierListItem` with the own-fleet row at position 1, `DriverListItem`, `TruckListItem` ordered by unit number, `TrailerListItem`); the current sibling DTOs already have them.
3. **Dashboard group:** fetch the "Active loads" table from `GET /loads` (§8.4) or reproduce §3's order and matching exactly.
4. **`docs/01-product-requirements.md` §6:** **done** — L1–L15 and the dispatch/document decisions are recorded (C8 → resolved by L1).
5. **`docs/17-event-architecture.md`:** **done** — `LoadCreated`, `LoadAssigned`, `LoadDispatched`, `LoadStatusChanged`, `DocumentUploaded`, `PODUploaded` are registered with this document's payloads (17 §5); the specified-only load events are listed there.
6. **`apps/api/package.json`:** `@aws-sdk/client-s3` (dependency) and `@types/multer` (dev) when the documents module is built ([13 §2](../13-document-system.md)); `packages/database/package.json` needs `@aws-sdk/client-s3` too, for the seed's placeholder objects ([13 §7](../13-document-system.md): not written yet).
