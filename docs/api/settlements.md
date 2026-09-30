# API — Settlements (driver payroll)

Domain API specification (rank 5, architecture §49). Conventions: [04-api.md](../04-api.md) and the shared accounting conventions of [billing.md](billing.md) §1 (tenancy, today, paging, `q`, `meta`, errors, query budget), which apply here unchanged. Derived values: [03-database.md](../03-database.md) §6.7.6. Lifecycle and state machine: [12-settlement-lifecycle.md](../12-settlement-lifecycle.md).

Screen served: Accounting › **Payroll** (Runtruck1 port spec [accounting.md](../reference/runtruck1/accounting.md) §3.6, §7), including the header button "Run settlements" and the card link "Approve all".

Contracts in code:
- DTOs: `packages/types/src/settlements.ts` (`SettlementRow`, `SettlementStatus`, `SettlementPayBasis`, `SettlementPeriod`, `SettlementsSummary`, `SettlementsMeta`, `SettlementsApproveMeta`).
- Input schemas: `packages/validation/src/settlements.ts` (`listSettlementsQuerySchema`, `approveSettlementsSchema`, `settlementStatusSchema`).

---

## 1. Endpoint index

| Method & path | Permission | Query / body | `data` | `meta` | Screen |
|---|---|---|---|---|---|
| `GET /settlements?periodStart=YYYY-MM-DD` | `settlements.view` | `listSettlementsQuerySchema` | `SettlementRow[]` | `SettlementsMeta` | Payroll |
| `POST /settlements/approve` | `settlements.approve` **and** `settlements.view` | body `approveSettlementsSchema` `{ periodStart }` | `SettlementRow[]` | `SettlementsApproveMeta` | Payroll "Approve all", header "Run settlements" |

---

## 2. `GET /settlements`

- **Permission:** `settlements.view`.
- **Query:** `listSettlementsQuerySchema` = `pageQuerySchema` + `periodStart` (optional; a real calendar date, `z.iso.date()`).

### 2.1 Which period

| `periodStart` | period listed |
|---|---|
| given | the settlements with `period_start = periodStart`. `summary.period = {start: periodStart, end: max(period_end) of those rows, or null when there are none}`. No rows is `data: []`, not 404. |
| omitted | the settlement period containing today (`period_start ≤ today ≤ period_end`), else the latest period with `period_start ≤ today` (03 §6.7.6): `SELECT period_start FROM settlements WHERE organization_id = $1 AND period_start <= $today ORDER BY (period_end >= $today) DESC, period_start DESC LIMIT 1`. None → `summary.period = null` and `data: []`. |

Seed: omitted → **2026-09-01** (period 2026-09-01 … 2026-09-07 contains 2026-09-03). Periods are stored facts; the week of Sep 1 starts on a Tuesday (accounting.md B1) and is not the Monday–Sunday org week.

### 2.2 Response row `SettlementRow`

| field | type | computed from |
|---|---|---|
| `id` | uuid | `settlements.id` |
| `driverId` | uuid | `settlements.driver_id` |
| `driverName` | string | `employees.first_name || ' ' || employees.last_name` via `drivers.employee_id` |
| `periodStart`, `periodEnd` | date | `settlements.period_start`, `settlements.period_end` |
| `payBasis`, `payRateCents`, `payPercentBp` | enum, integer \| null, integer \| null | `settlements.pay_basis`, `pay_rate_cents`, `pay_percent_bp` (the basis in force for the period) |
| `payBasisLabel` | string | 03 §6.0.6: `per_mile` → `"$" + (rate/100).toFixed(2) + " / mi"` ("$0.62 / mi") · `percent_of_line_haul` → `bp/100 + "% of line haul"` ("25% of line haul") · `annual_salary` → F-MONEY(rate) + " / yr" · `hourly` → `"$" + (rate/100).toFixed(2) + " / hr"` |
| `loadCount` | integer | `count(*)` of the settlement's `settlement_items` with `kind = 'line_pay'` |
| `miles` | integer | `Σ miles` of those items (null miles count 0) |
| `grossCents` | integer | `Σ amount_cents` of `line_pay` items |
| `deductionsCents` | integer (≤ 0) | `Σ amount_cents` of `deduction` items (0 when none) |
| `netCents` | integer | `grossCents + deductionsCents` |
| `status` | `SettlementStatus` | `settlements.status` |
| `holdReason` | string \| null | `settlements.hold_reason` (set iff `on_hold`) |
| `approvedAt` | ISO instant \| null | `settlements.approved_at` |

**Order:** `drivers.position ASC, settlements.id ASC`. Seed (verified = Runtruck1 `SETTLEMENTS` order, which is also miles DESC): Marcus Hale, Dara Whitfield, Ellis Nakamura, Priya Raman, Ana Cortez. Tobias Frey has no settlement and no row (accounting.md B13).

| driver | basis | loads | miles | gross | deductions | net | status |
|---|---|---|---|---|---|---|---|
| Marcus Hale | $0.62 / mi | 4 | 2,140 | 132,600 | −14,200 | 118,400 | ready |
| Dara Whitfield | $0.60 / mi | 3 | 1,980 | 118,800 | −9,600 | 109,200 | ready |
| Ellis Nakamura | 25% of line haul | 3 | 1,760 | 145,500 | −21,000 | 124,500 | on_hold (`fuel`) |
| Priya Raman | $0.58 / mi | 2 | 1,420 | 82,400 | −6,400 | 76,000 | ready |
| Ana Cortez | $0.58 / mi | 2 | 1,180 | 68,400 | 0 | 68,400 | paid |

All equal Runtruck1 (amounts are the seeded items, not recomputed from the rate: 03 §7.18, accounting.md B10).

**Searchable fields (`q`):** the view row `name, basis, loads, miles, gross, ded, net, status` (§5). `status` is the current label, so after approval `q=approved` matches the three approved rows, as in Runtruck1.

### 2.3 `meta.summary` (`SettlementsSummary`)

Over **every** settlement of the listed period, whatever its status (Runtruck1 includes the held and the paid rows, accounting.md B11; 12 §6).

| field | formula | seed (before approval) | after `POST /settlements/approve` | Runtruck1 |
|---|---|---|---|---|
| `period` | §2.1 | `{start '2026-09-01', end '2026-09-07'}` | same | "Week of Sep 1" |
| `driverCount` | `count(*)` | 5 | 5 | 5 |
| `readyCount` | `count(*) FILTER (WHERE status = 'ready')` | 3 | 0 | "3 ready to approve" |
| `approvedCount` | `… = 'approved'` | 0 | 3 | |
| `onHoldCount` | `… = 'on_hold'` | 1 | 1 | |
| `paidCount` | `… = 'paid'` | 1 | 1 | |
| `grossCents` | `Σ grossCents` | 547,700 ("$5,477") | same | $5,477 |
| `deductionsCents` | `Σ deductionsCents` (signed) | −51,200 (tile "$512") | same | $512 |
| `netCents` | `Σ netCents` | 496,500 ("$4,965") | same | $4,965 |
| `allApproved` | `readyCount = 0 AND approvedCount > 0` (Runtruck1's `approved` flag, accounting.md §7.3) | false | true | false → true |

Every value equals Runtruck1's, before and after approval. A period with only held or paid settlements (or none) has `allApproved = false`; Runtruck1 never shows that state.

### 2.4 Query plan (no N+1)

```sql
-- $1 = org, $2 = resolved period_start
SELECT s.id, s.driver_id, e.first_name || ' ' || e.last_name AS driver_name,
       s.period_start, s.period_end, s.pay_basis, s.pay_rate_cents, s.pay_percent_bp,
       s.status, s.hold_reason, s.approved_at,
       count(si.id) FILTER (WHERE si.kind = 'line_pay')                          AS load_count,
       coalesce(sum(si.miles) FILTER (WHERE si.kind = 'line_pay'), 0)             AS miles,
       coalesce(sum(si.amount_cents) FILTER (WHERE si.kind = 'line_pay'), 0)      AS gross_cents,
       coalesce(sum(si.amount_cents) FILTER (WHERE si.kind = 'deduction'), 0)     AS deductions_cents
FROM settlements s
JOIN drivers d   ON d.organization_id = s.organization_id AND d.id = s.driver_id
JOIN employees e ON e.organization_id = d.organization_id AND e.id = d.employee_id
LEFT JOIN settlement_items si ON si.organization_id = s.organization_id AND si.settlement_id = s.id
WHERE s.organization_id = $1 AND s.period_start = $2
GROUP BY s.id, d.position, e.first_name, e.last_name
ORDER BY d.position ASC, s.id ASC;
```

The summary aggregates the same grouped relation in one statement (a period holds one settlement per driver, `settlements_org_driver_period_uq`). With `periodStart` omitted, the period lookup (§2.1) is one extra indexed statement (`settlements_org_period_idx`); it can be inlined as a CTE. Indexes: `settlements_org_period_idx`, `settlement_items_settlement_position_uq`, `drivers`/`employees` tenant keys.

### 2.5 Errors and tenancy

`400 VALIDATION_ERROR` (`periodStart` not a real `YYYY-MM-DD` date; bad paging), `401`, `403 FORBIDDEN` without `settlements.view`. Settlements, items, drivers and employees all carry the organization predicate; another organization's period simply has no rows.

---

## 3. `POST /settlements/approve`

Approves every `ready` settlement of one pay period: Runtruck1's "Approve all" / "Run settlements" made a persisted, authorized, audited state transition (accounting.md §7.2; 12 §5).

- **Permission:** `@RequirePermissions('settlements.approve', 'settlements.view')`. `settlements.approve` authorizes the transition; `settlements.view` is required too because the response returns the period's settlements (every default role holding the first holds the second: Owner, Admin, Accounting, Manager). This extends 07 §6.1, which lists `settlements.approve` alone (§6).
- **Body:** `approveSettlementsSchema` = strict `{ periodStart: 'YYYY-MM-DD' }`. Unknown keys (e.g. `organizationId`, `userId`, `settlementIds`) are rejected with `400`.
- **Origin:** a browser request must come from the web origin (`403 CROSS_ORIGIN_REJECTED`, 04 §4).

### 3.1 Behaviour (one transaction)

1. Validate the body (`400`).
2. `SELECT 1 FROM settlements WHERE organization_id = ctx.organizationId AND period_start = $periodStart LIMIT 1`. None → `404 SETTLEMENT_PERIOD_NOT_FOUND` ("Pay period was not found."). An unknown period and another organization's period are indistinguishable.
3. `now = ClockService.now(ctx.timezone)` (demo-pinned instant, D4).
4. Transition, **only** `ready → approved` (state machine: 12 §4):
   ```sql
   UPDATE settlements
      SET status = 'approved', approved_at = $now, approved_by_user_id = $userId, updated_at = now()
    WHERE organization_id = $org AND period_start = $periodStart AND status = 'ready'
   RETURNING id, driver_id;
   ```
   `on_hold`, `approved` and `paid` settlements are untouched. Under READ COMMITTED a concurrent second call blocks on the row locks, re-evaluates `status = 'ready'` after the first commits and updates nothing, so no settlement is approved, audited or announced twice.
5. For **each** returned row, in the same transaction:
   - `AuditService.record(tx, ctx, { action: 'SETTLEMENT_APPROVED', entityType: 'settlement', entityId: id, entityLabel: '<driver name> · <periodStart>', previous: { status: 'ready' }, next: { status: 'approved', approvedAt, approvedByUserId }, occurredAt: now })`;
   - `EventsService.emit(tx, ctx, { type: 'SettlementApproved', aggregateType: 'settlement', aggregateId: id, payload: { settlementId, driverId, periodStart } }, now)` ([17](../17-event-architecture.md) §5; no names or money in the payload).
6. Read the period back with the §2 query (`limit 500`, `offset 0`, no `q`) inside the transaction and return it with `meta.approvedNow` = the number of rows updated in step 4.

**Idempotent.** When the period has no `ready` settlement (already approved, or only held/paid rows), the call returns `200` with the unchanged payload, `approvedNow: 0`, and writes **no** audit row and **no** event. This matches Runtruck1, where clicking "Approved" again does nothing.

**Status code:** `200` (no resource is created). No confirmation step: Runtruck1 has none (D6); architecture §26's "sensitive action" confirmation applies to AI tools acting on a user's behalf (12 §8).

### 3.2 Response

Same `data` as `GET /settlements?periodStart=<periodStart>&limit=500`; `meta` = `SettlementsApproveMeta` = `SettlementsMeta` + `approvedNow`. Seed, first call: the three `ready` rows (Marcus, Dara, Priya) come back `approved` with `approvedAt` set; `summary` = `{readyCount 0, approvedCount 3, allApproved true}`, money unchanged; `approvedNow 3`; 3 `audit_logs` rows and 3 `events` rows. Second call: identical data, `approvedNow 0`, no new rows.

### 3.3 Errors

| HTTP | code | when |
|---|---|---|
| 400 | `VALIDATION_ERROR` | missing/invalid `periodStart`, unknown body key |
| 401 | `UNAUTHORIZED` | no session |
| 403 | `FORBIDDEN` | missing `settlements.approve` or `settlements.view` (Dispatcher fixture) |
| 403 | `CROSS_ORIGIN_REJECTED` | browser `Origin` is not the web app |
| 404 | `SETTLEMENT_PERIOD_NOT_FOUND` | the organization has no settlement with that `period_start` |

A rejected request changes nothing and writes no audit or event row.

### 3.4 Audit and events

| Write | Audit action (per settlement) | Domain event (per settlement) | Payload |
|---|---|---|---|
| `ready → approved` | `SETTLEMENT_APPROVED` (`entity_type 'settlement'`) | `SettlementApproved` (`aggregate_type 'settlement'`) | `settlementId`, `driverId`, `periodStart` |

No handler consumes `SettlementApproved` yet ([18](../18-background-jobs.md)); handlers added later must be idempotent by event id.

---

## 4. Tests this domain must have ([20](../20-testing.md) §3)

- `GET /settlements` (no period) → the five seed rows in order, the §2.3 summary; `?periodStart=2026-09-01` → the same; `?periodStart=2026-02-30` → 400; the Test Carrier Co session → only its own settlement for the same period (01 C10 gives it one: Terry Wheeler, $495.00, ready), and `data: []` for a period only Sunridge has (`2026-08-18`).
- `POST /settlements/approve {periodStart: '2026-09-01'}` as Rosa → 200, three rows `approved`, Ellis `on_hold` and Ana `paid` unchanged, 3 audit + 3 event rows with the caller's organization; repeat → 200, `approvedNow 0`, no new rows.
- Dispatcher fixture → 403 and nothing written; body with `organizationId` → 400; an unknown period, or the Test Carrier Co session approving a period only Sunridge has (`2026-08-18`) → 404 `SETTLEMENT_PERIOD_NOT_FOUND` with the same message, and Sunridge's row stays `ready` with no audit or event rows; the Test Carrier Co session approving `2026-09-01` moves only its own settlement (Sunridge's rows, audit and events untouched); foreign `Origin` → 403 `CROSS_ORIGIN_REJECTED`.
- E2E: Payroll "Approve all" flips the three chips to "Approved" and the state survives a reload (20 §4 workflow 4).

---

## 5. Web mapping — Payroll, `/app/accounting/payroll`

Shared rules: [billing.md](billing.md) §7.0 (formatters from `@runtruck/calculations`, view rows without UUIDs, `{key, view}` pairs, `matchesQuery`, empty state, KPIs from `meta.summary`).

**Read.** `GET /settlements?limit=500` (no `periodStart`: the API picks the current period), query key `['settlements', 'current']`.

**Approve.** One shared mutation hook, `useApproveSettlements()` in `apps/web/src/lib/api/settlements.ts` (the Header already imports it), used by the card link and the header button "Run settlements":
- it reads `periodStart` from the cached `['settlements', 'current']` data (`meta.summary.period.start`); when `period` is null it does nothing;
- `POST /settlements/approve { periodStart }`; on success it **replaces** the `['settlements', 'current']` cache with the response (`data` + `meta`), so no refetch is needed; on error nothing changes (optional optimistic update rolled back on error);
- the link stays clickable after approval, and a second click calls the API again, which is a no-op (idempotent).
- Hiding: members without `settlements.approve` do not see the link or the button (07 §5); Rosa (Admin) sees both, exactly as Runtruck1.

Label and tone map (`SettlementStatus`): `ready` → "Ready" (blue) · `approved` → "Approved" (blue) · `on_hold` → `` `Hold · ${holdReason}` `` (amber; "Hold · fuel") · `paid` → "Paid" (green).

View row `SettlementViewRow` (mapper `settlementViewRow(row: SettlementRow)`, shared as in billing.md §7.0; Runtruck1 row keys):

| key (Runtruck1) | value | seed example |
|---|---|---|
| `name` | `driverName` | "Marcus Hale" |
| `basis` | `payBasisLabel` | "$0.62 / mi" |
| `loads` | `String(loadCount)` (Runtruck1 kept a string) | "4" |
| `miles` | `formatInt(miles)` | "2,140" |
| `gross` | `formatMoney(grossCents)` | "$1,326" |
| `ded` | `formatSignedMoney(deductionsCents, true)` (negative → "-$142" with U+002D; zero → "—") | "-$142" / "—" |
| `net` | `formatMoney(netCents)` | "$1,184" |
| `status` | status label | "Ready" → "Approved" after approval |
| `tone` (not searched) | status tone | `'blue'` |

Columns: Driver (`td.strong`) · Pay basis (`td.muted`) · Loads (`num`) · Miles (`num`) · Gross (`num`) · Deductions (`num`) · Net (`td.num.strong`, weight 600) · Status (`num`, chip). React key = `id` (Runtruck1 used `name`).

Card: title `` `Driver settlements · week of ${formatShortDate(period.start)}` `` → "Driver settlements · week of Sep 1" (lower-case "week"); action `<button type="button" class="ui-link">` with text `allApproved ? 'Approved' : 'Approve all'`. Footer after the table and the empty state, always shown: `<div class="ui-total">Net payable this week <strong>{formatMoney(netCents)}</strong></div>` → "$4,965" (unaffected by search). With `period` null (no settlement period at all; not in the seed) the date reads "—".

KPIs (`summary`):

| label | value | note (not approved) | note (`allApproved`) | seed |
|---|---|---|---|---|
| Drivers | `String(driverCount)` | `` `${readyCount} ready to approve` `` | "Approved for payment" | "5" · "3 ready to approve" |
| Gross | `formatMoney(grossCents)` | `` `Week of ${formatShortDate(period.start)}` `` | same | "$5,477" · "Week of Sep 1" |
| Deductions | `formatMoney(Math.abs(deductionsCents))` | "Fuel advances and escrow" | same | "$512" |
| Net payable | `formatMoney(netCents)` | "Awaiting approval" | "Approved" | "$4,965" |

---

## 6. D5 differences and decisions

**D5 differences:** none. Every Payroll value computed from the seed equals Runtruck1's, before and after approval.

Decisions made in this document (to record in [01](../01-product-requirements.md) §6):

1. `POST /settlements/approve` requires `settlements.view` in addition to `settlements.approve`, because it returns the period's list; [07](../07-roles-permissions.md) §6.1 and §8 item 7 record it.
2. An unknown or foreign `periodStart` on approve is `404 SETTLEMENT_PERIOD_NOT_FOUND`; on `GET` it is an empty list. The approve response adds `meta.approvedNow`.
3. The approval instant is `ClockService.now` (demo-pinned) and is used for `approved_at`, the audit row and the event, so all three agree.
4. Audit action `SETTLEMENT_APPROVED`, one per settlement, as [17](../17-event-architecture.md) §5. 03 §2.10 uses the same name.
5. Payroll with no settlement period renders "week of —" (unreachable with the seed).

Cross-domain dependencies: `payBasisLabel` follows the same rule as HR › Contracts "Pay basis" (03 §6.0.6); both should call one shared `formatPayBasis` in `@runtruck/calculations` (requested). Fleet › Drivers "Pay YTD" (C3) sums `line_pay` items of this year's settlements of every status; it is computed by the fleet domain from the same tables (12 §7).
