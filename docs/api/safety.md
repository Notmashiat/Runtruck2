# API — Safety (work orders, driver documents, compliance reminders, violations, claims)

Endpoint specification for Safety › Maintenance, Safety › Driver Documents, Safety › Violations and Safety › Settlements (cargo and liability **claims**, fleet-hr-safety B12), and for the Fleet › Drivers "Compliance watchlist". It follows the conventions of [04-api.md](../04-api.md) (envelopes, errors, lists, formats) and computes every value by the rules of [03-database.md §6.9](../03-database.md) (D5). Where this document and 03 disagree, 03 wins (architecture §49) and the conflict must be raised. The screens are specified in [reference/runtruck1/fleet-hr-safety.md](../reference/runtruck1/fleet-hr-safety.md) §3.1 (watchlist) and §8–§11.

- Wire types: `packages/types/src/safety.ts`. Input schemas: `packages/validation/src/safety.ts`.
- API modules (architecture §6), registered in `apps/api/src/modules/hr-safety.ts`: `apps/api/src/maintenance/` (`GET /work-orders`), `apps/api/src/compliance/` (`GET /driver-documents`, `GET /compliance-reminders`, `GET /violations`), `apps/api/src/claims/` (`GET /claims`). The URL `/app/safety/settlements` keeps Runtruck1's name; the backend module, table and permissions are `claims` (07 §2.1).

## 0. Feature summary (architecture §44)

| item | content |
|---|---|
| FEATURE | Safety read views: maintenance work orders, the driver qualification file, roadside violations and claims, each with its KPI row; the compliance watchlist of Fleet › Drivers. |
| PURPOSE | Runtruck1 parity (R1) with the data served from PostgreSQL (R2). |
| USERS | Safety and fleet managers, dispatchers (work orders, compliance), maintenance (work orders), owners/admins/managers (claims). |
| PERMISSIONS | `maintenance.view` (work orders); `compliance.view` (driver documents, compliance reminders, violations; 07 §2.1); `claims.view` (claims). |
| DATABASE TABLES | read: `work_orders`, `trucks`, `trailers`, `facilities`, `driver_documents`, `compliance_reminders`, `drivers`, `employees`, `violations`, `claims`, `customers`, `loads`. |
| DATABASE CHANGES | none. |
| API ENDPOINTS | `GET /work-orders`, `GET /driver-documents`, `GET /compliance-reminders`, `GET /violations`, `GET /claims`. |
| BUSINESS RULES | 03 §6.0.1 (clock, YTD), §6.0.8 (work-order unit/due/shop, claim unit, claimant), §6.9 (KPIs). |
| STATE CHANGES / EVENTS / JOBS / NOTIFICATIONS / INTEGRATIONS / AI | none. The screens are read-only; "+ Log Service", "Request document", "+ Log Violation" and "+ New Claim" are inert stubs (§8). |
| SECURITY | session auth, permission guard per endpoint, organization from the session only, no internal details in errors. Claim amounts and third-party claimant names are financial/personal data served only to `claims.view` holders and never logged. |
| ERROR CASES | §1.5. |
| TESTS | §9. |
| ACCEPTANCE CRITERIA | the seed renders exactly the strings of §7 (every value equals Runtruck1, §10); tenant isolation and permission denial proven by integration tests; architecture §45. |

## 1. Rules shared by the five endpoints

### 1.1 Clock and windows

`today = ClockService.today(ctx.timezone)` (D4; 2026-09-03 for the seed). Windows, computed on `YYYY-MM-DD` strings in UTC (`addDaysIso`), never through local `Date` or the server's date:

| window | rule | seed |
|---|---|---|
| done window | `completed_on >= today − 30 days` | ≥ 2026-08-04 |
| expiring window end | `today + 60 days` | 2026-11-02 |
| 12-month window | `occurred_on > today − 1 year` (same month and day of the previous year; Feb 29 → Feb 28), i.e. `occurred_on >= (today − 1 year) + 1 day` | ≥ 2025-09-04 |
| YTD | January 1 of `today`'s year … `today`, inclusive | 2026-01-01 … 2026-09-03 |

### 1.2 List mechanics

- Query: `limit` (1–500, default 100), `offset` (≥ 0), `q` (trimmed, ≤ 200 characters), plus the per-endpoint `status` filter (one value). Validated by the named Zod schema through `ZodValidationPipe`; unknown parameters are ignored.
- Lists follow [04 §5.1](../04-api.md). **Driver documents** and **compliance reminders** are reference-size (a few rows per driver): the service reads every row of the organization with one statement, computes `meta.summary` over all of them, applies `status`, then `q`, and slices. **Work orders, violations and claims grow with the business**, so each request runs two statements:
  1. the page: `status` filter, order, `LIMIT`/`OFFSET` and `count(*) OVER ()` in SQL (the statements of §2.6, §5.6 and §6.6 with the page's predicates); with `q` (never sent by the web) the statement instead returns at most the first 5,000 rows of the filter in list order, which are matched in memory (§1.3) and sliced;
  2. `meta.summary`: one SQL aggregate over the organization's rows, bounded by the windows of §1.1 where the KPI has one (done window, 12-month window, YTD) and by the open statuses otherwise. The summary ignores `q` and `status`, because Runtruck1's search never changes a KPI (03 §6).
- `meta.total` counts the rows after `status` and `q`.
- Response: `{ data: Row[], meta: { total, limit, offset, summary } }` (04 §2). Money sums are integers in cents (JS numbers stay exact far below 2^53; SQL `bigint` values are converted with `Number()`).

### 1.3 Server-side `q`

`q` reproduces Runtruck1's `matchesQuery` (fleet-hr-safety §2.8): `needle = q.trim().toLowerCase()`; an empty needle matches everything; otherwise a row matches when any of its **searchable values** contains the needle after lowercasing. The searchable values are exactly the string and number values of the row's view-model (§7), built with the same label maps and `@runtruck/calculations` formatters the web uses. Raw numbers Runtruck1 kept as numbers are matched as their decimal digits: work-order `estimate` and claim `reserved`/`paid` **in whole dollars** (`4850`, never `$4,850` or `485000`), violation `severityPoints`. Ids, enum values and cents are never searched.

The web does not send `q`; it filters the rows it holds with the same rule on the same view-model, so both paths give identical results. The label maps and view-model builders are shared runtime code (dependency R1 in §11).

### 1.4 Tenancy

Every statement filters `organization_id = ctx.organizationId` on **every** table it reads, and every join also matches `organization_id` on both sides (`drivers.organization_id = violations.organization_id AND drivers.id = violations.driver_id`). The composite tenant foreign keys (03 §1.3) make a cross-tenant reference impossible even if a join condition were missing. No endpoint accepts an organization id. A member of another organization sees only that organization's rows. The "Test Carrier Co" fixture (01 C10) has one row in every table, so its member sees exactly its own rows and a summary over them, never Sunridge's.

### 1.5 Errors

| HTTP | code | when |
|---|---|---|
| 400 | `VALIDATION_ERROR` | `limit` outside 1–500, negative or non-integer `offset`, `q` longer than 200, an unknown or repeated `status`. `issues[]` names the parameter. |
| 401 | `UNAUTHORIZED` | no or expired session. |
| 403 | `FORBIDDEN` | the member lacks the endpoint's permission. |
| 403 | `NO_ACTIVE_MEMBERSHIP` | the account has no active organization. |
| 500 | `INTERNAL_ERROR` | anything unexpected (logged with the request id; no details returned). |

There is no 404: these are collection reads.

### 1.6 Audit and events

None. The five endpoints are reads, and reads are not audited (architecture §30 audits changes). The writes behind the stub buttons are listed in §8.

### 1.7 Stored statuses

Every status chip is a **stored lifecycle status** (design brief §2): work order, driver document, violation and claim. The API never re-derives them from the clock, so "Overdue", "Expiring (60 d)" and "Expired" count stored statuses (fleet-hr-safety §8.4, §9.3 propose derivation rules; 03 does not adopt them). With the pinned clock the stored statuses match those rules. Runtruck1's cross-record contradictions (fleet-hr-safety B8: T-121 overdue brake work yet "In service"; B7: Priya Raman's expired CDL) are stored facts and are reproduced (D6).

## 2. `GET /api/v1/work-orders`

| | |
|---|---|
| Permission | `maintenance.view` |
| Query | `listWorkOrdersQuerySchema` → `ListWorkOrdersQuery`: `limit`, `offset`, `q`, `status?: 'scheduled' \| 'due' \| 'overdue' \| 'in_shop' \| 'done'`. |
| Response | `WorkOrdersResponse` = `{ data: WorkOrderRow[], meta: WorkOrdersMeta }` |
| Consumers | Safety › Maintenance. |

### 2.1 `WorkOrderRow`

| field | type | computed from |
|---|---|---|
| `id` | `string` (uuid) | `work_orders.id` |
| `unit` | `WorkOrderUnit` = `{ kind: 'truck' \| 'trailer', id, unitNumber }` | `truck_id` set → `{ kind: 'truck', id: trucks.id, unitNumber: trucks.unit_number }`; else the `trailer_id` trailer (`work_orders_unit_ck` guarantees exactly one) |
| `item` | `string` | `work_orders.item` |
| `dueOn` | `string \| null` | `work_orders.due_on` |
| `dueOdometer` | `number \| null` | `work_orders.due_odometer` (miles); exactly one of the two dues is set (`work_orders_due_ck`) |
| `shop` | `WorkOrderShop` = `{ facilityId, name, city }` | the `shop_facility_id` facility: `facilities.id`, `.name`, `.city` |
| `estimateCents` | `number` | `work_orders.estimate_cents` |
| `status` | `WorkOrderStatus` | `work_orders.status` |
| `completedOn` | `string \| null` | `work_orders.completed_on` (set iff `done`) |

### 2.2 Order

`ORDER BY work_orders.position, work_orders.id`: T-118, FB-12, T-121, T-114, RF-27, T-107, T-103, T-109 (Runtruck1's `MAINTENANCE` order).

### 2.3 Searchable fields (`q`)

The Runtruck1 `WorkOrder` fields except `tagClass` (view-model §7.1): `unit`, `item`, `due` ("Sep 5" or "529,800 mi"), `shop` ("Sunridge shop · Modesto"), `estimate` as whole dollars (raw), `status` (label). So "4850" matches T-118, while "$4,850" and "485000" match nothing; "342,000" matches T-103; "fresno" matches RF-27.

### 2.4 `meta.summary`: `WorkOrdersSummary`

| field | type | formula | seed |
|---|---|---|---|
| `asOf` | `string` | `today` | `"2026-09-03"` |
| `doneWindowStart` | `string` | `today − 30` | `"2026-08-04"` |
| `workOrderCount` | `number` | count of work orders | 8 |
| `openCount` | `number` | count `status <> 'done'` | 7 |
| `doneLast30dCount` | `number` | count `status = 'done' AND completed_on >= doneWindowStart` | 1 (T-109, 08-22) |
| `inShopCount` | `number` | count `status = 'in_shop'` | 2 |
| `inShopShops` | `WorkOrderShop[]` | shops of the `in_shop` orders, distinct by `facilityId`, in list order | `[{ name: "Sunridge shop", city: "Modesto" }]` |
| `overdue` | `WorkOrderOverdueEntry[]` | `status = 'overdue'`, in list order; each `{ workOrderId, unitNumber, item }` | `[{ unitNumber: "T-121", item: "Brake adjustment" }]` |
| `openEstimateCents` | `number` | Σ `estimate_cents` with `status <> 'done'` | 711500 (4,850 + 150 + 420 + 640 + 710 + 185 + 160 dollars) |

Runtruck1 counted every Done row as "done · last 30 d" (fleet-hr-safety B3); the API applies the window (03 §6.9) and the seed gives the same 1. All values equal Runtruck1's.

### 2.5 Rows against the seed

| unit | item | dueOn / dueOdometer | shop | estimateCents | status | completedOn |
|---|---|---|---|---|---|---|
| truck T-118 | Turbocharger replacement | 2026-09-05 | Sunridge shop, Modesto | 485000 | in_shop | null |
| trailer FB-12 | DOT annual inspection | 2026-09-03 | Sunridge shop, Modesto | 15000 | in_shop | null |
| truck T-121 | Brake adjustment | 2026-08-28 | Sunridge shop, Modesto | 42000 | overdue | null |
| truck T-114 | PM service A | 529800 mi | Sunridge shop, Modesto | 64000 | due | null |
| trailer RF-27 | Reefer unit service | 2026-09-12 | Thermo King, Fresno | 71000 | scheduled | null |
| truck T-107 | DOT annual inspection | 2026-09-18 | Valley Truck Center, Stockton | 18500 | scheduled | null |
| truck T-103 | Tire rotation | 342000 mi | Sunridge shop, Modesto | 16000 | scheduled | null |
| truck T-109 | DOT annual inspection | 2026-08-22 | Valley Truck Center, Stockton | 18500 | done | 2026-08-22 |

Example item:

```json
{ "id": "…", "unit": { "kind": "truck", "id": "…", "unitNumber": "T-114" }, "item": "PM service A",
  "dueOn": null, "dueOdometer": 529800, "shop": { "facilityId": "…", "name": "Sunridge shop", "city": "Modesto" },
  "estimateCents": 64000, "status": "due", "completedOn": null }
```

### 2.6 Query plan (no N+1)

```sql
SELECT w.id, w.item, w.due_on, w.due_odometer, w.estimate_cents, w.status, w.completed_on,
       t.id AS truck_id, t.unit_number AS truck_unit_number,
       tr.id AS trailer_id, tr.unit_number AS trailer_unit_number,
       f.id AS shop_id, f.name AS shop_name, f.city AS shop_city
FROM work_orders w
LEFT JOIN trucks t ON t.organization_id = w.organization_id AND t.id = w.truck_id
LEFT JOIN trailers tr ON tr.organization_id = w.organization_id AND tr.id = w.trailer_id
JOIN facilities f ON f.organization_id = w.organization_id AND f.id = w.shop_facility_id
WHERE w.organization_id = $org
ORDER BY w.position, w.id;
```

Indexes: `work_orders_org_position_idx`, the tenant keys `trucks_org_id_uq`, `trailers_org_id_uq`, `facilities_org_id_uq`. This statement carries the page's predicates, `LIMIT`/`OFFSET` and `count(*) OVER ()` (§1.2 statement 1); the summary is the separate SQL aggregate of §1.2 statement 2, never computed from the page.

## 3. `GET /api/v1/driver-documents`

| | |
|---|---|
| Permission | `compliance.view` |
| Query | `listDriverDocumentsQuerySchema` → `ListDriverDocumentsQuery`: `limit`, `offset`, `q`, `status?: 'valid' \| 'expiring' \| 'expired' \| 'missing'`. |
| Response | `DriverDocumentsResponse` = `{ data: DriverDocumentRow[], meta: DriverDocumentsMeta }` |
| Consumers | Safety › Driver Documents. (Fleet › Drivers reads each driver's CDL month through `GET /drivers`, [fleet.md](fleet.md) §2.1.) |

### 3.1 `DriverDocumentRow`

| field | type | computed from |
|---|---|---|
| `id` | `string` (uuid) | `driver_documents.id` |
| `driver` | `SafetyDriverRef` = `{ id, fullName }` | `drivers.id`; the driver's employee `first_name + ' ' + last_name` |
| `documentType` | `DriverDocumentType` | `driver_documents.document_type` |
| `expiresOn` | `string \| null` | `driver_documents.expires_on` (null = missing; a month-precision date is the month's last day) |
| `expiresPrecision` | `ComplianceDatePrecision` | `driver_documents.expires_precision` |
| `status` | `DriverDocumentStatus` | `driver_documents.status` (`driver_documents_missing_ck`: `missing` iff `expires_on` is null) |

### 3.2 Order

`ORDER BY driver_documents.position, driver_documents.id`: roster order, then the order within each driver's file (Runtruck1's `DRIVER_DOCUMENTS`, 15 rows).

### 3.3 Searchable fields (`q`)

The Runtruck1 `DriverDocument` fields except `tagClass` (view-model §7.2): `driver`, `document` (label), `expires` ("Apr 2028", "Sep 20" or "—"), `status` (label). So "—" matches Tobias Frey's drug test, "2026" matches the two month-precision 2026 rows (Priya Raman CDL "Jul 2026", Tobias Frey medical card "Dec 2026"), "sep 2" matches four rows ("Sep 20", "Sep 24" twice, "Sep 2029").

### 3.4 `meta.summary`: `DriverDocumentsSummary`

`DriverDocumentKpiEntry` = `{ driverDocumentId, driverId, fullName, documentType }`.

| field | type | formula | seed |
|---|---|---|---|
| `asOf` | `string` | `today` | `"2026-09-03"` |
| `expiringWindowEnd` | `string` | `today + 60` | `"2026-11-02"` |
| `documentCount` | `number` | count of documents | 15 |
| `driverCount` | `number` | count of distinct `driver_id` | 6 |
| `expiringCount` | `number` | count `status = 'expiring'` | 4 |
| `expired` | `DriverDocumentKpiEntry[]` | `status = 'expired'`, in list order | `[{ fullName: "Priya Raman", documentType: "cdl" }]` |
| `missing` | `DriverDocumentKpiEntry[]` | `status = 'missing'`, in list order | `[{ fullName: "Tobias Frey", documentType: "drug_test" }]` |

All values equal Runtruck1's.

### 3.5 Rows against the seed

| driver | documentType | expiresOn | expiresPrecision | status |
|---|---|---|---|---|
| Marcus Hale | cdl | 2028-04-30 | month | valid |
| Marcus Hale | medical_card | 2027-03-31 | month | valid |
| Marcus Hale | clearinghouse_query | 2026-09-20 | day | expiring |
| Dara Whitfield | cdl | 2027-11-30 | month | valid |
| Dara Whitfield | medical_card | 2027-06-30 | month | valid |
| Ellis Nakamura | cdl | 2027-02-28 | month | valid |
| Ellis Nakamura | medical_card | 2026-10-12 | day | expiring |
| Priya Raman | cdl | 2026-07-31 | month | expired |
| Priya Raman | medical_card | 2028-01-31 | month | valid |
| Ana Cortez | cdl | 2029-09-30 | month | valid |
| Ana Cortez | mvr | 2026-09-24 | day | expiring |
| Ana Cortez | annual_review | 2026-09-24 | day | expiring |
| Tobias Frey | cdl | 2028-01-31 | month | valid |
| Tobias Frey | medical_card | 2026-12-31 | month | valid |
| Tobias Frey | drug_test | null | month | missing |

### 3.6 Query plan (no N+1)

```sql
SELECT dd.id, dd.document_type, dd.expires_on, dd.expires_precision, dd.status,
       d.id AS driver_id, e.first_name, e.last_name
FROM driver_documents dd
JOIN drivers d ON d.organization_id = dd.organization_id AND d.id = dd.driver_id
JOIN employees e ON e.organization_id = d.organization_id AND e.id = d.employee_id
WHERE dd.organization_id = $org
ORDER BY dd.position, dd.id;
```

Index: `driver_documents_org_position_idx`. The summary is computed in memory.

## 4. `GET /api/v1/compliance-reminders`

| | |
|---|---|
| Permission | `compliance.view` (07 §2.1: "compliance reminders (the watchlist)") |
| Query | `listComplianceRemindersQuerySchema` → `ListComplianceRemindersQuery`: `limit`, `offset`, `q`. |
| Response | `ComplianceRemindersResponse` = `{ data: ComplianceReminderRow[], meta: ComplianceRemindersMeta }` |
| Consumers | Fleet › Drivers only: the "Compliance watchlist" card and the "Docs to renew" KPI ([fleet.md](fleet.md) §5.1). **Not the Dashboard** (decision S1). |

The watchlist is a stored record list, not derived from `driver_documents`: Runtruck1 relabels ("CDL renewal"), merges (Ana's MVR and annual review become one "Annual MVR review") and hand-orders it, and omits the missing drug test (design brief §2, fleet-hr-safety B6).

### 4.1 `ComplianceReminderRow`

| field | type | computed from |
|---|---|---|
| `id` | `string` (uuid) | `compliance_reminders.id` |
| `driver` | `SafetyDriverRef` = `{ id, fullName }` | `drivers.id`; the driver's employee full name |
| `itemLabel` | `string` | `compliance_reminders.item_label` |
| `dueOn` | `string` | `compliance_reminders.due_on` (month precision → the month's last day) |
| `duePrecision` | `ComplianceDatePrecision` | `compliance_reminders.due_precision` |

### 4.2 Order

`ORDER BY compliance_reminders.position, compliance_reminders.id`: Priya Raman, Ellis Nakamura, Ana Cortez, Marcus Hale (Runtruck1's `WATCHLIST` order; not by due date).

### 4.3 Searchable fields (`q`)

The Runtruck1 `WatchItem` fields (view-model §7.3): `name`, `item`, `due` ("Jul 2026" or "Oct 12"). The Drivers tab never searches the watchlist (fleet-hr-safety §2.8); server `q` exists for list uniformity. "sep 2" matches Ana Cortez and Marcus Hale.

### 4.4 `meta.summary`: `ComplianceRemindersSummary`

| field | type | formula | seed |
|---|---|---|---|
| `asOf` | `string` | `today` | `"2026-09-03"` |
| `reminderCount` | `number` | count of the organization's reminders (ignores `q`) | 4 |

"Docs to renew" reads `meta.total` of the unfiltered request ([fleet.md](fleet.md) F1), which equals `reminderCount` because the Drivers tab sends no `q`. Value 4, as Runtruck1.

### 4.5 Rows against the seed

| driver | itemLabel | dueOn | duePrecision |
|---|---|---|---|
| Priya Raman | CDL renewal | 2026-07-31 | month |
| Ellis Nakamura | Medical card | 2026-10-12 | day |
| Ana Cortez | Annual MVR review | 2026-09-24 | day |
| Marcus Hale | Clearinghouse query | 2026-09-20 | day |

### 4.6 Query plan (no N+1)

```sql
SELECT cr.id, cr.item_label, cr.due_on, cr.due_precision, d.id AS driver_id, e.first_name, e.last_name
FROM compliance_reminders cr
JOIN drivers d ON d.organization_id = cr.organization_id AND d.id = cr.driver_id
JOIN employees e ON e.organization_id = d.organization_id AND e.id = d.employee_id
WHERE cr.organization_id = $org
ORDER BY cr.position, cr.id;
```

Index: `compliance_reminders_org_position_idx`.

## 5. `GET /api/v1/violations`

| | |
|---|---|
| Permission | `compliance.view` |
| Query | `listViolationsQuerySchema` → `ListViolationsQuery`: `limit`, `offset`, `q`, `status?: 'open' \| 'contested' \| 'closed'`. |
| Response | `ViolationsResponse` = `{ data: ViolationRow[], meta: ViolationsMeta }` |
| Consumers | Safety › Violations. |

### 5.1 `ViolationRow`

| field | type | computed from |
|---|---|---|
| `id` | `string` (uuid) | `violations.id` |
| `occurredOn` | `string` | `violations.occurred_on` |
| `driver` | `SafetyDriverRef` | `drivers.id`; the driver's employee full name |
| `truck` | `SafetyTruckRef` = `{ id, unitNumber }` | `trucks.id`, `trucks.unit_number` |
| `violationType` | `string` | `violations.violation_type` |
| `severityPoints` | `number` | `violations.severity_points` |
| `location` | `string` | `violations.location` |
| `status` | `ViolationStatus` | `violations.status` |

### 5.2 Order

`ORDER BY violations.occurred_on DESC, violations.id`: Aug 31, Aug 28, Aug 19, Jul 30, Jun 12, May 6, Mar 18 (Runtruck1's `VIOLATIONS`, newest first).

### 5.3 Searchable fields (`q`)

The Runtruck1 `Violation` fields except `tagClass` (view-model §7.4): `date` (F-SHORT), `driver`, `unit`, `type`, `severityPoints` (raw), `location`, `status` (label). So "cottonwood" matches Ellis Nakamura's Aug 28 row, "log form" matches two rows, "contested" matches Marcus Hale's.

### 5.4 `meta.summary`: `ViolationsSummary`

| field | type | formula | seed |
|---|---|---|---|
| `asOf` | `string` | `today` | `"2026-09-03"` |
| `pointsWindowStart` | `string` | `(today − 1 year) + 1 day` (§1.1) | `"2025-09-04"` |
| `violationCount` | `number` | count of violations | 7 |
| `openCount` | `number` | count `status = 'open'` | 2 |
| `contestedCount` | `number` | count `status = 'contested'` | 1 |
| `closedCount` | `number` | count `status = 'closed'` | 4 |
| `pointsInWindow` | `number` | Σ `severity_points` with `occurred_on >= pointsWindowStart`, any status | 29 (1 + 4 + 7 + 6 + 4 + 1 + 6) |
| `violationsInWindowCount` | `number` | count with `occurred_on >= pointsWindowStart` | 7 |

Runtruck1 summed every row with no window (fleet-hr-safety B3); the API applies the 12-month window (03 §6.9) and the seed gives the same 29 and 7. All values equal Runtruck1's.

### 5.5 Rows against the seed

| occurredOn | driver | truck | violationType | severityPoints | location | status |
|---|---|---|---|---|---|---|
| 2026-08-31 | Tobias Frey | T-118 | Log form & manner | 1 | I-70 POE · Loma, CO | open |
| 2026-08-28 | Ellis Nakamura | T-121 | Brake adjustment | 4 | I-5 scale · Cottonwood, CA | open |
| 2026-08-19 | Marcus Hale | T-114 | Hours-of-service | 7 | US-95 POE · Winnemucca, NV | contested |
| 2026-07-30 | Dara Whitfield | T-107 | Lighting | 6 | I-80 scale · Donner Pass, CA | closed |
| 2026-06-12 | Tobias Frey | T-118 | Speeding 6–10 over | 4 | I-70 · Grand Junction, CO | closed |
| 2026-05-06 | Ellis Nakamura | T-121 | Log form & manner | 1 | I-84 POE · Ontario, OR | closed |
| 2026-03-18 | Ana Cortez | T-109 | Lighting | 6 | I-5 scale · Ashland, OR | closed |

"Speeding 6–10 over" keeps its en dash (U+2013).

### 5.6 Query plan (no N+1)

```sql
SELECT v.id, v.occurred_on, v.violation_type, v.severity_points, v.location, v.status,
       d.id AS driver_id, e.first_name, e.last_name, t.id AS truck_id, t.unit_number
FROM violations v
JOIN drivers d ON d.organization_id = v.organization_id AND d.id = v.driver_id
JOIN employees e ON e.organization_id = d.organization_id AND e.id = d.employee_id
JOIN trucks t ON t.organization_id = v.organization_id AND t.id = v.truck_id
WHERE v.organization_id = $org
ORDER BY v.occurred_on DESC, v.id;
```

Index: `violations_org_occurred_idx (organization_id, occurred_on DESC)`. This statement carries the page's predicates, `LIMIT`/`OFFSET` and `count(*) OVER ()` (§1.2 statement 1); the summary is the separate SQL aggregate of §1.2 statement 2.

## 6. `GET /api/v1/claims`

| | |
|---|---|
| Permission | `claims.view` |
| Query | `listClaimsQuerySchema` → `ListClaimsQuery`: `limit`, `offset`, `q`, `status?: 'open' \| 'under_review' \| 'settled' \| 'denied'`. |
| Response | `ClaimsResponse` = `{ data: ClaimRow[], meta: ClaimsMeta }` |
| Consumers | Safety › Settlements (`/app/safety/settlements`). |

### 6.1 `ClaimRow`

| field | type | computed from |
|---|---|---|
| `id` | `string` (uuid) | `claims.id` |
| `claimNumber` | `number` | `claims.claim_number` (web: "CLM-1112") |
| `occurredOn` | `string` | `claims.occurred_on` |
| `driver` | `SafetyDriverRef` | `drivers.id`; the driver's employee full name |
| `truck` | `SafetyTruckRef` | `trucks.id`, `trucks.unit_number` |
| `trailer` | `SafetyTrailerRef \| null` | `trailers.id`, `trailers.unit_number` of `claims.trailer_id`; null when not set |
| `load` | `ClaimLoadRef \| null` = `{ id, loadNumber }` | `loads.id`, `loads.load_number` of `claims.load_id` (archived loads included); null when not set |
| `claimType` | `ClaimType` | `claims.claim_type` |
| `claimant` | `ClaimClaimant` | by `claimant_kind` (`claims_claimant_ck` guarantees the matching column): `customer` → `{ kind, customerId, name: customers.name }`; `facility` → `{ kind, facilityId, name: facilities.name }`; `third_party` → `{ kind, name: claimant_name }` |
| `reservedCents` | `number` | `claims.reserved_cents` |
| `paidCents` | `number` | `claims.paid_cents` (0 until paid) |
| `status` | `ClaimStatus` | `claims.status` |

`claims.view` covers the claimant's customer or facility name and the load number of the claim; no `customers.view`, `locations.view` or `loads.view` is needed for them (they are fields of Runtruck1's `Claim` row; decision S2).

### 6.2 Order

`ORDER BY claims.claim_number DESC` (unique per organization): CLM-1112 … CLM-1107 (Runtruck1's `CLAIMS`, newest first).

### 6.3 Searchable fields (`q`)

The Runtruck1 `Claim` fields except `tagClass` (view-model §7.5): `id` ("CLM-1112"), `date` (F-SHORT), `driver`, `unit` ("T-121 / FB-12"), `type` (label), `claimant` ("Third party · R. Delgado"), `reserved` and `paid` as whole dollars (raw; an unpaid claim's `paid` is 0, so "0" matches it, D6), `status` (label). So "18500" matches CLM-1108 while "$18,500" matches nothing; "northgate" matches CLM-1111 and CLM-1107; "third party" matches CLM-1108.

### 6.4 `meta.summary`: `ClaimsSummary`

| field | type | formula | seed |
|---|---|---|---|
| `asOf` | `string` | `today` | `"2026-09-03"` |
| `ytdStart` | `string` | January 1 of today's year | `"2026-01-01"` |
| `claimCount` | `number` | count of claims | 6 |
| `openCount` | `number` | count `status IN ('open', 'under_review')` | 2 |
| `underReviewCount` | `number` | count `status = 'under_review'` | 1 |
| `openReservedCents` | `number` | Σ `reserved_cents` with `status IN ('open', 'under_review')` | 1100000 ($6,800 + $4,200) |
| `paidYtdCents` | `number` | Σ `paid_cents` with `paid_cents > 0 AND occurred_on BETWEEN ytdStart AND today` | 2402500 ($2,650 + $18,500 + $2,875) |
| `paidYtdCount` | `number` | count of those claims | 3 |
| `settledCount` | `number` | count `status = 'settled'` | 3 |
| `deniedCount` | `number` | count `status = 'denied'` | 1 |

The schema stores no payment date for a claim, so "Paid YTD" filters on the claim date (`occurred_on`), as 03 §6.9 specifies (decision S5). Runtruck1 summed every paid claim with no year filter (fleet-hr-safety B3); the seed gives the same $24,025 and 3. All values equal Runtruck1's.

### 6.5 Rows against the seed

| claimNumber | occurredOn | driver | truck / trailer | claimType | claimant | reservedCents | paidCents | status |
|---|---|---|---|---|---|---|---|---|
| 1112 | 2026-08-26 | Ellis Nakamura | T-121 / FB-12 | cargo_damage | customer Cascade Building Supply | 680000 | 0 | open |
| 1111 | 2026-08-14 | Marcus Hale | T-114 / RF-88 | cargo_damage | customer Northgate Foods | 420000 | 0 | under_review |
| 1110 | 2026-07-22 | Dara Whitfield | T-107 / DV-51 | property_damage | facility Wasatch Crossdock | 290000 | 265000 | settled |
| 1109 | 2026-06-30 | Tobias Frey | T-118 / DV-14 | cargo_shortage | customer Sierra Ag Partners | 145000 | 0 | denied |
| 1108 | 2026-05-09 | Ana Cortez | T-109 / FB-04 | bodily_injury | third_party R. Delgado | 2500000 | 1850000 | settled |
| 1107 | 2026-03-03 | Priya Raman | T-103 / RF-27 | cargo_damage | customer Northgate Foods | 310000 | 287500 | settled |

`load` is null on every seeded claim (Runtruck1 names no load).

Example item:

```json
{ "id": "…", "claimNumber": 1108, "occurredOn": "2026-05-09",
  "driver": { "id": "…", "fullName": "Ana Cortez" }, "truck": { "id": "…", "unitNumber": "T-109" },
  "trailer": { "id": "…", "unitNumber": "FB-04" }, "load": null, "claimType": "bodily_injury",
  "claimant": { "kind": "third_party", "name": "R. Delgado" },
  "reservedCents": 2500000, "paidCents": 1850000, "status": "settled" }
```

### 6.6 Query plan (no N+1)

```sql
SELECT c.id, c.claim_number, c.occurred_on, c.claim_type, c.claimant_kind, c.claimant_name,
       c.reserved_cents, c.paid_cents, c.status,
       d.id AS driver_id, e.first_name, e.last_name,
       t.id AS truck_id, t.unit_number AS truck_unit_number,
       tr.id AS trailer_id, tr.unit_number AS trailer_unit_number,
       l.id AS load_id, l.load_number,
       cu.id AS customer_id, cu.name AS customer_name,
       f.id AS facility_id, f.name AS facility_name
FROM claims c
JOIN drivers d ON d.organization_id = c.organization_id AND d.id = c.driver_id
JOIN employees e ON e.organization_id = d.organization_id AND e.id = d.employee_id
JOIN trucks t ON t.organization_id = c.organization_id AND t.id = c.truck_id
LEFT JOIN trailers tr ON tr.organization_id = c.organization_id AND tr.id = c.trailer_id
LEFT JOIN loads l ON l.organization_id = c.organization_id AND l.id = c.load_id
LEFT JOIN customers cu ON cu.organization_id = c.organization_id AND cu.id = c.claimant_customer_id
LEFT JOIN facilities f ON f.organization_id = c.organization_id AND f.id = c.claimant_facility_id
WHERE c.organization_id = $org
ORDER BY c.claim_number DESC;
```

Index: `claims_org_number_uq (organization_id, claim_number)`, scanned backwards. This statement carries the page's predicates, `LIMIT`/`OFFSET` and `count(*) OVER ()` (§1.2 statement 1); the summary is the separate SQL aggregate of §1.2 statement 2, never computed from the page.

## 7. Web mapping

The four Safety pages are `'use client'` components under the `/app/safety` layout, rendering fragments exactly as fleet-hr-safety §2.2 (no wrapper element). They fetch once with TanStack Query (the server page may pass `initialData` so the first paint has the data; Runtruck1 has no loading state), request **one bounded page** (`limit=500`), never send `q`, and filter locally with `matchesQuery` (`apps/web/src/lib/search.ts`) over the view-model rows below. Markup, classes and CSS are exactly fleet-hr-safety §8.1, §9.1, §10.1 and §11.1. The empty state is `Nothing matches “{query}”.` with the raw query, after the table (D6). Rows are not clickable.

**Label and tone maps** (web presentation, `Tag` tone; shared with the API's `q`, dependency R1):

| enum | value → label (tone) |
|---|---|
| `WorkOrderStatus` | `scheduled` → "Scheduled" (blue) · `due` → "Due" (amber) · `overdue` → "Overdue" (amber) · `in_shop` → "In shop" (amber) · `done` → "Done" (gray) |
| `DriverDocumentType` | `cdl` → "CDL" · `medical_card` → "Medical card" · `mvr` → "MVR" · `annual_review` → "Annual review" · `drug_test` → "Drug test" · `clearinghouse_query` → "Clearinghouse query" |
| `DriverDocumentStatus` | `valid` → "Valid" (green) · `expiring` → "Expiring" (amber) · `expired` → "Expired" (amber) · `missing` → "Missing" (amber) |
| `ComplianceDatePrecision` | `day` → `formatShortDate(date)` ("Sep 20") · `month` → `formatMonthYear(date)` ("Apr 2028") |
| `ViolationStatus` | `open` → "Open" (amber) · `contested` → "Contested" (blue) · `closed` → "Closed" (gray) |
| `ClaimType` | `cargo_damage` → "Cargo damage" · `property_damage` → "Property damage" · `bodily_injury` → "Bodily injury" · `cargo_shortage` → "Cargo shortage" |
| `ClaimStatus` | `open` → "Open" (amber) · `under_review` → "Under review" (blue) · `settled` → "Settled" (green) · `denied` → "Denied" (gray) |

**View-model convention** (as [fleet.md §5](fleet.md)): each table row is an object with **exactly** the Runtruck1 mock row's keys (minus `tagClass`), holding the same display strings and raw numbers, plus one key `ref` whose value is an object (`{ id, tone }`). `matchesQuery` only looks at string and number values, so `ref` is never searched and ids, enum values and cents can never match. React keys use `ref.id` (fleet-hr-safety H14).

**Loading, refused data and errors** (decision S6) follow the shared rule of [implementation-brief §4](../reference/implementation-brief.md) ("Loading, refusal and error states"). The sidebar shows Safety for `maintenance.view`, but Driver Documents and Violations need `compliance.view` and Settlements needs `claims.view` (07 §7): a Maintenance member opening Driver Documents, or a Dispatcher opening Settlements, gets 403. Pending and 403 render the tab bar, the four KPI cards with value "—" and no note, and the card with its table head, no rows and no empty-state line; any other error adds one `ui-empty` line with the API message.

### 7.1 Safety › Maintenance (`/app/safety/maintenance`)

Calls: `GET /api/v1/work-orders?limit=500`.

**Row view-model** (`WorkOrderRowVm`, Runtruck1 `WorkOrder`):

| key | type | from `WorkOrderRow` | seed (T-114) |
|---|---|---|---|
| `unit` | string | `unit.unitNumber` | "T-114" |
| `item` | string | `item` | "PM service A" |
| `due` | string | `dueOn !== null ? formatShortDate(dueOn) : formatInt(dueOdometer) + ' mi'` | "529,800 mi" (T-118: "Sep 5") |
| `shop` | string | `shop.name + ' · ' + shop.city` | "Sunridge shop · Modesto" |
| `estimate` | number | `estimateCents / 100` (whole dollars, raw, searched as digits) | 640 |
| `status` | string | status label | "Due" |
| `ref` | object | `{ id, tone }` | |

Cells: `td.strong` unit · `td` item · `td` due · `td.muted` shop · `td.num` `formatMoney(estimateCents)` · `td.num` `<Tag label={status} tone={ref.tone} />`.

Rendered rows (seed): T-118 · Turbocharger replacement · Sep 5 · Sunridge shop · Modesto · $4,850 · In shop; FB-12 · DOT annual inspection · Sep 3 · Sunridge shop · Modesto · $150 · In shop; T-121 · Brake adjustment · Aug 28 · Sunridge shop · Modesto · $420 · Overdue; T-114 · PM service A · 529,800 mi · Sunridge shop · Modesto · $640 · Due; RF-27 · Reefer unit service · Sep 12 · Thermo King · Fresno · $710 · Scheduled; T-107 · DOT annual inspection · Sep 18 · Valley Truck Center · Stockton · $185 · Scheduled; T-103 · Tire rotation · 342,000 mi · Sunridge shop · Modesto · $160 · Scheduled; T-109 · DOT annual inspection · Aug 22 · Valley Truck Center · Stockton · $185 · Done. Identical to Runtruck1's `MAINTENANCE`.

**KPIs**; `s = meta.summary`:

| label | value | note | seed |
|---|---|---|---|
| Open work orders | `String(s.openCount)` | `` `${s.doneLast30dCount} done · last 30 d` `` | 7 · "1 done · last 30 d" |
| In shop | `String(s.inShopCount)` | `` s.inShopShops.map(x => `${x.name} · ${x.city}`).join(', ') \|\| 'None' `` | 2 · "Sunridge shop · Modesto" |
| Overdue | `String(s.overdue.length)` | `` s.overdue.map(o => `${o.unitNumber} · ${o.item}`).join(', ') \|\| 'None' `` | 1 · "T-121 · Brake adjustment" |
| Est. cost open | `formatMoney(s.openEstimateCents)` | literal "Parts & labor, open orders" | "$7,115" |

Header: "Filters" and "+ Log Service" (primary) stay inert.

### 7.2 Safety › Driver Documents (`/app/safety/driver-documents`)

Calls: `GET /api/v1/driver-documents?limit=500`.

**Row view-model** (`DriverDocumentRowVm`, Runtruck1 `DriverDocument`):

| key | type | from `DriverDocumentRow` | seed (Marcus Hale's three) |
|---|---|---|---|
| `driver` | string | `driver.fullName` | "Marcus Hale" |
| `document` | string | document type label | "CDL" / "Medical card" / "Clearinghouse query" |
| `expires` | string | `expiresOn === null ? '—' : expiresPrecision === 'day' ? formatShortDate(expiresOn) : formatMonthYear(expiresOn)` | "Apr 2028" / "Mar 2027" / "Sep 20" |
| `status` | string | status label | "Valid" / "Valid" / "Expiring" |
| `ref` | object | `{ id, tone }` | |

Cells: `td.strong` driver · `td` document · `td` expires · `td.num` `<Tag label={status} tone={ref.tone} />`.

Rendered rows (seed): Marcus Hale CDL Apr 2028 Valid · Medical card Mar 2027 Valid · Clearinghouse query Sep 20 Expiring; Dara Whitfield CDL Nov 2027 Valid · Medical card Jun 2027 Valid; Ellis Nakamura CDL Feb 2027 Valid · Medical card Oct 12 Expiring; Priya Raman CDL Jul 2026 Expired · Medical card Jan 2028 Valid; Ana Cortez CDL Sep 2029 Valid · MVR Sep 24 Expiring · Annual review Sep 24 Expiring; Tobias Frey CDL Jan 2028 Valid · Medical card Dec 2026 Valid · Drug test — Missing. Identical to Runtruck1's `DRIVER_DOCUMENTS`.

**KPIs**; `s = meta.summary`:

| label | value | note | seed |
|---|---|---|---|
| Documents | `String(s.documentCount)` | `` `${s.driverCount} drivers on file` `` | 15 · "6 drivers on file" |
| Expiring (60 d) | `String(s.expiringCount)` | `` `Renew before ${formatShortDate(s.expiringWindowEnd)}` `` | 4 · "Renew before Nov 2" |
| Expired | `String(s.expired.length)` | `` s.expired.map(d => `${d.fullName} · ${documentLabel(d.documentType)}`).join(', ') \|\| 'None' `` | 1 · "Priya Raman · CDL" |
| Missing | `String(s.missing.length)` | `` s.missing.map(d => `${d.fullName} · ${documentLabel(d.documentType)}`).join(', ') \|\| 'None' `` | 1 · "Tobias Frey · Drug test" |

Header: "Filters" and "Request document" (primary) stay inert.

### 7.3 Fleet › Drivers "Compliance watchlist"

The Drivers page is specified in [fleet.md §5.1](fleet.md); this section only fixes what it reads from §4. Calls: `GET /api/v1/compliance-reminders?limit=500`. Rows in the order served, **not** filtered by the search (fleet-hr-safety §2.8).

**Row view-model** (`WatchItemVm`, Runtruck1 `WatchItem`):

| key | from `ComplianceReminderRow` | seed |
|---|---|---|
| `name` | `driver.fullName` | "Priya Raman" |
| `item` | `itemLabel` | "CDL renewal" |
| `due` | `duePrecision === 'day' ? formatShortDate(dueOn) : formatMonthYear(dueOn)` | "Jul 2026" |
| `ref` | `{ id }` | |

Rendered rows (seed): Priya Raman · CDL renewal · Jul 2026; Ellis Nakamura · Medical card · Oct 12; Ana Cortez · Annual MVR review · Sep 24; Marcus Hale · Clearinghouse query · Sep 20. "Docs to renew" = `String(meta.total)` = "4" · "On the watchlist below" (fleet.md F1: "—" and no rows when the call is refused).

### 7.4 Safety › Violations (`/app/safety/violations`)

Calls: `GET /api/v1/violations?limit=500`.

**Row view-model** (`ViolationRowVm`, Runtruck1 `Violation`):

| key | type | from `ViolationRow` | seed (first row) |
|---|---|---|---|
| `date` | string | `formatShortDate(occurredOn)` | "Aug 31" |
| `driver` | string | `driver.fullName` | "Tobias Frey" |
| `unit` | string | `truck.unitNumber` | "T-118" |
| `type` | string | `violationType` | "Log form & manner" |
| `severityPoints` | number | `severityPoints` (raw) | 1 |
| `location` | string | `location` | "I-70 POE · Loma, CO" |
| `status` | string | status label | "Open" |
| `ref` | object | `{ id, tone }` | |

Cells: `td` date (plain, **not** `strong`, D6) · `td.strong` driver · `td` unit · `td` type · `td.num` severityPoints · `td.muted` location · `td.num` `<Tag label={status} tone={ref.tone} />`.

Rendered rows (seed) are §5.5 with dates Aug 31, Aug 28, Aug 19, Jul 30, Jun 12, May 6, Mar 18 and labels Open, Open, Contested, Closed, Closed, Closed, Closed. Identical to Runtruck1's `VIOLATIONS`.

**KPIs**; `s = meta.summary`:

| label | value | note | seed |
|---|---|---|---|
| Open | `String(s.openCount)` | literal "Corrective action pending" | 2 |
| Points (12 mo) | `String(s.pointsInWindow)` | `` `CSA severity · ${s.violationsInWindowCount} violations` `` | 29 · "CSA severity · 7 violations" |
| Contested | `String(s.contestedCount)` | literal "DataQ challenge filed" | 1 |
| Closed | `String(s.closedCount)` | literal "Resolved, on file" | 4 |

Header: "Filters" and "+ Log Violation" (primary) stay inert.

### 7.5 Safety › Settlements = claims (`/app/safety/settlements`)

Calls: `GET /api/v1/claims?limit=500`.

**Row view-model** (`ClaimRowVm`, Runtruck1 `Claim`):

| key | type | from `ClaimRow` | seed (CLM-1108) |
|---|---|---|---|
| `id` | string | `formatClaimNumber(claimNumber)` (Runtruck1's `id` key holds the claim number; the uuid is in `ref.id`) | "CLM-1108" |
| `date` | string | `formatShortDate(occurredOn)` | "May 9" |
| `driver` | string | `driver.fullName` | "Ana Cortez" |
| `unit` | string | `trailer === null ? truck.unitNumber : truck.unitNumber + ' / ' + trailer.unitNumber` | "T-109 / FB-04" |
| `type` | string | claim type label | "Bodily injury" |
| `claimant` | string | `claimant.kind === 'third_party' ? 'Third party · ' + claimant.name : claimant.name` | "Third party · R. Delgado" |
| `reserved` | number | `reservedCents / 100` (whole dollars, raw) | 25000 |
| `paid` | number | `paidCents / 100` (whole dollars, raw; 0 when unpaid) | 18500 |
| `status` | string | status label | "Settled" |
| `ref` | object | `{ id, tone }` | |

Cells: `td.strong` id · `td` date · `td` driver · `td` unit · `td` type · `td` claimant · `td.num` `formatMoney(reservedCents)` · `td.num` `paidCents > 0 ? formatMoney(paidCents) : '—'` · `td.num` `<Tag label={status} tone={ref.tone} />`.

Rendered rows (seed): CLM-1112 · Aug 26 · Ellis Nakamura · T-121 / FB-12 · Cargo damage · Cascade Building Supply · $6,800 · — · Open; CLM-1111 · Aug 14 · Marcus Hale · T-114 / RF-88 · Cargo damage · Northgate Foods · $4,200 · — · Under review; CLM-1110 · Jul 22 · Dara Whitfield · T-107 / DV-51 · Property damage · Wasatch Crossdock · $2,900 · $2,650 · Settled; CLM-1109 · Jun 30 · Tobias Frey · T-118 / DV-14 · Cargo shortage · Sierra Ag Partners · $1,450 · — · Denied; CLM-1108 · May 9 · Ana Cortez · T-109 / FB-04 · Bodily injury · Third party · R. Delgado · $25,000 · $18,500 · Settled; CLM-1107 · Mar 3 · Priya Raman · T-103 / RF-27 · Cargo damage · Northgate Foods · $3,100 · $2,875 · Settled. Identical to Runtruck1's `CLAIMS`.

**KPIs**; `s = meta.summary`:

| label | value | note | seed |
|---|---|---|---|
| Open claims | `String(s.openCount)` | `` `${s.underReviewCount} under review` `` | 2 · "1 under review" |
| Reserved | `formatMoney(s.openReservedCents)` | literal "On open claims" | "$11,000" |
| Paid YTD | `formatMoney(s.paidYtdCents)` | `` `${s.paidYtdCount} settlements` `` | "$24,025" · "3 settlements" |
| Settled | `String(s.settledCount)` | `` `${s.deniedCount} denied` `` | 3 · "1 denied" |

Header: "Filters" and "+ New Claim" (primary) stay inert.

## 8. Stub controls and future writes (not implemented, 01 §7)

"+ Log Service" (and Fleet › Trucks "Log service"), "Request document", "+ Log Violation" and "+ New Claim" stay inert and call nothing. When they are built, each is a write in one transaction with Zod validation, a state-machine check (architecture §18), an audit row and an outbox event (04 §7); the event rows are then added to [17-event-architecture.md §5](../17-event-architecture.md):

| control | endpoint | permission | audit action | event (payload) |
|---|---|---|---|---|
| + Log Service / Log service | `POST /work-orders` | `maintenance.create` | `WORK_ORDER_CREATED` | `WorkOrderCreated` (`workOrderId`, `truckId?`, `trailerId?`, `status`) |
| (work-order status) | `POST /work-orders/:id/status` along `scheduled/due → in_shop → done`, `→ overdue` | `maintenance.update` | `WORK_ORDER_STATUS_CHANGED` | `WorkOrderStatusChanged` (`workOrderId`, `from`, `to`) |
| Request document | `POST /driver-documents/requests` `{ driverId, documentType }` | `compliance.create` | `DRIVER_DOCUMENT_REQUESTED` | `DriverDocumentRequested` (`driverId`, `documentType`); a notification job reacts (architecture §22) |
| + Log Violation | `POST /violations` | `compliance.create` | `VIOLATION_RECORDED` | `ViolationRecorded` (`violationId`, `driverId`, `truckId`, `severityPoints`) |
| + New Claim | `POST /claims` (number from `organization_counters` key `claim`; the next is CLM-1113) | `claims.create` | `CLAIM_OPENED` | `ClaimOpened` (`claimId`, `claimNumber`, `claimType`) |
| (claim status) | `POST /claims/:id/status` along `open → under_review → settled/denied` | `claims.update` | `CLAIM_STATUS_CHANGED` | `ClaimStatusChanged` (`claimId`, `from`, `to`, `paidCents?`) |

## 9. Tests

- **Integration** (`apps/api/test`, seeded by `seedTestFixtures`):
  - each endpoint returns the seed rows of §2.5, §3.5, §4.5, §5.5 and §6.5 in order, and the summaries of §2.4, §3.4, §4.4, §5.4 and §6.4;
  - `q`: work orders "4850" → T-118, "$4,850" → 0, "485000" → 0, "342,000" → T-103; driver documents "—" → Tobias Frey drug test, "2026" → 2 rows, "sep 2" → 4; violations "cottonwood" → 1, "log form" → 2; claims "18500" → CLM-1108, "$18,500" → 0, "northgate" → 2; reminders "sep 2" → 2; each equals `matchesQuery` over the §7 view-models;
  - `status=in_shop` → 2 work orders, `status=expiring` → 4 documents, `status=closed` → 4 violations, `status=settled` → 3 claims, each with an unchanged summary;
  - `limit`/`offset`/`meta.total`; `limit=501`, `offset=-1`, `status=bogus` → 400 `VALIDATION_ERROR` naming the parameter;
  - permissions (existing fixtures, `packages/database/src/testing`): the Dispatcher → 200 on `/work-orders`, `/driver-documents`, `/compliance-reminders`, `/violations` and 403 `FORBIDDEN` on `/claims`; the Accounting and Driver members → 403 on all five; no session → 401;
  - a "Test Carrier Co" member sees only its own fixture rows (01 C10: one per table) and a summary over them on each, never Sunridge's rows.
- **Unit:** window boundaries (a done order completed exactly `today − 30` counts, the day before does not; a violation on `today − 1 year` is outside, the next day inside; Feb 29 → Feb 28; a paid claim dated Dec 31 of last year is outside YTD); `inShopShops` distinct by facility in row order; claimant label for each kind; `estimate`/`reserved`/`paid` whole-dollar view-model values.

## 10. Differences from Runtruck1 (D5)

None. Every Safety and watchlist value computed from the seed equals Runtruck1's (03 §6.9, §8): Maintenance 7 · "1 done · last 30 d", 2 · "Sunridge shop · Modesto", 1 · "T-121 · Brake adjustment", "$7,115"; Driver Documents 15 · "6 drivers on file", 4 · "Renew before Nov 2", 1 · "Priya Raman · CDL", 1 · "Tobias Frey · Drug test"; Violations 2, 29 · "CSA severity · 7 violations", 1, 4; Claims 2 · "1 under review", "$11,000", "$24,025" · "3 settlements", 3 · "1 denied"; Docs to renew 4; every row string.

## 11. Decisions and dependencies

**Decisions made in this document** (to record in 01 §6):

| # | Decision | Why |
|---|---|---|
| S1 | `GET /compliance-reminders` serves only Fleet › Drivers. The Dashboard shows no watchlist. | The design brief §2 row says "Dashboard and Drivers tab", but Runtruck1's `DashboardPage.tsx` never renders `COMPLIANCE`/`WATCHLIST` (only `DriversTab.tsx` does). R1/D6 parity wins, as in [dashboard.md §6](dashboard.md) decision 1. Needs the product owner's confirmation. |
| S2 | `claims.view` covers the claimant's customer/facility name and the claim's load number; `compliance.view` covers the driver and truck names on documents, reminders and violations; `maintenance.view` covers unit numbers and shop names. | They are fields of Runtruck1's rows; requiring `customers.view`/`locations.view`/`loads.view` would blank cells for Maintenance and Dispatcher members (same reasoning as fleet.md F2). |
| S3 | Statuses are read as stored; "Overdue", "Expiring (60 d)" and "Expired" count stored statuses, and the only clock-dependent parts are the windows of §1.1 and the note "Renew before {today + 60}". | Design brief §2 and 03 §1.7; the derivation rules of fleet-hr-safety §8.4/§9.3 are not adopted. |
| S4 | "In shop" note: shops distinct by facility (not by label), in row order. | Facility names are unique per organization (case-insensitive, `facilities_org_name_uq`, 03 §5), so distinct-by-facility and Runtruck1's distinct-by-label give the same list; keying by facility id keeps the rule independent of labels. Identical for the seed. |
| S5 | "Paid YTD" filters paid claims by the claim date (`occurred_on`), because no claim payment date is stored (03 §6.9). A claim paid this year for an incident dated last year is excluded. | Keeps D5 without a schema change; a `paid_on` column (and `claims_paid_ck`) is the fix when claim settlement is built (§8). |
| S6 | Loading, refusal (403) and error states follow implementation-brief §4 (pending and 403: KPI values "—" without notes, table head, no rows, no empty-state line; other errors: one `ui-empty` line with the message). | Reachable (07 §7: Safety is gated by `maintenance.view` only); Runtruck1 has no error UI. One rule for every page, as hr.md H4 and fleet.md F1. |
| S7 | Compliance and dispatch: Priya Raman's expired CDL and Tobias Frey's missing drug test are served as stored (fleet-hr-safety B7). The loads group applied D6 for this release: `POST /loads` does not refuse such a driver ([09 §3](../09-dispatch-lifecycle.md) rule D3 "block once compliance data is maintained", [loads.md](loads.md) L12). Because this weighs D6 against architecture §19 ("relevant compliance constraints"), it is recorded in 01 §6 as **needing the product owner's confirmation**. | D6 versus architecture §19; must not be resolved silently (§49). |

**Dependencies on other groups:**

| # | Needed from | Change |
|---|---|---|
| R1 | `@runtruck/calculations` owner | Export the enum label maps of §7 (and hr.md §4) and the row view-model builders from a runtime package the API and the web both import, so server `q` and the web search use identical strings (03 §1.11). |
| R2 | fleet group | [fleet.md §5.1](fleet.md) already reads `GET /compliance-reminders` (`meta.total`, row order, `due` rule); no change needed beyond keeping F1 aligned with S6. |
| R3 | loads group | S7: decided for this release by 09 §3 D3 / loads.md L12 (deferred, D6); awaiting the product owner (01 §6). |
| R4 | `docs/07-roles-permissions.md` owner | §2.1: add S2's coverage for `claims.view`, `compliance.view` and `maintenance.view`. |
| R5 | `docs/01-product-requirements.md` owner | §6: record S1–S7. |
