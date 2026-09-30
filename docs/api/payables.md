# API — Payables (vendor bills)

Domain API specification (rank 5, architecture §49). Conventions: [04-api.md](../04-api.md) and the shared accounting conventions of [billing.md](billing.md) §1 (tenancy, today, paging, `q`, `meta`, errors, query budget), which apply here unchanged. Derived values: [03-database.md](../03-database.md) §6.7.7. Lifecycle: [11-billing-lifecycle.md](../11-billing-lifecycle.md) §7.

Screen served: Accounting › **Bills** (Runtruck1 port spec [accounting.md](../reference/runtruck1/accounting.md) §3.7).

Contracts in code:
- DTOs: `packages/types/src/payables.ts` (`BillRow`, `BillStatus`, `BillsKpi`, `BillsSummary`, `BillsMeta`).
- Input schemas: `packages/validation/src/payables.ts` (`listBillsQuerySchema`, `billStatusSchema`).

---

## 1. Endpoint index

| Method & path | Permission | Query / body | `data` | `meta` | Screen |
|---|---|---|---|---|---|
| `GET /bills` | `payables.view` | `listBillsQuerySchema` | `BillRow[]` | `BillsMeta` | Bills |

---

## 2. `GET /bills`

- **Permission:** `payables.view` (not `billing.view`: bills are accounts payable, [07](../07-roles-permissions.md) §6.1).
- **Query:** `listBillsQuerySchema` (= `pageQuerySchema`: `limit`, `offset`, `q`). No status filter: the screen lists every bill and its KPIs cover every bill.

### 2.1 Response row `BillRow`

| field | type | computed from |
|---|---|---|
| `id` | uuid | `bills.id` |
| `vendorId`, `vendorName` | uuid, string | `bills.vendor_id`, `vendors.name` (em dash kept: "Modesto Yard — Lease") |
| `category` | string | `bills.category` |
| `description` | string \| null | `bills.description` |
| `categoryLabel` | string | 03 §6.0.8: `category`, or `` `${category} · ${description}` `` (U+00B7) when `description` is set → "Parts · T-118 turbo" |
| `dueOn` | date | `bills.due_on` |
| `amountCents` | integer | `bills.amount_cents` |
| `status` | `BillStatus` | `bills.status` (stored lifecycle status) |
| `scheduledOn` | date \| null | `bills.scheduled_on` (auto-pay date) |
| `paidOn` | date \| null | `bills.paid_on` (set iff `paid`) |

**Order:** `due_on ASC, id ASC`. Seed (verified = Runtruck1 `BILLS` array order, which has no two bills on one day): Verizon Connect ELD (Aug 28), Modesto Yard — Lease (Sep 1), Comdata (Sep 2), Bridgestone Commercial (Sep 4), Pilot Flying J (Sep 5), Valley Diesel & Turbo (Sep 8), Great West Casualty (Sep 10), Ryder Trailer Lease (Sep 15).

**Searchable fields (`q`):** the view row `vendor, category, due, amount, status` (§4).

### 2.2 `meta.summary` (`BillsSummary`)

Each KPI is `{count, amountCents = Σ bills.amount_cents}` over every bill of the organization (03 §6.7.7).

| field | filter | seed | Runtruck1 |
|---|---|---|---|
| `dueThisWeek` | `status = 'due' AND due_on − today ≤ 7` (no lower bound: a `due` bill already past its date still counts, Runtruck1's rule, accounting.md B15) | 3 · 1,500,000 (Bridgestone +1, Pilot +2, Valley Diesel +5) | 3 · $15,000 |
| `overdue` | `status = 'overdue'` | 1 · 48,600 (Verizon) | 1 · $486 |
| `scheduled` | `status = 'scheduled'` | 2 · 1,036,000 (Great West, Ryder) | 2 · $10,360 |
| `paidThisMonth` | `status = 'paid' AND paid_on` in the current month (03 §6.0.1) | 2 · 411,500 (Modesto Yard Sep 1, Comdata Sep 2) | 2 · $4,115 |

Every value equals Runtruck1's. (Runtruck1 tested the **due** month because it had no paid date; the seed pays each bill on its due date, 01 C4, so the result is the same.)

### 2.3 Query plan (no N+1)

```sql
-- page ($1 = org)
SELECT b.id, b.vendor_id, v.name AS vendor_name, b.category, b.description, b.due_on,
       b.amount_cents, b.status, b.scheduled_on, b.paid_on
FROM bills b
JOIN vendors v ON v.organization_id = b.organization_id AND v.id = b.vendor_id
WHERE b.organization_id = $1
ORDER BY b.due_on ASC, b.id ASC
LIMIT $2 OFFSET $3;

-- summary ($2 = today, $3 = first day of the current month, $4 = first day of the next month)
SELECT count(*) FILTER (WHERE status = 'due' AND due_on - $2 <= 7)            AS due_week_count,
       coalesce(sum(amount_cents) FILTER (WHERE status = 'due' AND due_on - $2 <= 7), 0) AS due_week_cents,
       count(*) FILTER (WHERE status = 'overdue')                               AS overdue_count,
       coalesce(sum(amount_cents) FILTER (WHERE status = 'overdue'), 0)         AS overdue_cents,
       count(*) FILTER (WHERE status = 'scheduled')                             AS scheduled_count,
       coalesce(sum(amount_cents) FILTER (WHERE status = 'scheduled'), 0)       AS scheduled_cents,
       count(*) FILTER (WHERE status = 'paid' AND paid_on >= $3 AND paid_on < $4) AS paid_month_count,
       coalesce(sum(amount_cents) FILTER (WHERE status = 'paid' AND paid_on >= $3 AND paid_on < $4), 0) AS paid_month_cents
FROM bills WHERE organization_id = $1;
```

Indexes: `bills_org_due_idx` (page order), `bills_org_status_idx`, `vendors` tenant key.

### 2.4 Errors and tenancy

`400 VALIDATION_ERROR` (bad paging), `401`, `403 FORBIDDEN` without `payables.view`. Both relations carry the organization predicate.

---

## 3. Writes

**None in this release.** "+ Add Bill" and "Filters" are inert (01 §7). The reserved bill transitions (schedule, pay, overdue sweep), their permissions (`payables.create`, `payables.approve`), audit actions and events are in [11-billing-lifecycle.md](../11-billing-lifecycle.md) §7. No audit row or domain event is written by this domain today.

---

## 4. Web mapping — Bills, `/app/accounting/bills`

Shared rules: [billing.md](billing.md) §7.0 (formatters from `@runtruck/calculations`, view rows without UUIDs, `{key, view}` pairs, `matchesQuery`, empty state, KPIs from `meta.summary`).

Calls `GET /bills?limit=500`, query key `['bills']`.

Label and tone map (`BillStatus`): `due` → "Due" (amber) · `overdue` → "Overdue" (amber) · `scheduled` → "Scheduled" (blue) · `paid` → "Paid" (green).

View row `BillViewRow` (mapper `billViewRow(row: BillRow)`, shared as in billing.md §7.0):

| key (Runtruck1) | value | seed example |
|---|---|---|
| `vendor` | `vendorName` | "Valley Diesel & Turbo" (React escapes the `&`) |
| `category` | `categoryLabel` | "Parts · T-118 turbo" |
| `due` | `formatShortDate(dueOn)` | "Sep 8" |
| `amount` | `formatMoney(amountCents)` | "$3,980" |
| `status` | status label | "Due" |
| `tone` (not searched) | status tone | `'amber'` |

Columns: Vendor (`td.strong`) · Category (`td.muted`) · Due · Amount (`th.num`/`td.num`) · Status (`num`, right-aligned chip). Card title "Bills". React key = `id` (Runtruck1 used `vendor`, accounting.md H19).

KPIs (`summary`):

| label | value | note | seed |
|---|---|---|---|
| Due this week | `String(dueThisWeek.count)` | `formatMoney(dueThisWeek.amountCents)` | "3" · "$15,000" |
| Overdue | `String(overdue.count)` | `formatMoney(overdue.amountCents)` | "1" · "$486" |
| Scheduled | `String(scheduled.count)` | `` `${formatMoney(scheduled.amountCents)} · auto-pay` `` | "2" · "$10,360 · auto-pay" |
| Paid this month | `String(paidThisMonth.count)` | `formatMoney(paidThisMonth.amountCents)` | "2" · "$4,115" |

---

## 5. D5 differences

None: every Bills value computed from the seed equals Runtruck1's.
