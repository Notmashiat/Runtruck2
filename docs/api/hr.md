# API — HR (employee contracts, onboarding)

Endpoint specification for HR › Employee Contracts and HR › Onboarding. It follows the conventions of [04-api.md](../04-api.md) (envelopes, errors, lists, formats) and computes every value by the rules of [03-database.md §6.8](../03-database.md) (D5). Where this document and 03 disagree, 03 wins (architecture §49) and the conflict must be raised. The screens are specified in [reference/runtruck1/fleet-hr-safety.md](../reference/runtruck1/fleet-hr-safety.md) §6–§7.

- Wire types: `packages/types/src/hr.ts`. Input schemas: `packages/validation/src/hr.ts`.
- API module (architecture §6): `apps/api/src/hr/` (`contracts.controller.ts`, `onboarding.controller.ts`, `hr.service.ts`, `hr.repository.ts`, `hr.module.ts`), registered in `apps/api/src/modules/hr-safety.ts`.

## 0. Feature summary (architecture §44)

| item | content |
|---|---|
| FEATURE | HR read views: the employee contracts on file and the onboarding pipeline, each with its KPI row. |
| PURPOSE | Runtruck1 parity (R1) with the data served from PostgreSQL (R2). |
| USERS | Owners, admins and managers (the roles holding `hr.view`, [07 §3](../07-roles-permissions.md)). |
| PERMISSIONS | `hr.view` for both endpoints. It also covers contract pay basis (rates and salaries), decision H1. |
| DATABASE TABLES | read: `employee_contracts`, `employees`, `onboarding_cases`, `onboarding_document_requests`. |
| DATABASE CHANGES | none. |
| API ENDPOINTS | `GET /hr/contracts`, `GET /hr/onboarding`. |
| BUSINESS RULES | 03 §6.0.1 (clock, org week, quarter), §6.0.6 (pay basis), §6.0.8 (onboarding next step, owner), §6.8 (KPIs). |
| STATE CHANGES / EVENTS / JOBS / NOTIFICATIONS / INTEGRATIONS / AI | none. Both screens are read-only; "+ New Contract" and "+ Start Onboarding" are inert stubs (§5). |
| SECURITY | session auth, `hr.view` guard, organization from the session only, no internal details in errors. Candidate names and pay are personal/financial data: served only to `hr.view` holders, never logged. |
| ERROR CASES | §1.5. |
| TESTS | §6. |
| ACCEPTANCE CRITERIA | the seed renders exactly the strings of §4 (every value equals Runtruck1, §7); tenant isolation and permission denial proven by integration tests; architecture §45. |

## 1. Rules shared by both endpoints

### 1.1 Clock and windows

`today = ClockService.today(ctx.timezone)` (D4; 2026-09-03 for the seed). The **org week** is the Monday–Sunday week containing `today`: `weekStart = today − ((isoWeekday(today) + 6) mod 7)` days (Mon = 1 … Sun = 7), `weekEnd = weekStart + 6` (2026-08-31 … 2026-09-06). The **quarter start** is the first day of `today`'s calendar quarter (2026-07-01). Nothing reads the server's own date. Date arithmetic is done on `YYYY-MM-DD` strings in UTC (`addDaysIso`, `@runtruck/calculations`), never through local `Date`.

### 1.2 List mechanics

- Query: `limit` (1–500, default 100), `offset` (≥ 0), `q` (trimmed, ≤ 200 characters), plus the per-endpoint filter below. Validated by the named Zod schema through `ZodValidationPipe`; unknown parameters are ignored.
- The service reads **every row of the organization** with one statement per request (§2.7, §3.7; HR lists are reference-size, tens to a few hundred rows; [04 §5.1](../04-api.md) rule 2). It then:
  1. computes `meta.summary` over **all** rows. The summary ignores `q` and the filter, because Runtruck1's search never changes a KPI (03 §6);
  2. applies the filter, then `q` (§1.3; at most the first 5,000 rows are matched, 04 §5.1);
  3. sets `meta.total` to the filtered count and returns `data = rows.slice(offset, offset + limit)`.
- Response: `{ data: Row[], meta: { total, limit, offset, summary } }` (04 §2).
- If an organization ever exceeds ~5,000 rows on one of these lists, filtering and paging move into SQL. That is a performance change only; the contract stays the same.

### 1.3 Server-side `q`

`q` reproduces Runtruck1's `matchesQuery` (fleet-hr-safety §2.8): `needle = q.trim().toLowerCase()`; an empty needle matches everything; otherwise a row matches when any of its **searchable values** contains the needle after lowercasing. The searchable values are exactly the string and number values of the row's view-model (§4.1, §4.2), built with the same label maps and `@runtruck/calculations` formatters the web uses. Raw numbers Runtruck1 kept as numbers (onboarding `progress`) are matched as their decimal digits. Ids, enum values, cents and basis points are never searched; the boolean `docsPending` is not searched.

The web does not send `q`; it filters the rows it holds with the same rule on the same view-model, so both paths give identical results. The label maps and view-model builders are shared runtime code (dependency R1 in §8).

### 1.4 Tenancy

Every statement filters `organization_id = ctx.organizationId` on **every** table it reads, and every join also matches `organization_id` on both sides (`employees.organization_id = employee_contracts.organization_id AND employees.id = employee_contracts.employee_id`). The composite tenant foreign keys (03 §1.3) make a cross-tenant reference impossible even if a join condition were missing. No endpoint accepts an organization id. A member of another organization sees only that organization's rows. The "Test Carrier Co" fixture (01 C10) has one row in every table, so its member sees exactly its own rows and a summary over them, never Sunridge's.

### 1.5 Errors

| HTTP | code | when |
|---|---|---|
| 400 | `VALIDATION_ERROR` | `limit` outside 1–500, negative or non-integer `offset`, `q` longer than 200, an unknown `status`/`stage` value or a repeated one (`?status=a&status=b`). `issues[]` names the parameter. |
| 401 | `UNAUTHORIZED` | no or expired session. |
| 403 | `FORBIDDEN` | the member lacks `hr.view`. |
| 403 | `NO_ACTIVE_MEMBERSHIP` | the account has no active organization. |
| 500 | `INTERNAL_ERROR` | anything unexpected (logged with the request id; no details returned). |

There is no 404: these are collection reads.

### 1.6 Audit and events

None. Both endpoints are reads, and reads are not audited (architecture §30 audits changes). The writes behind the stub buttons are listed in §5.

## 2. `GET /api/v1/hr/contracts`

| | |
|---|---|
| Permission | `hr.view` |
| Query | `listEmployeeContractsQuerySchema` → `ListEmployeeContractsQuery`: `limit`, `offset`, `q`, and `status?: 'active' \| 'renewal_due' \| 'expiring' \| 'draft'` (one value; the web does not send it). |
| Response | `EmployeeContractsResponse` = `{ data: EmployeeContractRow[], meta: EmployeeContractsMeta }` |
| Consumers | HR › Employee Contracts. |

### 2.1 `EmployeeContractRow`

| field | type | computed from |
|---|---|---|
| `id` | `string` (uuid) | `employee_contracts.id` |
| `employee` | `HrEmployeeRef` = `{ id, fullName }` | `employees.id`; `first_name + ' ' + last_name` via `employee_contracts.employee_id` |
| `role` | `EmployeeRole` | `employee_contracts.role` |
| `contractType` | `EmployeeContractType` | `employee_contracts.contract_type` |
| `status` | `EmployeeContractStatus` | `employee_contracts.status` (stored lifecycle status, design brief §2; never re-derived from the clock) |
| `startsOn` | `string` (`YYYY-MM-DD`) | `employee_contracts.starts_on` |
| `renewsOn` | `string` (`YYYY-MM-DD`) | `employee_contracts.renews_on` |
| `payBasis` | `EmployeeContractPayBasis` | `employee_contracts.pay_basis` |
| `payRateCents` | `number \| null` | `employee_contracts.pay_rate_cents` (null for `percent_of_line_haul`) |
| `payPercentBp` | `number \| null` | `employee_contracts.pay_percent_bp` (set only for `percent_of_line_haul`) |

The CHECK `employee_contracts_pay_ck` guarantees exactly one of `payRateCents` / `payPercentBp` is set, matching `payBasis`.

### 2.2 Order

`ORDER BY employee_contracts.position, employee_contracts.id`: Marcus Hale, Dara Whitfield, Ellis Nakamura, Priya Raman, Ana Cortez, Tobias Frey, Rosa Medina, Luis Ortega, Evan Brooks, Jamal Reed (Runtruck1's `CONTRACTS` order).

### 2.3 Searchable fields (`q`)

The Runtruck1 `Contract` fields except `tagClass`, as display strings (view-model §4.1): `employee`, `role` (label), `type` (label), `start` and `renews` (F-DATE against `today`), `payBasis` (§6.0.6 string), `status` (label). So "2027" matches the 7 contracts whose Start or Renews shows 2027, "w-2" matches the 9 W-2 contracts and "w2" matches nothing.

### 2.4 `meta.summary`: `EmployeeContractsSummary`

Computed over all of the organization's contracts (never filtered by `q` or `status`). `EmployeeContractKpiEntry` = `{ contractId, employeeId, fullName, lastName (employees.last_name), contractType, startsOn, renewsOn }`.

| field | type | formula | seed |
|---|---|---|---|
| `asOf` | `string` | `today` | `"2026-09-03"` |
| `contractCount` | `number` | count of contracts | 10 |
| `activeCount` | `number` | count `status = 'active'` | 6 |
| `renewalsDue` | `EmployeeContractKpiEntry[]` | contracts with `status = 'renewal_due'`, `ORDER BY renews_on, position, id` | Priya Raman (Raman, 2026-09-20), Ellis Nakamura (Nakamura, 2026-10-01) |
| `ownerOperators` | `EmployeeContractKpiEntry[]` | contracts with `role = 'owner_operator'`, in list order | Tobias Frey (Frey, `lease_purchase`, renews 2026-11-15) |
| `drafts` | `EmployeeContractKpiEntry[]` | contracts with `status = 'draft'`, in list order | Jamal Reed (Reed, starts 2026-09-08) |

The KPI values are the counts and list lengths; the web composes the notes (§4.1). "Renewals due (30 d)" counts the stored `renewal_due` status, not a date window (design brief §2: contract "Renewal due" is a stored status; counts are computed). All values equal Runtruck1's.

Example `meta`:

```json
{ "total": 10, "limit": 500, "offset": 0,
  "summary": { "asOf": "2026-09-03", "contractCount": 10, "activeCount": 6,
    "renewalsDue": [
      { "contractId": "…", "employeeId": "…", "fullName": "Priya Raman", "lastName": "Raman", "contractType": "w2", "startsOn": "2024-09-20", "renewsOn": "2026-09-20" },
      { "contractId": "…", "employeeId": "…", "fullName": "Ellis Nakamura", "lastName": "Nakamura", "contractType": "w2", "startsOn": "2023-10-01", "renewsOn": "2026-10-01" }],
    "ownerOperators": [
      { "contractId": "…", "employeeId": "…", "fullName": "Tobias Frey", "lastName": "Frey", "contractType": "lease_purchase", "startsOn": "2023-11-15", "renewsOn": "2026-11-15" }],
    "drafts": [
      { "contractId": "…", "employeeId": "…", "fullName": "Jamal Reed", "lastName": "Reed", "contractType": "w2", "startsOn": "2026-09-08", "renewsOn": "2027-09-08" }] } }
```

### 2.5 Rows against the seed

| employee | role | contractType | status | startsOn | renewsOn | payBasis | payRateCents / payPercentBp |
|---|---|---|---|---|---|---|---|
| Marcus Hale | company_driver | w2 | active | 2022-03-14 | 2027-03-14 | per_mile | 62 / null |
| Dara Whitfield | company_driver | w2 | active | 2021-08-02 | 2027-08-02 | per_mile | 60 / null |
| Ellis Nakamura | company_driver | w2 | renewal_due | 2023-10-01 | 2026-10-01 | percent_of_line_haul | null / 2500 |
| Priya Raman | company_driver | w2 | renewal_due | 2024-09-20 | 2026-09-20 | per_mile | 58 / null |
| Ana Cortez | company_driver | w2 | active | 2026-01-12 | 2027-01-12 | per_mile | 58 / null |
| Tobias Frey | owner_operator | lease_purchase | expiring | 2023-11-15 | 2026-11-15 | per_mile | 118 / null |
| Rosa Medina | dispatcher | w2 | active | 2020-06-06 | 2027-06-06 | annual_salary | 6800000 / null |
| Luis Ortega | mechanic | w2 | active | 2023-02-09 | 2027-02-09 | hourly | 3450 / null |
| Evan Brooks | dispatcher | w2 | active | 2026-07-27 | 2027-07-27 | annual_salary | 5200000 / null |
| Jamal Reed | company_driver | w2 | draft | 2026-09-08 | 2027-09-08 | per_mile | 56 / null |

Example item:

```json
{ "id": "…", "employee": { "id": "…", "fullName": "Ellis Nakamura" }, "role": "company_driver", "contractType": "w2",
  "status": "renewal_due", "startsOn": "2023-10-01", "renewsOn": "2026-10-01",
  "payBasis": "percent_of_line_haul", "payRateCents": null, "payPercentBp": 2500 }
```

### 2.6 Why not derive the status

fleet-hr-safety §6.3 notes that the four statuses could be derived (draft = unsigned, expiring = fixed term, renewal due = auto-renewing within 30 days). The design brief (§2) makes them stored lifecycle facts, so the API reads them. A future job that moves `active → renewal_due` near the renewal date is a state transition (architecture §18) with an audit row and an event (§5); it is not in this release.

### 2.7 Query plan (no N+1)

One statement per request, whatever the number of contracts:

```sql
SELECT c.id, c.role, c.contract_type, c.status, c.starts_on, c.renews_on,
       c.pay_basis, c.pay_rate_cents, c.pay_percent_bp,
       e.id AS employee_id, e.first_name, e.last_name
FROM employee_contracts c
JOIN employees e ON e.organization_id = c.organization_id AND e.id = c.employee_id
WHERE c.organization_id = $org
ORDER BY c.position, c.id;
```

Indexes: `employee_contracts_org_position_idx`, `employees_org_id_uq`. The summary, filter, `q` and page are computed in memory from these rows.

## 3. `GET /api/v1/hr/onboarding`

| | |
|---|---|
| Permission | `hr.view` |
| Query | `listOnboardingCasesQuerySchema` → `ListOnboardingCasesQuery`: `limit`, `offset`, `q`, and `stage?: 'application' \| 'background_check' \| 'road_test' \| 'orientation' \| 'complete'` (one value; the web does not send it). |
| Response | `OnboardingCasesResponse` = `{ data: OnboardingCaseRow[], meta: OnboardingCasesMeta }` |
| Consumers | HR › Onboarding. |

### 3.1 `OnboardingCaseRow`

| field | type | computed from |
|---|---|---|
| `id` | `string` (uuid) | `onboarding_cases.id` |
| `candidateName` | `string` | `onboarding_cases.candidate_name` |
| `employeeId` | `string \| null` | `onboarding_cases.employee_id` |
| `role` | `EmployeeRole` | `onboarding_cases.role` |
| `stage` | `OnboardingStage` | `onboarding_cases.stage` |
| `startedOn` | `string` (`YYYY-MM-DD`) | `onboarding_cases.started_on` |
| `owner` | `HrEmployeeRef` = `{ id, fullName }` | the `owner_employee_id` employee, `first_name + ' ' + last_name` |
| `progressPercent` | `number` (0–100) | `onboarding_cases.progress_percent` |
| `nextStep` | `string` | `onboarding_cases.next_step` |
| `nextStepOn` | `string \| null` | `onboarding_cases.next_step_on` |
| `completedOn` | `string \| null` | `onboarding_cases.completed_on` (set iff `complete`, `onboarding_cases_completed_ck`) |
| `pendingDocumentLabels` | `string[]` | `label` of the case's `onboarding_document_requests` with `status = 'pending'`, `ORDER BY position`; `[]` when none |

### 3.2 Order

`ORDER BY onboarding_cases.position, onboarding_cases.id`: Jamal Reed, Sofia Nguyen, Derek Holt, Kevin Brandt, Maya Patel, Evan Brooks (Runtruck1's `ONBOARDING` order).

### 3.3 Searchable fields (`q`)

The Runtruck1 `Onboarding` fields except `tagClass` and the boolean `docsPending` (view-model §4.2): `candidate`, `role` (label), `stage` (label), `started` (F-SHORT), `owner`, `progress` as its raw digits, `nextStep` (with its " · Sep 5" suffix). So "85" matches only Jamal Reed, "sep 4" matches Sofia Nguyen and Maya Patel, and "true" matches nothing.

### 3.4 `meta.summary`: `OnboardingCasesSummary`

Computed over all of the organization's cases (never filtered by `q` or `stage`).

| field | type | formula | seed |
|---|---|---|---|
| `asOf` | `string` | `today` | `"2026-09-03"` |
| `weekStart`, `weekEnd` | `string` | the org week (§1.1) | `"2026-08-31"`, `"2026-09-06"` |
| `quarterStart` | `string` | first day of today's calendar quarter | `"2026-07-01"` |
| `caseCount` | `number` | count of cases | 6 |
| `inProgressCount` | `number` | count `stage <> 'complete'` | 5 |
| `inOrientationCount` | `number` | count `stage = 'orientation'` | 1 |
| `startedThisWeekCount` | `number` | count `started_on BETWEEN weekStart AND weekEnd` | 2 (Kevin Brandt 09-01, Maya Patel 09-02) |
| `awaitingDocuments` | `OnboardingAwaitingDocuments[]` | cases with at least one `pending` request, in list order; each `{ caseId, candidateName, firstPendingLabel }` where `firstPendingLabel` is the lowest-position pending `label` | `[{ candidateName: "Derek Holt", firstPendingLabel: "MVR consent" }, { candidateName: "Kevin Brandt", firstPendingLabel: "medical card" }]` |
| `completedThisQuarterCount` | `number` | count `stage = 'complete' AND completed_on >= quarterStart` | 1 (Evan Brooks, 07-27) |

Runtruck1 counted every Complete row with no date filter (fleet-hr-safety B3); the API applies the quarter as 03 §6.8 requires, and the seed gives the same 1. All values equal Runtruck1's.

### 3.5 Rows against the seed

| candidateName | role | stage | startedOn | owner | progressPercent | nextStep · nextStepOn | completedOn | pendingDocumentLabels |
|---|---|---|---|---|---|---|---|---|
| Jamal Reed | company_driver | orientation | 2026-08-17 | Rosa Medina | 85 | Ride-along with Ana Cortez · 2026-09-05 | null | [] |
| Sofia Nguyen | company_driver | road_test | 2026-08-24 | Luis Ortega | 60 | Road test in T-103 · 2026-09-04 | null | [] |
| Derek Holt | owner_operator | background_check | 2026-08-28 | Rosa Medina | 35 | Waiting on MVR consent and insurance certificate · null | null | ["MVR consent", "insurance certificate"] |
| Kevin Brandt | company_driver | background_check | 2026-09-01 | Rosa Medina | 30 | Waiting on medical card copy · null | null | ["medical card"] |
| Maya Patel | company_driver | application | 2026-09-02 | Rosa Medina | 10 | Phone screen · 2026-09-04 | null | [] |
| Evan Brooks | dispatcher | complete | 2026-07-13 | Rosa Medina | 100 | 90-day review · 2026-10-25 | 2026-07-27 | [] |

`employeeId` is set for Jamal Reed and Evan Brooks, null for the others.

Example item:

```json
{ "id": "…", "candidateName": "Derek Holt", "employeeId": null, "role": "owner_operator", "stage": "background_check",
  "startedOn": "2026-08-28", "owner": { "id": "…", "fullName": "Rosa Medina" }, "progressPercent": 35,
  "nextStep": "Waiting on MVR consent and insurance certificate", "nextStepOn": null, "completedOn": null,
  "pendingDocumentLabels": ["MVR consent", "insurance certificate"] }
```

### 3.6 Tenancy note

The owner and the linked employee are read through composite tenant FKs (`onboarding_cases_owner_fk`, `onboarding_cases_employee_fk`), and the pending requests through `onboarding_document_requests_case_fk`; each join below also matches `organization_id`.

### 3.7 Query plan (no N+1)

One statement per request; the pending labels are aggregated per case in a lateral subquery, never fetched per row:

```sql
SELECT oc.id, oc.candidate_name, oc.employee_id, oc.role, oc.stage, oc.started_on,
       oc.progress_percent, oc.next_step, oc.next_step_on, oc.completed_on,
       ow.id AS owner_id, ow.first_name AS owner_first_name, ow.last_name AS owner_last_name,
       coalesce(req.pending_labels, '{}') AS pending_labels
FROM onboarding_cases oc
JOIN employees ow ON ow.organization_id = oc.organization_id AND ow.id = oc.owner_employee_id
LEFT JOIN LATERAL (
  SELECT array_agg(r.label ORDER BY r.position) AS pending_labels
  FROM onboarding_document_requests r
  WHERE r.organization_id = oc.organization_id AND r.onboarding_case_id = oc.id AND r.status = 'pending'
) req ON true
WHERE oc.organization_id = $org
ORDER BY oc.position, oc.id;
```

Indexes: `onboarding_cases_org_position_idx`, `onboarding_document_requests_case_position_uq` (organization-leading since migration `0002`), `employees_org_id_uq`. The summary is computed in memory.

## 4. Web mapping

Both pages are `'use client'` components under the `/app/hr` layout, rendering fragments exactly as fleet-hr-safety §2.2 (no wrapper element). They fetch once with TanStack Query (the server page may pass `initialData` so the first paint has the data; Runtruck1 has no loading state), request **one bounded page** (`limit=500`), never send `q`, and filter locally with `matchesQuery` (`apps/web/src/lib/search.ts`) over the view-model rows below. Markup, classes and CSS are exactly fleet-hr-safety §6.1 and §7.1. The empty state is `Nothing matches “{query}”.` with the raw query, after the table (D6).

**Label and tone maps** (web presentation, `Tag` tone; shared with the API's `q`, dependency R1):

| enum | value → label (tone) |
|---|---|
| `EmployeeRole` | `company_driver` → "Company driver" · `owner_operator` → "Owner-operator" · `dispatcher` → "Dispatcher" · `mechanic` → "Mechanic" |
| `EmployeeContractType` | `w2` → "W-2" · `form_1099` → "1099" · `lease_purchase` → "Lease-purchase" |
| `EmployeeContractStatus` | `active` → "Active" (green) · `renewal_due` → "Renewal due" (amber) · `expiring` → "Expiring" (amber) · `draft` → "Draft" (gray) |
| `OnboardingStage` | `application` → "Application" (gray) · `background_check` → "Background check" (amber) · `road_test` → "Road test" (blue) · `orientation` → "Orientation" (blue) · `complete` → "Complete" (green) |

**Pay basis** (03 §6.0.6), `formatPayBasis(payBasis, payRateCents, payPercentBp)` (dependency R2): `per_mile` → `` `$${(payRateCents / 100).toFixed(2)} / mi` `` ("$0.62 / mi"); `percent_of_line_haul` → `` `${payPercentBp / 100}% of line haul` `` ("25% of line haul"); `annual_salary` → `` `${formatMoney(payRateCents)} / yr` `` ("$68,000 / yr"); `hourly` → `` `$${(payRateCents / 100).toFixed(2)} / hr` `` ("$34.50 / hr").

**View-model convention** (as [fleet.md §5](fleet.md)): each table row is an object with **exactly** the Runtruck1 mock row's keys (minus `tagClass`), holding the same display strings and raw numbers, plus one key `ref` whose value is an object (`{ id, tone }`). `matchesQuery` only looks at string and number values, so `ref` is never searched and ids, enum values and cents can never match. React keys use `ref.id` (fleet-hr-safety H14).

**Loading, refused data and errors** follow the shared rule of [implementation-brief §4](../reference/implementation-brief.md) ("Loading, refusal and error states"). For these pages that means: pending or 403 (a member without `hr.view` who types the URL; the sidebar already hides HR) renders the tab bar, the four KPI cards with value "—" and no note, and the card with its table head, no rows and no empty-state line; any other error adds one `ui-empty` line with the API message (decision H4). Runtruck1 has no error UI.

### 4.1 HR › Employee Contracts (`/app/hr/employee-contracts`)

Calls: `GET /api/v1/hr/contracts?limit=500`.

**Row view-model** (`EmployeeContractRowVm`, Runtruck1 `Contract`); `asOf = meta.summary.asOf`:

| key | type | from `EmployeeContractRow` | seed (Marcus Hale / Ellis Nakamura) |
|---|---|---|---|
| `employee` | string | `employee.fullName` | "Marcus Hale" |
| `role` | string | role label | "Company driver" |
| `type` | string | contract type label | "W-2" |
| `start` | string | `formatDate(startsOn, asOf)` | "Mar 14, 2022" (Ana: "Jan 12") |
| `renews` | string | `formatDate(renewsOn, asOf)` | "Mar 14, 2027" (Ellis: "Oct 1") |
| `payBasis` | string | `formatPayBasis(payBasis, payRateCents, payPercentBp)` | "$0.62 / mi" (Ellis: "25% of line haul") |
| `status` | string | status label | "Active" (Ellis: "Renewal due") |
| `ref` | object | `{ id, tone }` | |

Cells: `td.strong` employee · `td` role · `td` type · `td` start · `td` renews · `td.muted` payBasis · `td.num` `<Tag label={status} tone={ref.tone} />`. Rows: `vms.filter(r => matchesQuery(r, query))`.

Rendered rows (seed), in order: Marcus Hale · Company driver · W-2 · Mar 14, 2022 · Mar 14, 2027 · $0.62 / mi · Active; Dara Whitfield · … · Aug 2, 2021 · Aug 2, 2027 · $0.60 / mi · Active; Ellis Nakamura · … · Oct 1, 2023 · Oct 1 · 25% of line haul · Renewal due; Priya Raman · … · Sep 20, 2024 · Sep 20 · $0.58 / mi · Renewal due; Ana Cortez · … · Jan 12 · Jan 12, 2027 · $0.58 / mi · Active; Tobias Frey · Owner-operator · Lease-purchase · Nov 15, 2023 · Nov 15 · $1.18 / mi · Expiring; Rosa Medina · Dispatcher · W-2 · Jun 6, 2020 · Jun 6, 2027 · $68,000 / yr · Active; Luis Ortega · Mechanic · W-2 · Feb 9, 2023 · Feb 9, 2027 · $34.50 / hr · Active; Evan Brooks · Dispatcher · W-2 · Jul 27 · Jul 27, 2027 · $52,000 / yr · Active; Jamal Reed · Company driver · W-2 · Sep 8 · Sep 8, 2027 · $0.56 / mi · Draft. Identical to Runtruck1's `CONTRACTS`.

**KPIs** (label · value · note); `s = meta.summary`:

| label | value | note | seed |
|---|---|---|---|
| Active contracts | `String(s.activeCount)` | `` `${s.contractCount} on file` `` | 6 · "10 on file" |
| Renewals due (30 d) | `String(s.renewalsDue.length)` | `` s.renewalsDue.map(c => `${c.lastName} ${formatDate(c.renewsOn, s.asOf)}`).join(' · ') \|\| 'None' `` | 2 · "Raman Sep 20 · Nakamura Oct 1" |
| Owner-operators | `String(s.ownerOperators.length)` | `` s.ownerOperators.map(c => `${c.lastName} · ${typeLabel(c.contractType).toLowerCase()} ends ${formatDate(c.renewsOn, s.asOf)}`).join(', ') \|\| 'None' `` | 1 · "Frey · lease-purchase ends Nov 15" |
| Drafts | `String(s.drafts.length)` | `` s.drafts.map(c => `${c.lastName} · starts ${formatDate(c.startsOn, s.asOf)}`).join(', ') \|\| 'None' `` | 1 · "Reed · starts Sep 8" |

Runtruck1 hard-coded the last three notes; these expressions reproduce them from the records (fleet-hr-safety §6.3, 03 §6.8). "None" is the empty-list note (03 §6.0.9).

Header: "Filters" and "+ New Contract" (primary) stay inert (01 §7).

### 4.2 HR › Onboarding (`/app/hr/onboarding`)

Calls: `GET /api/v1/hr/onboarding?limit=500`.

**Row view-model** (`OnboardingRowVm`, Runtruck1 `Onboarding`):

| key | type | from `OnboardingCaseRow` | seed (Jamal Reed) |
|---|---|---|---|
| `candidate` | string | `candidateName` | "Jamal Reed" |
| `role` | string | role label | "Company driver" |
| `stage` | string | stage label | "Orientation" |
| `started` | string | `formatShortDate(startedOn)` | "Aug 17" |
| `owner` | string | `owner.fullName` | "Rosa Medina" |
| `progress` | number | `progressPercent` (raw, searched as digits) | 85 |
| `nextStep` | string | `nextStepOn === null ? nextStep : nextStep + ' · ' + formatShortDate(nextStepOn)` | "Ride-along with Ana Cortez · Sep 5" |
| `docsPending` | boolean | `pendingDocumentLabels.length > 0` (not searched, as in Runtruck1) | false (Derek, Kevin: true) |
| `ref` | object | `{ id, tone }` | |

Cells: `td.strong` candidate · `td` role · `td` `<Tag label={stage} tone={ref.tone} />` (left-aligned, not `num`) · `td` started · `td` owner · `td` progress bar (`div.ui-bar-track` 120 px, `div.ui-bar-fill` width `` `${progress}%` ``, then `span` `` `${progress}%` ``, markup of fleet-hr-safety §7.1) · `td.muted` nextStep.

Rendered rows (seed): Jamal Reed · Company driver · Orientation · Aug 17 · Rosa Medina · 85% · Ride-along with Ana Cortez · Sep 5; Sofia Nguyen · Company driver · Road test · Aug 24 · Luis Ortega · 60% · Road test in T-103 · Sep 4; Derek Holt · Owner-operator · Background check · Aug 28 · Rosa Medina · 35% · Waiting on MVR consent and insurance certificate; Kevin Brandt · Company driver · Background check · Sep 1 · Rosa Medina · 30% · Waiting on medical card copy; Maya Patel · Company driver · Application · Sep 2 · Rosa Medina · 10% · Phone screen · Sep 4; Evan Brooks · Dispatcher · Complete · Jul 13 · Rosa Medina · 100% · 90-day review · Oct 25. Identical to Runtruck1's `ONBOARDING`.

**KPIs**; `s = meta.summary`:

| label | value | note | seed |
|---|---|---|---|
| In progress | `String(s.inProgressCount)` | `` `${s.inOrientationCount} in orientation` `` | 5 · "1 in orientation" |
| Starting this week | `String(s.startedThisWeekCount)` | `` `Opened since Mon ${formatShortDate(s.weekStart)}` `` (the org week always starts on a Monday) | 2 · "Opened since Mon Aug 31" |
| Awaiting documents | `String(s.awaitingDocuments.length)` | `` s.awaitingDocuments.map(a => a.firstPendingLabel).join(' · ') \|\| 'None' `` | 2 · "MVR consent · medical card" |
| Completed this quarter | `String(s.completedThisQuarterCount)` | `` `Since ${formatShortDate(s.quarterStart)}` `` | 1 · "Since Jul 1" |

Header: "Filters" and "+ Start Onboarding" (primary) stay inert.

## 5. Stub controls and future writes (not implemented, 01 §7)

"+ New Contract" and "+ Start Onboarding" stay inert and call nothing. When they are built, each is a write in one transaction with Zod validation, a state-machine check, an audit row and an outbox event (04 §7); the event rows are then added to [17-event-architecture.md §5](../17-event-architecture.md):

| control | endpoint | permission | audit action | event (payload) |
|---|---|---|---|---|
| + New Contract | `POST /hr/contracts` | `hr.create` | `EMPLOYEE_CONTRACT_CREATED` | `EmployeeContractCreated` (`contractId`, `employeeId`, `status`) |
| (status change) | `POST /hr/contracts/:id/…` transitions `draft → active → renewal_due/expiring` | `hr.update` | `EMPLOYEE_CONTRACT_STATUS_CHANGED` | `EmployeeContractStatusChanged` (`contractId`, `from`, `to`) |
| + Start Onboarding | `POST /hr/onboarding` | `hr.create` | `ONBOARDING_STARTED` | `OnboardingStarted` (`onboardingCaseId`, `role`) |
| (stage change) | `POST /hr/onboarding/:id/advance` along `application → background_check → road_test → orientation → complete` | `hr.update` | `ONBOARDING_STAGE_CHANGED` | `OnboardingStageChanged` (`onboardingCaseId`, `from`, `to`) |

## 6. Tests

- **Integration** (`apps/api/test`, seeded by `seedTestFixtures`):
  - each endpoint returns the seed rows of §2.5 and §3.5 in order, and the summaries of §2.4 and §3.4;
  - `q`: contracts "2027" → 7 rows, "w-2" → 9, "w2" → 0, "lease" → Tobias Frey; onboarding "85" → Jamal Reed, "sep 4" → Sofia Nguyen and Maya Patel, "true" → 0; each equals `matchesQuery` over the §4 view-models;
  - `status=renewal_due` → 2 rows with an unchanged summary; `stage=complete` → Evan Brooks;
  - `limit`/`offset`/`meta.total`; `limit=0`, `limit=501`, `status=bogus` → 400 `VALIDATION_ERROR` naming the parameter;
  - the Dispatcher, Accounting and Driver fixture members (no `hr.view`) → 403 `FORBIDDEN`; no session → 401;
  - a "Test Carrier Co" member sees only its own fixture rows (01 C10: one contract, one onboarding case) and a summary over them, never Sunridge's rows.
- **Unit:** org-week and quarter boundaries (a case started on the Sunday counts, the Monday after does not; `completed_on` = quarter start counts, the day before does not); the renewals order (`renews_on` then position); `firstPendingLabel` ignores `received` requests; `formatPayBasis` for the four bases.

## 7. Differences from Runtruck1 (D5)

None. Every HR value computed from the seed equals Runtruck1's (03 §6.8, §8): Active contracts 6 · "10 on file", Renewals due 2 · "Raman Sep 20 · Nakamura Oct 1", Owner-operators 1 · "Frey · lease-purchase ends Nov 15", Drafts 1 · "Reed · starts Sep 8"; In progress 5 · "1 in orientation", Starting this week 2 · "Opened since Mon Aug 31", Awaiting documents 2 · "MVR consent · medical card", Completed this quarter 1 · "Since Jul 1"; every row string.

## 8. Decisions and dependencies

**Decisions made in this document** (to record in 01 §6):

| # | Decision | Why |
|---|---|---|
| H1 | `hr.view` covers contract pay basis (per-mile rates, hourly rates, salaries). No separate HR-financial key is added. | fleet-hr-safety §6.2/B17 suggests a separate permission, but the design brief uses catalog keys only and only Owner, Admin and Manager hold `hr.view`. Pay basis is a column of Runtruck1's `Contract` row; hiding it would change the table. Needs a line in [07 §2.1](../07-roles-permissions.md). |
| H2 | "Renewals due (30 d)" counts the stored `renewal_due` status; its note lists those contracts by `renews_on`. No 30-day window is applied. | Design brief §2 (stored contract status, computed counts) and 03 §6.8. With the pinned clock the stored statuses agree with the label. |
| H3 | KPI notes Runtruck1 hard-coded ("Raman Sep 20 · Nakamura Oct 1", "Frey · lease-purchase ends Nov 15", "Reed · starts Sep 8", "Opened since Mon Aug 31", "MVR consent · medical card", "Since Jul 1") are composed by the web from structured summary lists; an empty list reads "None". | D5 with Runtruck1's wording (03 §6.8, §6.0.9); the wording lives in one place (the web), as in fleet.md. |
| H4 | Loading, refusal (403) and error states follow implementation-brief §4: pending and 403 render the tab bar, KPI values "—" without notes, and the table head with no rows and no empty-state line; other errors add one `ui-empty` line with the message. | Runtruck1 has no error UI; this keeps the layout and reveals nothing. One rule for every page (01 §6); [safety.md](safety.md) S6, [fleet.md](fleet.md) F1 and [dashboard.md](dashboard.md) §5.1 reference it. |

**Dependencies on other groups:**

| # | Needed from | Change |
|---|---|---|
| R1 | `@runtruck/calculations` owner | Export the enum label maps of §4 (and safety.md §7) and the row view-model builders from a runtime package the API and the web both import, so server `q` and the web search use identical strings (03 §1.11). |
| R2 | `@runtruck/calculations` owner | Add `formatPayBasis(basis, rateCents, percentBp)` implementing 03 §6.0.6. Settlements returns a server-built `payBasisLabel` (`packages/types/src/settlements.ts`); it should come from the same function so Payroll and Contracts never disagree. |
| R3 | `docs/07-roles-permissions.md` owner | §2.1: add "`hr.view` — also contract pay basis" (H1). |
| R4 | `docs/01-product-requirements.md` owner | §6: record H1–H4. |
