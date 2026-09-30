# API — Billing (receivables)

Domain API specification (rank 5, architecture §49). It follows the conventions of [04-api.md](../04-api.md), the rules of [03-database.md](../03-database.md) §6 (derived values, rank 3) and the product decisions of [01](../01-product-requirements.md) (rank 1). The lifecycle rules behind these endpoints are in [11-billing-lifecycle.md](../11-billing-lifecycle.md). Sibling documents: [payables.md](payables.md) (bills) and [settlements.md](settlements.md) (payroll).

Screens served: Accounting › **Uninvoiced**, **Invoiced**, **Batches**, **Past Due**, **Paid** (Runtruck1 port spec [accounting.md](../reference/runtruck1/accounting.md) §3.1–3.5), the Uninvoiced header label "Invoice N loads" ([shell.md](../reference/runtruck1/shell.md) §6.1).

Contracts in code:
- DTOs: `packages/types/src/billing.ts` (`UninvoicedLoadRow`, `UninvoicedLoadsMeta`, `InvoiceRow`, `InvoiceListMeta`, `InvoiceBatchRow`, `InvoiceBatchesMeta`, …).
- Input schemas: `packages/validation/src/billing.ts` (`listUninvoicedLoadsQuerySchema`, `listInvoicesQuerySchema`, `listInvoiceBatchesQuerySchema`, `invoiceStatusSchema`).

Contents: §1 conventions shared by the three accounting documents · §2 endpoint index · §3 `GET /billing/uninvoiced-loads` · §4 `GET /invoices` · §5 `GET /invoice-batches` · §6 writes (none in this release) · §7 web mapping · §8 D5 differences · §9 decisions and open points.

---

## 1. Conventions (shared by billing.md, payables.md and settlements.md)

| Topic | Rule |
|---|---|
| Base path | `/api/v1`. Every endpoint below is relative to it. |
| Authorization | Every handler declares `@RequirePermissions(…)` ([07](../07-roles-permissions.md) §6.1). The organization, the user and the permissions come from the session (`@Auth() ctx: AuthContext`), never from the request. |
| Tenancy | Every table read is filtered by `organization_id = ctx.organizationId`, **including every joined table** (joins use `(organization_id, id)` pairs, matching the composite tenant FKs of 03 §1.3 and the organization-leading indexes). No endpoint takes an organization id. Nothing another organization owns can be read, counted or summed. |
| Today | `today = ClockService.today(ctx.timezone)` (D4: 2026-09-03 in the demo). Every age, "this week" and "this month" figure uses it. Instants are turned into business dates with the organization timezone (`ctx.timezone`), except stop instants, which use the stop's timezone (03 §6.0.1). |
| Paging | `limit` 1–500 (default 100), `offset` ≥ 0, `q` ≤ 200 characters, trimmed (`pageQuerySchema`). The web requests `limit=500&offset=0` for every accounting list (01 §3: one bounded page ≤ 500 rows) and filters on screen. |
| Search `q` | Case-insensitive substring match with Runtruck1's `matchesQuery` semantics over the **view row** of each result (the display strings listed per endpoint under "Searchable fields", §7). The service builds each row's view row with the same pure mapper the web uses (§7.0), keeps the rows that match, then applies `offset`/`limit`, over at most the first 5,000 rows of the list's filter in list order ([04 §5.1](../04-api.md)). Without `q` the service pages in SQL. |
| `meta` | `{ total, limit, offset, summary }`. `total` counts the rows after `q`, before `offset`/`limit`. `summary` holds the screen's KPI figures, computed in SQL over **every** row of the list's filter: it ignores `q`, `limit` and `offset` (Runtruck1's search never changes a KPI, 03 §6). |
| Ordering | Every list has an explicit `ORDER BY` ending in a unique key (03 §1.10). The order reproduces Runtruck1's row order for the seed; each is verified below. |
| Values | Money is integer cents (`…Cents`, `sum()` is `bigint` in SQL and converted with `Number()`); business dates are `YYYY-MM-DD`; instants are UTC ISO strings; enums are lower_snake_case (04 §6). The web formats everything (§7). Composed text that Runtruck1 kept as one string (`route`, `sentTo`, `categoryLabel`, `payBasisLabel`) is composed by the API by the rules of 03 §6.0, so search sees the same text as Runtruck1 (design brief §3). |
| Errors | `400 VALIDATION_ERROR` (query or body fails its schema; `issues[].path` set) · `401 UNAUTHORIZED` (no or expired session) · `403 FORBIDDEN` (missing permission) · `403 CROSS_ORIGIN_REJECTED` (writes only) · `404 <ENTITY>_NOT_FOUND` (writes only; another organization's data is indistinguishable from missing data) · `500 INTERNAL_ERROR`. List reads never return 404: an empty result is `data: []`. |
| Queries per request | A list request runs at most **two** SQL statements: the page query (rows, joined and aggregated in one statement) and the summary query (one statement of aggregates and scalar subqueries). Nothing is fetched per row (architecture §38). With `q` present the page query returns at most the first 5,000 rows of the filter (ordered, `LIMIT 5000`), the match and the slice happen in memory; see §9 (scale). |

### 1.1 Label and tone maps (web presentation, used by §7)

| Enum | value → label (tone) |
|---|---|
| `InvoiceStatus` | `draft` → "Draft" (amber) · `sent` → "Sent" (blue) · `overdue` → "Overdue" (amber) · `paid` → "Paid" (green) |
| `PaymentMethod` | `ach` → "ACH" (gray) · `check` → "Check" (gray) · `factoring` → "Factoring" (blue); no payment → "—" (gray) |
| `InvoiceBatchStatus` | `ready` → "Ready" (blue) · `sent` → "Sent" (blue) · `settled` → "Settled" (green) |
| `UninvoicedPodStatus` | `attached` → "Attached" (green) · `missing` → "Missing" (amber) |

Tones are the `@runtruck/ui` `Tag` tones (`blue` = `ui-chip-blue`, `gray`, `amber`, `green`), matching Runtruck1's `tagClass` mapping (accounting.md §4.4).

---

## 2. Endpoint index

| Method & path | Permission | Query / body | `data` | `meta` | Screen |
|---|---|---|---|---|---|
| `GET /billing/uninvoiced-loads` | `billing.view` | `listUninvoicedLoadsQuerySchema` | `UninvoicedLoadRow[]` | `UninvoicedLoadsMeta` | Uninvoiced; header "Invoice N loads" |
| `GET /invoices?status=sent` | `billing.view` | `listInvoicesQuerySchema` | `InvoiceRow[]` | `InvoiceListMeta` (`summary.status = 'sent'`: AR aging) | Invoiced |
| `GET /invoices?status=overdue` | `billing.view` | `listInvoicesQuerySchema` | `InvoiceRow[]` | `InvoiceListMeta` (`'overdue'`) | Past Due |
| `GET /invoices?status=paid` | `billing.view` | `listInvoicesQuerySchema` | `InvoiceRow[]` (with `latestPayment`, `daysToPay`) | `InvoiceListMeta` (`'paid'`) | Paid |
| `GET /invoices?status=draft` | `billing.view` | `listInvoicesQuerySchema` | `InvoiceRow[]` | `InvoiceListMeta` (`'draft'`) | none (completeness) |
| `GET /invoice-batches` | `billing.view` | `listInvoiceBatchesQuerySchema` | `InvoiceBatchRow[]` | `InvoiceBatchesMeta` | Batches |

Paid invoices are served by `GET /invoices?status=paid` with payment fields; there is **no** separate `GET /payments` (design brief §2 allows either; see §9).

---

## 3. `GET /billing/uninvoiced-loads`

Delivered loads that have no invoice yet: the Uninvoiced table, its four KPIs, and the header label `Invoice ${loadCount} loads`.

- **Permission:** `billing.view`.
- **Query:** `listUninvoicedLoadsQuerySchema` (= `pageQuerySchema`: `limit`, `offset`, `q`).
- **Rule (03 §6.0.4):** a load (board **or archived**) is uninvoiced when `loads.status IN ('needs_pod', 'delivered')` and **no** `invoice_items` row references it (an item on an invoice of any status, draft included, counts). Its POD is attached when a `documents` row of type `proof_of_delivery` with status `attached` exists for it.

### 3.1 Response row `UninvoicedLoadRow`

| field | type | computed from |
|---|---|---|
| `loadId` | uuid | `loads.id` |
| `loadNumber` | integer | `loads.load_number` |
| `customerId` | uuid | `loads.customer_id` |
| `customerName` | string | `customers.name` |
| `route` | string \| null | first pickup label + " → " (U+2192) + last delivery label (03 §6.0.3 "route"; a stop's label is `coalesce(market_city, city) || ', ' || coalesce(market_state, state)` of its facility, else the stop's own `city, state`). Null when the load has no stops. |
| `deliveredOn` | date \| null | 03 §6.0.3 `delivered_on`: the date of the last delivery's `completed_at` in the **stop's** timezone when set, else its `appointment_date`. Null when the load has no stops. |
| `podStatus` | `'attached' \| 'missing'` | `EXISTS (documents … document_type = 'proof_of_delivery' AND status = 'attached')` |
| `amountCents` | integer | revenue(l) = `line_haul_cents::bigint + fuel_surcharge_cents + accessorial_cents` (cast before adding, 03 §6.0.3) |

**Order:** `delivered_on DESC NULLS LAST, load_number DESC`. Seed (verified, = Runtruck1 `UNINVOICED` array order): L-40209, L-40208, L-40207 (Sep 2) · L-40206 (Sep 1) · L-40204, L-40203 (Aug 31) · L-40205, L-40202 (Aug 30) · L-40201 (Aug 29) · L-40200 (Aug 28) · L-40199 (Aug 27).

**Searchable fields (`q`):** the view row `id, customer, route, delivered, pod, amount` (§7.1).

### 3.2 `meta.summary` (`UninvoicedLoadsSummary`)

| field | formula (over every uninvoiced load of the organization) | seed | Runtruck1 |
|---|---|---|---|
| `loadCount` | `count(*)` | 11 | 11 |
| `amountCents` | `Σ revenue(l)` (Missing-POD loads included) | 3,490,000 ("$34,900") | $34,900 |
| `customerCount` | `count(DISTINCT customer_id)` | 6 | 6 |
| `missingPodCount` | `count(*) FILTER (WHERE NOT pod_attached)` | 3 (L-40207, L-40204, L-40200) | 3 |
| `oldest` | the row with the largest `today − delivered_on`, the first in row order on ties: `ORDER BY delivered_on ASC, load_number DESC LIMIT 1` over rows with a `delivered_on`; `{loadId, loadNumber, deliveredOn, ageDays = today − delivered_on}`; null when none | `{loadNumber 40199, deliveredOn '2026-08-27', ageDays 7}` | "7", "L-40199 · delivered Aug 27" |

Every value equals Runtruck1's. The Dashboard "Unbilled loads" tile (`11`, `$34,900 waiting`) uses the same rule and must reuse this query (§9, cross-domain).

### 3.3 Query plan (no N+1)

```sql
-- $1 = ctx.organizationId, $2 = today (date)
-- ONE statement per request: the page and the summary read one MATERIALIZED set, so the
-- anti-join below runs once (it still reads every delivered load, 01 C86).
WITH uninvoiced AS MATERIALIZED (
  SELECT l.id, l.load_number, l.customer_id, cu.name AS customer_name,
         l.line_haul_cents::bigint + l.fuel_surcharge_cents + l.accessorial_cents AS amount_cents,   -- cast before adding (03 §6.0.3)
         pu.label AS pickup_label, dl.label AS delivery_label,
         coalesce((dl.completed_at AT TIME ZONE dl.timezone)::date, dl.appointment_date) AS delivered_on,
         EXISTS (SELECT 1 FROM documents d
                 WHERE d.organization_id = l.organization_id AND d.load_id = l.id
                   AND d.document_type = 'proof_of_delivery' AND d.status = 'attached') AS pod_attached
  FROM loads l
  JOIN customers cu ON cu.organization_id = l.organization_id AND cu.id = l.customer_id
  LEFT JOIN LATERAL (            -- first pickup, else the lowest-sequence stop
    SELECT coalesce(f.market_city, f.city, s.city) || ', ' || coalesce(f.market_state, f.state, s.state) AS label
    FROM load_stops s
    LEFT JOIN facilities f ON f.organization_id = s.organization_id AND f.id = s.facility_id
    WHERE s.organization_id = l.organization_id AND s.load_id = l.id
    ORDER BY (s.kind = 'pickup') DESC, s.sequence ASC LIMIT 1) pu ON true
  LEFT JOIN LATERAL (            -- last delivery, else the highest-sequence stop
    SELECT s.appointment_date, s.completed_at, s.timezone,
           coalesce(f.market_city, f.city, s.city) || ', ' || coalesce(f.market_state, f.state, s.state) AS label
    FROM load_stops s
    LEFT JOIN facilities f ON f.organization_id = s.organization_id AND f.id = s.facility_id
    WHERE s.organization_id = l.organization_id AND s.load_id = l.id
    ORDER BY (s.kind = 'delivery') DESC, s.sequence DESC LIMIT 1) dl ON true
  WHERE l.organization_id = $1
    AND l.status IN ('needs_pod', 'delivered')
    AND NOT EXISTS (SELECT 1 FROM invoice_items ii
                    WHERE ii.organization_id = l.organization_id AND ii.load_id = l.id)
), summary AS (SELECT count(*), coalesce(sum(amount_cents), 0), count(DISTINCT customer_id),
                       count(*) FILTER (WHERE NOT pod_attached) FROM uninvoiced),
oldest AS (SELECT id, load_number, delivered_on FROM uninvoiced
           WHERE delivered_on IS NOT NULL ORDER BY delivered_on ASC, load_number DESC LIMIT 1),
page AS (SELECT * FROM uninvoiced ORDER BY delivered_on DESC NULLS LAST, load_number DESC LIMIT … OFFSET …)
-- one result row per page row, each carrying the summary and the oldest row
-- ($2 - delivered_on is its age); a page past the end is one row with the summary only
SELECT page.*, summary.*, oldest.* FROM summary LEFT JOIN oldest ON true LEFT JOIN page ON true
ORDER BY page.delivered_on DESC NULLS LAST, page.load_number DESC
```

Indexes used: `loads_org_status_idx`, `invoice_items_org_load_idx` (anti-join), `load_stops_load_sequence_uq`, `documents_org_load_type_uq`, the customers and facilities tenant keys. The first-pickup / last-delivery / route / `delivered_on` expressions are the Loads domain's helpers (03 §6.0.3); the billing module imports them from the loads module rather than re-implementing them (§9).

### 3.4 Errors and tenancy

`400 VALIDATION_ERROR` (bad `limit`/`offset`/`q`), `401`, `403 FORBIDDEN` without `billing.view`. Every relation in the query carries the organization predicate; archived loads are included (they are the organization's delivered history, 03 §7.13).

---

## 4. `GET /invoices`

Invoices of **one** status per request. The status chooses the row order and the shape of `meta.summary` (a union discriminated by `summary.status`).

- **Permission:** `billing.view`.
- **Query:** `listInvoicesQuerySchema` = `pageQuerySchema` + `status` (**required**, `invoiceStatusSchema`: `draft | sent | overdue | paid`). A missing or unknown status is `400 VALIDATION_ERROR` (`issues[0].path = 'status'`).

### 4.1 Response row `InvoiceRow` (every status)

| field | type | computed from (03 §6.0.7) |
|---|---|---|
| `id` | uuid | `invoices.id` |
| `invoiceNumber` | integer | `invoices.invoice_number` |
| `customerId`, `customerName` | uuid, string | `invoices.customer_id`, `customers.name` |
| `loadId`, `loadNumber` | uuid \| null, integer \| null | the `invoice_items` row with `position = 1` → its `load_id` → `loads.load_number` ("Load" column); null when that item has no load or the invoice has no items |
| `status` | `InvoiceStatus` | `invoices.status` (stored lifecycle status; INV-8836 stays `overdue`, 01 C6) |
| `issuedOn`, `dueOn` | date \| null | `invoices.issued_on`, `invoices.due_on` (null while draft) |
| `ageDays` | integer \| null | `today − issued_on` |
| `daysPastDue` | integer \| null | `today − due_on` |
| `amountCents` | integer | invoice total = `Σ invoice_items.amount_cents` (0 without items) |
| `paidCents` | integer | `Σ payments.amount_cents` |
| `outstandingCents` | integer | `amountCents − paidCents` |
| `latestPayment` | `InvoiceLatestPayment` \| null | the invoice's payment with the greatest `received_at` (tie → greatest `id`): `paymentId`, `receivedAt` (ISO), `paidOn` = org-local date of `received_at`, `method`, `factoringCompanyId`, `factoringCompanyName` (`factoring_companies.name`), `amountCents` |
| `daysToPay` | integer \| null | `latestPayment.paidOn − issued_on`; null without a payment or an issue date |

### 4.2 Order per status

| status | `ORDER BY` | seed order (verified = Runtruck1) |
|---|---|---|
| `sent` | `issued_on DESC, invoice_number ASC` | INV-8844 (1 d), INV-8841 (2 d), INV-8842 (2 d), INV-8840 (3 d), INV-8829 (18 d). The 2 d tie keeps Runtruck1's source order (8841 before 8842). |
| `overdue` | `issued_on ASC, invoice_number ASC` | INV-8811 (67 d), INV-8815 (63 d), INV-8819 (50 d), INV-8836 (41 d), INV-8821 (36 d) |
| `paid` | latest `received_at DESC NULLS LAST, invoice_number ASC` | INV-8823 (Sep 3 10:00), INV-8824 (Sep 2 15:00), INV-8838 (Sep 2 09:00), INV-8839 (Sep 1 15:00), INV-8830 (Sep 1 09:00): the seeded times reproduce Runtruck1's stable sort (03 §7.15) |
| `draft` | `invoice_number DESC` | INV-8845 (not shown on any screen) |

**Searchable fields (`q`):** `sent`/`overdue`/`draft` → the view row `id, customer, load, issued, amount, age, status` (§7.2); `paid` → `id, customer, load, issued, amount, age, status, paid, via, days` (§7.5; `age` and `status` are searchable though not displayed, as in Runtruck1: `q=paid` matches every row, `q=29 d` matches INV-8823).

### 4.3 `meta.summary` for `status=sent` (`SentInvoicesSummary`): AR aging

The Invoiced tab's four KPI tiles. **AR aging** over every invoice in status `sent` **or** `overdue`, bucketed by `days past due = today − due_on` (03 §6.7.2); each bucket is `{invoiceCount, amountCents = Σ outstandingCents}`.

| field | bucket | seed | Runtruck1 (hard-coded `AR`) |
|---|---|---|---|
| `arAging.current` | days past due ≤ 0 | 5 · 1,152,000 (INV-8841, 8840, 8829, 8844, 8842) → "$11,520", "5 invoices" | "$96,400", "32 invoices" |
| `arAging.days1To30` | 1–30 | 4 · 1,307,000 (INV-8836 11 d, 8821 6 d, 8819 5 d, 8811 7 d past due) → "$13,070", "4 invoices" | "$41,200", "14 invoices" |
| `arAging.days31To60` | 31–60 | 1 · 159,000 (INV-8815, 33 d) → "$1,590", "1 invoices" | "$18,750", "5 invoices" |
| `arAging.days60Plus` | > 60 | 0 · 0 → "$0", "0 invoices · collections" | "$7,900", "2 invoices · collections" |

All four tiles differ from Runtruck1 (D5, 03 §8); wording and formatting are unchanged ("1 invoices" is Runtruck1's missing pluralisation, D6).

### 4.4 `meta.summary` for `status=overdue` (`OverdueInvoicesSummary`): Past Due

| field | formula (over every `overdue` invoice) | seed | Runtruck1 |
|---|---|---|---|
| `invoiceCount` | `count(*)` | 5 | 5 |
| `amountCents` | `Σ outstandingCents` | 1,466,000 ("$14,660") | $14,660 |
| `inCollectionsCount` | `count(*) FILTER (WHERE today − issued_on > 60)`: age **from issue**, strictly greater than 60 (Runtruck1's rule, accounting.md B6) | 2 (INV-8811 67 d, INV-8815 63 d) | 2 |
| `oldest` | the row with the largest age, first in row order on ties = the first row of the `overdue` order: `{invoiceId, invoiceNumber, customerName, ageDays}`; null when none | `{8811, 'Sierra Ag Partners', 67}` → "67 d", "INV-8811 · Sierra Ag Partners" | same |
| `accountsAffected` | `count(DISTINCT customer_id)` | 4 (Sierra Ag, Vantage, Cascade, Harbor Point) | 4 |
| `totalAccounts` | `count(*)` of the organization's `customers` | 6 ("of 6 accounts") | 6 |

Every value equals Runtruck1's.

### 4.5 `meta.summary` for `status=paid` (`PaidInvoicesSummary`): Paid

"Current month" = the calendar month of `today` (03 §6.0.1). A row's paid-on date is `latestPayment.paidOn`.

| field | formula | seed | Runtruck1 |
|---|---|---|---|
| `monthStart` | first day of the current month | `'2026-09-01'` → note "September" | "September" (hard-coded) |
| `paidThisMonthCount` | rows (status `paid`) whose `paidOn` is in the current month | 5 | 5 |
| `collectedThisMonthCents` | `Σ payments.amount_cents` of the organization's payments whose org-local `received_at` date is in the current month (literal 03 §6.7.5; any invoice) | 1,398,000 ("$13,980") | $13,980 |
| `avgDaysToPay` | `Math.round(Σ coalesce(daysToPay, 0) / max(rowCount, 1))` over **every** paid row, not only this month's (Runtruck1's rule; a paid invoice without a payment counts 0 days, Runtruck1 `p ? … : 0`) | round(77 / 5) = 15 | 15 |
| `factoredCount` | rows whose `latestPayment.method = 'factoring'` | 2 (INV-8838, INV-8839) | 2 |
| `factoredCents` | `Σ amountCents` (invoice totals) of those rows | 494,000 ("$4,940") | $4,940 |
| `factoringCompanyNames` | distinct `factoring_companies.name` of those rows, `ORDER BY name` | `['TriPoint Capital']` → "TriPoint Capital · $4,940" | "TriPoint Capital" (hard-coded) |

Every value equals Runtruck1's; the month name and the factor's name are now data, not literals. `avgDaysToPay` uses JavaScript `Math.round` on the exact quotient (computed in the service from the SQL sums, so half-up rounding matches Runtruck1).

### 4.6 `meta.summary` for `status=draft` (`DraftInvoicesSummary`)

`invoiceCount = count(*)`, `amountCents = Σ amountCents`. Seed: 1, 245,000. No screen shows drafts (Runtruck1 never did); the variant exists so every status has a defined summary.

### 4.7 Query plan (no N+1)

The page's ids are chosen **first**, and only those rows are decorated (totals, first item's load, latest payment), so a page costs the same whatever the organization's history ([04 §5.1](../04-api.md) rule 1):

```sql
-- $1 = org, $2 = status, $3 = today, $4 = org timezone
-- sent / overdue / draft: page AS MATERIALIZED (SELECT i.id FROM invoices i
--   WHERE i.organization_id = $1 AND i.status = $2 ORDER BY <per status, §4.2> LIMIT … OFFSET …)
-- paid (terminal, grows with the whole history): walk the payments newest first and keep each
-- paid invoice's latest one, then append the paid invoices without any payment (NULLS LAST):
--   head AS MATERIALIZED (SELECT i.id, py.received_at, i.invoice_number FROM payments py
--     JOIN invoices i ON i.organization_id = py.organization_id AND i.id = py.invoice_id
--     WHERE py.organization_id = $1 AND i.status = 'paid'
--       AND NOT EXISTS (SELECT 1 FROM payments later WHERE later.organization_id = py.organization_id
--                       AND later.invoice_id = py.invoice_id AND (later.received_at, later.id) > (py.received_at, py.id))
--     ORDER BY py.received_at DESC, i.invoice_number LIMIT offset + limit),     -- payments_org_received_idx, backward
--   tail AS (SELECT i.id, NULL, i.invoice_number FROM invoices i WHERE … status = 'paid'
--     AND (SELECT count(*) FROM head) < offset + limit AND NOT EXISTS (a payment)
--     ORDER BY i.invoice_number LIMIT offset + limit),
--   page AS MATERIALIZED (SELECT id FROM (head UNION ALL tail) u
--     ORDER BY received_at DESC NULLS LAST, invoice_number LIMIT … OFFSET …)
WITH page AS (…)
SELECT i.id, i.invoice_number, i.customer_id, cu.name, i.status, i.issued_on, i.due_on,
       $3 - i.issued_on AS age_days, $3 - i.due_on AS days_past_due,
       coalesce(t.total_cents, 0) AS amount_cents, coalesce(pt.paid_cents, 0) AS paid_cents,
       it1.load_id, l.load_number,
       lp.id AS payment_id, lp.received_at, (lp.received_at AT TIME ZONE $4)::date AS paid_on,
       lp.method, lp.factoring_company_id, fc.name AS factoring_company_name, lp.amount_cents AS payment_cents
FROM page
JOIN invoices i ON i.organization_id = $1 AND i.id = page.id
JOIN customers cu ON cu.organization_id = i.organization_id AND cu.id = i.customer_id
LEFT JOIN LATERAL (SELECT sum(ii.amount_cents) AS total_cents FROM invoice_items ii
                   WHERE ii.organization_id = i.organization_id AND ii.invoice_id = i.id) t ON true
LEFT JOIN invoice_items it1 ON it1.organization_id = i.organization_id AND it1.invoice_id = i.id AND it1.position = 1
LEFT JOIN loads l ON l.organization_id = i.organization_id AND l.id = it1.load_id
LEFT JOIN LATERAL (SELECT sum(p.amount_cents) AS paid_cents FROM payments p
                   WHERE p.organization_id = i.organization_id AND p.invoice_id = i.id) pt ON true
LEFT JOIN LATERAL (SELECT p.* FROM payments p
                   WHERE p.organization_id = i.organization_id AND p.invoice_id = i.id
                   ORDER BY p.received_at DESC, p.id DESC LIMIT 1) lp ON true
LEFT JOIN factoring_companies fc ON fc.organization_id = lp.organization_id AND fc.id = lp.factoring_company_id
ORDER BY <per status, §4.2>
```

The summary is one statement over the same relation. The Paid summary covers every paid invoice by definition (`avgDaysToPay`), so it reads the paid history once but **set-based**, with no lateral or subquery per invoice: each invoice's latest payment from one `row_number() OVER (PARTITION BY invoice_id ORDER BY received_at DESC, id DESC)` pass over the organization's payments, joined by `invoice_id`, and `factoredCents` from one join of the factored paid invoices with their items. (For `sent` the filter is `status IN ('sent', 'overdue')` and the buckets are `count(*) FILTER (WHERE days_past_due …)` / `sum(outstanding) FILTER (…)`; `totalAccounts` and `collectedThisMonthCents` are scalar subqueries on `customers` and `payments`, both organization-filtered; `payments_org_received_idx` serves the month range). Indexes: `invoices_org_status_issued_idx`, `invoice_items_invoice_position_uq`, `payments_org_invoice_idx`, `payments_org_received_idx`.

### 4.8 Errors and tenancy

`400 VALIDATION_ERROR` (status missing or not one of the four; bad paging), `401`, `403 FORBIDDEN` without `billing.view`. Organization predicate on invoices, customers, invoice items, loads, payments and factoring companies.

---

## 5. `GET /invoice-batches`

- **Permission:** `billing.view`.
- **Query:** `listInvoiceBatchesQuerySchema` (= `pageQuerySchema`).

### 5.1 Response row `InvoiceBatchRow`

| field | type | computed from |
|---|---|---|
| `id` | uuid | `invoice_batches.id` |
| `batchNumber` | integer | `invoice_batches.batch_number` |
| `createdOn` | date | `invoice_batches.created_on` |
| `status` | `InvoiceBatchStatus` | `invoice_batches.status` |
| `recipient` | `{kind, id, name}` | `kind = 'customer'` with `customers.name` when `customer_id` is set, else `'factoring_company'` with `factoring_companies.name` (exactly one is set, `invoice_batches_recipient_ck`) |
| `sentTo` | string | 03 §6.0.8: the customer name, or `${factoring company name} (factoring)` |
| `invoiceCount` | integer | `count(DISTINCT invoice_batch_items.invoice_id)` of the batch |
| `totalCents` | integer | `Σ invoice_items.amount_cents` of the member invoices (Σ invoice totals) |

**Order:** `batch_number DESC`. Seed: B-2035 … B-2029 (= Runtruck1's array order, which is also `created_on DESC`).

**Searchable fields (`q`):** the view row `id, created, invoices, total, sentTo, status` (§7.3; `invoices` is a number, as in Runtruck1).

Seed rows (membership 03 §7.16, 01 C5):

| batch | created | recipient | status | invoices | total | Runtruck1 |
|---|---|---|---|---|---|---|
| B-2035 | Sep 3 | Northgate Foods | ready | 2 (8845, 8841) | 443,000 | 2 · $4,430 |
| B-2034 | Sep 2 | Cascade Building Supply | ready | 3 (8829, 8842, 8819) | 855,000 | 3 · **$8,120** |
| B-2033 | Sep 1 | TriPoint Capital (factoring) | sent | 2 (8838, 8839) | 494,000 | 2 · $4,940 |
| B-2032 | Aug 29 | Bayline Distribution | sent | 2 (8840, 8823) | 482,000 | **4 · $11,310** |
| B-2031 | Aug 26 | Harbor Point Retail | sent | 2 (8824, 8821) | 559,000 | **3 · $7,670** |
| B-2030 | Aug 22 | TriPoint Capital (factoring) | settled | 0 | 0 | **5 · $14,230** |
| B-2029 | Aug 19 | Northgate Foods | settled | 1 (8830) | 245,000 | **3 · $8,410** |

### 5.2 `meta.summary` (`InvoiceBatchesSummary`)

| field | formula (over every batch) | seed | Runtruck1 |
|---|---|---|---|
| `batchCount` | `count(*)` | 7 | 7 |
| `invoiceCount` | `Σ invoiceCount` | **12** ("12 invoices") | "22 invoices" |
| `readyCount` | `count(*) FILTER (WHERE status = 'ready')` | 2 | 2 |
| `readyTotalCents` | `Σ totalCents` of `ready` batches | **1,298,000** ("$12,980 to go out") | "$12,550 to go out" |
| `sentThisWeekCount` | `count(*) FILTER (WHERE status = 'sent' AND today − created_on < 7)` (created date, no lower bound: Runtruck1's rule, accounting.md B8) | 2 (B-2033 2 d, B-2032 5 d; B-2031 8 d excluded) | 2 |
| `totalCents` | `Σ totalCents` (all statuses) | **3,078,000** ("$30,780") | "$59,110" |

### 5.3 Query plan (no N+1)

```sql
SELECT ib.id, ib.batch_number, ib.created_on, ib.status, ib.customer_id, ib.factoring_company_id,
       coalesce(cu.name, fc.name) AS recipient_name,
       coalesce(m.invoice_count, 0) AS invoice_count, coalesce(m.total_cents, 0) AS total_cents
FROM invoice_batches ib
LEFT JOIN customers cu ON cu.organization_id = ib.organization_id AND cu.id = ib.customer_id
LEFT JOIN factoring_companies fc ON fc.organization_id = ib.organization_id AND fc.id = ib.factoring_company_id
LEFT JOIN LATERAL (
  SELECT count(DISTINCT bi.invoice_id) AS invoice_count, sum(ii.amount_cents) AS total_cents
  FROM invoice_batch_items bi
  LEFT JOIN invoice_items ii ON ii.organization_id = bi.organization_id AND ii.invoice_id = bi.invoice_id
  WHERE bi.organization_id = ib.organization_id AND bi.batch_id = ib.id) m ON true
WHERE ib.organization_id = $1
ORDER BY ib.batch_number DESC
```

The summary aggregates the same relation in one statement. Indexes: `invoice_batches_org_number_uq`, `invoice_batch_items_org_batch_idx`, `invoice_items_invoice_position_uq`.

### 5.4 Errors and tenancy

`400`, `401`, `403 FORBIDDEN` without `billing.view`. Organization predicate on every relation.

---

## 6. Writes

**None in this release.** Every billing control is either navigation or an inert stub (01 §7, [07](../07-roles-permissions.md) §6.3):

| Control | Behaviour | Permission of the future endpoint |
|---|---|---|
| "Invoice N loads" (Uninvoiced header) | navigates to `/app/accounting/invoiced`; creates nothing (D6) | `billing.create` |
| "+ New Batch" (Invoiced header) | navigates to `/app/accounting/batches` | `billing.create` |
| "Export batch", "+ New Batch" (Batches), "Send reminders", "Export", "Filters" | inert | `billing.view` / `billing.create` / `billing.approve` |

Consequently no billing audit action or domain event is emitted. The reserved transitions, their audit actions and events are specified in [11-billing-lifecycle.md](../11-billing-lifecycle.md) §3–§6 and are added to this document when built.

---

## 7. Web mapping

### 7.0 Shared rules

- Formatters come from `@runtruck/calculations`: `formatMoney` (F-MONEY), `formatShortDate` (F-SHORT), `formatAge` (F-AGE), `formatLoadNumber`, `formatInvoiceNumber`, `formatBatchNumber`, `EM_DASH`.
- **View rows.** Each DTO row is mapped to a *view row* whose keys and string/number values are exactly those of the Runtruck1 mock row (minus `tagClass`), plus a non-searchable `tone` for the chip. The top-bar search runs `matchesQuery(viewRow, query)` (`apps/web/src/lib/search.ts`, which skips `tagClass` and `tone`). The row's UUID is **not** a view-row property (a UUID would make `q=4` match every row); the table keeps `{ key: dto.id, view }` pairs and uses `key` as the React key (accounting.md H19).
- The mappers are pure functions, used by the web for display and search and by the API for `q` (§1). Their home is a shared runtime package (`@runtruck/calculations`, e.g. `src/views/accounting.ts`), requested from its owner (§9); names below.
- Calls: TanStack Query, `api.get<Row[], Meta>(path)`, `limit=500`. KPIs and footers read `meta.summary`, which the search never changes. The empty state renders `Nothing matches “{query}”.` after the table when the filtered list is empty (raw, untrimmed query).
- Empty-list KPIs (01 C1): Runtruck1 dereferences `UNINVOICED[0]` / `OVERDUE[0]` unguarded. The port does not crash: when `oldest` is null the tile shows value "—" and note "None" (03 §6.0.9). The seed never produces this case.

### 7.1 Uninvoiced — `/app/accounting/uninvoiced`

Calls `GET /billing/uninvoiced-loads?limit=500`, query key `['billing', 'uninvoiced-loads']`. The Header (`useUninvoicedCount()` in `apps/web/src/lib/api/billing.ts`) reads the **same query key** and renders `Invoice ${summary.loadCount} loads` ("Invoice 11 loads"; "Invoice 1 loads" is the literal D6 wording).

**Header label and its data** (resolves accounting.md §10 D5; recorded in 01 §6):
- **First paint reads "Invoice 11 loads".** For a request under `/app/accounting/` by a member with `billing.view`, the server prefetches `['billing', 'uninvoiced-loads']` (`limit=500`) and hydrates it **above the Header** (the `/app` shell's hydration boundary), so the Header's first render already has the count, as Runtruck1's synchronous `UNINVOICED.length` did. The Uninvoiced page reads the same cache entry; switching accounting tabs refetches nothing.
- **No request on other routes.** `useUninvoicedCount()` is a `useQuery` with `enabled: pathname === '/app/accounting/uninvoiced' && can('billing.view')`. The Header calls it on every `/app` route, but it fetches only where the label is shown and only for a member who may read it, so a Dispatcher never sends a request that would be refused.
- **Without `billing.view`** the "Invoice N loads" button is not rendered (07 §5 rule for controls backed by API data; the Accounting section is hidden from such members anyway).
- **Count not known** (the prefetch failed and the client query is pending or failed): the button is not rendered, so the double-space text "Invoice  loads" can never appear. With the prefetch this does not happen in normal use.

View row `UninvoicedViewRow` (mapper `uninvoicedViewRow(row: UninvoicedLoadRow)`):

| key (Runtruck1) | value | seed example |
|---|---|---|
| `id` | `formatLoadNumber(loadNumber)` | "L-40209" |
| `customer` | `customerName` | "Northgate Foods" |
| `route` | `route ?? EM_DASH` | "Fresno, CA → Reno, NV" |
| `delivered` | `deliveredOn ? formatShortDate(deliveredOn) : EM_DASH` | "Sep 2" |
| `pod` | `podStatus === 'attached' ? 'Attached' : 'Missing'` | "Attached" |
| `amount` | `formatMoney(amountCents)` | "$2,450" |
| `tone` (not searched) | `attached` → `'green'`, `missing` → `'amber'` | |

Columns: Load (`td.strong`, `id`) · Customer · Route (`td.muted`) · Delivered · POD (left-aligned `Tag`) · Amount (`th.num`/`td.num`). Card title "Delivered, not yet invoiced".

KPIs (`summary`):

| label | value | note |
|---|---|---|
| Loads | `String(loadCount)` → "11" | "Delivered, not yet invoiced" |
| Amount waiting | `formatMoney(amountCents)` → "$34,900" | `` `Across ${customerCount} customers` `` → "Across 6 customers" |
| Missing POD | `String(missingPodCount)` → "3" | "Cannot invoice until attached" |
| Oldest (days) | `String(oldest.ageDays)` → "7" | `` `${formatLoadNumber(oldest.loadNumber)} · delivered ${formatShortDate(oldest.deliveredOn)}` `` → "L-40199 · delivered Aug 27" |

### 7.2 Invoiced — `/app/accounting/invoiced`

Calls `GET /invoices?status=sent&limit=500`, key `['invoices', 'sent']`.

View row `InvoiceViewRow` (mapper `invoiceViewRow(row: InvoiceRow)`; also used by Past Due):

| key (Runtruck1) | value | seed example |
|---|---|---|
| `id` | `formatInvoiceNumber(invoiceNumber)` | "INV-8844" |
| `customer` | `customerName` | "Vantage Home Goods" |
| `load` | `loadNumber === null ? EM_DASH : formatLoadNumber(loadNumber)` | "L-40197" |
| `issued` | `issuedOn ? formatShortDate(issuedOn) : EM_DASH` | "Sep 2" |
| `amount` | `formatMoney(amountCents)` | "$2,260" |
| `age` | `formatAge(ageDays)` | "1 d" |
| `status` | status label (§1.1) | "Sent" |
| `tone` (not searched) | status tone (§1.1) | `'blue'` |

Columns: Invoice (`strong`) · Customer · Load (`muted`) · Issued · Amount (`num`) · Age (`num`) · Status (`num`, right-aligned chip). Card title "Open invoices".

KPIs (`summary.arAging`, `summary.status === 'sent'`):

| label | value | note | seed |
|---|---|---|---|
| Current | `formatMoney(current.amountCents)` | `` `${current.invoiceCount} invoices` `` | "$11,520" · "5 invoices" |
| 1–30 days (U+2013) | `formatMoney(days1To30.amountCents)` | `` `${n} invoices` `` | "$13,070" · "4 invoices" |
| 31–60 days | `formatMoney(days31To60.amountCents)` | `` `${n} invoices` `` | "$1,590" · "1 invoices" |
| 60+ days | `formatMoney(days60Plus.amountCents)` | `` `${n} invoices · collections` `` | "$0" · "0 invoices · collections" |

### 7.3 Batches — `/app/accounting/batches`

Calls `GET /invoice-batches?limit=500`, key `['invoice-batches']`.

View row `InvoiceBatchViewRow` (mapper `invoiceBatchViewRow(row: InvoiceBatchRow)`):

| key (Runtruck1) | value | seed example |
|---|---|---|
| `id` | `formatBatchNumber(batchNumber)` | "B-2035" |
| `created` | `formatShortDate(createdOn)` | "Sep 3" |
| `invoices` | `invoiceCount` (a **number**) | 2 |
| `total` | `formatMoney(totalCents)` | "$4,430" |
| `sentTo` | `sentTo` | "TriPoint Capital (factoring)" |
| `status` | batch label (§1.1) | "Ready" |
| `tone` (not searched) | batch tone | `'blue'` |

Columns: Batch (`strong`) · Created · Invoices (`num`, plain integer) · Sent to (`muted`) · Total (`num`) · Status (`num`, chip). Card title "Invoice batches".

KPIs:

| label | value | note | seed |
|---|---|---|---|
| Batches | `String(batchCount)` | `` `${invoiceCount} invoices` `` | "7" · "12 invoices" |
| Ready to send | `String(readyCount)` | `` `${formatMoney(readyTotalCents)} to go out` `` | "2" · "$12,980 to go out" |
| Sent this week | `String(sentThisWeekCount)` | "Last 7 days" | "2" |
| Total batched | `formatMoney(totalCents)` | "Ready, sent and settled" | "$30,780" |

### 7.4 Past Due — `/app/accounting/past-due`

Calls `GET /invoices?status=overdue&limit=500`, key `['invoices', 'overdue']`. View row: `invoiceViewRow` (§7.2); seed first row `{id 'INV-8811', customer 'Sierra Ag Partners', load 'L-40168', issued 'Jun 28', amount '$3,860', age '67 d', status 'Overdue', tone 'amber'}`. Columns as Invoiced; card title "Past due".

KPIs (`summary.status === 'overdue'`):

| label | value | note | seed |
|---|---|---|---|
| Overdue invoices | `String(invoiceCount)` | "Past terms" | "5" |
| Amount overdue | `formatMoney(amountCents)` | `` `${inCollectionsCount} in collections (60+ days)` `` | "$14,660" · "2 in collections (60+ days)" |
| Oldest | `formatAge(oldest.ageDays)` | `` `${formatInvoiceNumber(oldest.invoiceNumber)} · ${oldest.customerName}` `` | "67 d" · "INV-8811 · Sierra Ag Partners" |
| Accounts affected | `String(accountsAffected)` | `` `of ${totalAccounts} accounts` `` | "4" · "of 6 accounts" |

### 7.5 Paid — `/app/accounting/paid`

Calls `GET /invoices?status=paid&limit=500`, key `['invoices', 'paid']`.

View row `PaidInvoiceViewRow` (mapper `paidInvoiceViewRow(row: InvoiceRow)`; Runtruck1's row is `{...invoice, paid, via, days}`):

| key (Runtruck1) | value | seed example |
|---|---|---|
| `id`, `customer`, `load`, `issued`, `amount` | as §7.2 | "INV-8823", "Bayline Distribution", "L-40183", "Aug 5", "$3,180" |
| `age` (searched, not shown) | `formatAge(ageDays)` | "29 d" |
| `status` (searched, not shown) | "Paid" | "Paid" |
| `paid` | `latestPayment ? formatShortDate(latestPayment.paidOn) : EM_DASH` | "Sep 3" |
| `via` | `latestPayment ? method label (§1.1) : EM_DASH` | "Check" |
| `days` | `daysToPay ?? 0` (a **number**; Runtruck1 `p ? … : 0`) | 29 |
| `tone` (not searched) | Via tone: `factoring` → `'blue'`, otherwise `'gray'` | `'gray'` |

Columns: Invoice (`strong`) · Customer · Load (`muted`) · Issued · Paid · Via (**left-aligned** chip) · Amount (`num`) · Days to pay (`num`, plain integer). Card title "Paid invoices".

KPIs (`summary.status === 'paid'`):

| label | value | note | seed |
|---|---|---|---|
| Paid this month | `String(paidThisMonthCount)` | month name of `monthStart` (en-US, long: "September") | "5" · "September" |
| Amount | `formatMoney(collectedThisMonthCents)` | "Collected this month" | "$13,980" |
| Avg days to pay | `String(avgDaysToPay)` | "Issued to paid" | "15" |
| Paid via factoring | `String(factoredCount)` | `` `${names.length ? names.join(', ') : EM_DASH} · ${formatMoney(factoredCents)}` `` | "2" · "TriPoint Capital · $4,940" |

The month name needs a formatter (`formatMonthName(date)` → "September") that `@runtruck/calculations` does not have yet (§9).

---

## 8. D5 differences (Runtruck1 → computed)

Everything else on the five billing screens equals Runtruck1 (§3.2, §4.4, §4.5, §5.2).

| screen | value | Runtruck1 | computed (seed) |
|---|---|---|---|
| Invoiced | Current | $96,400 · 32 invoices | $11,520 · 5 invoices |
| Invoiced | 1–30 days | $41,200 · 14 invoices | $13,070 · 4 invoices |
| Invoiced | 31–60 days | $18,750 · 5 invoices | $1,590 · 1 invoices |
| Invoiced | 60+ days | $7,900 · 2 invoices · collections | $0 · 0 invoices · collections |
| Batches | Batches note | 22 invoices | 12 invoices |
| Batches | Ready to send note | $12,550 to go out | $12,980 to go out |
| Batches | Total batched | $59,110 | $30,780 |
| Batches | B-2034 total | $8,120 | $8,550 |
| Batches | B-2032 invoices / total | 4 / $11,310 | 2 / $4,820 |
| Batches | B-2031 invoices / total | 3 / $7,670 | 2 / $5,590 |
| Batches | B-2030 invoices / total | 5 / $14,230 | 0 / $0 |
| Batches | B-2029 invoices / total | 3 / $8,410 | 1 / $2,450 |

---

## 9. Decisions and open points

Decisions made in this document (to record in [01](../01-product-requirements.md) §6):

1. **`GET /invoices` takes exactly one required `status`**, and `meta.summary` is a union discriminated by `summary.status` (sent → AR aging, overdue → Past Due, paid → Paid, draft → count/amount). Paid rows carry `latestPayment` and `daysToPay`; there is **no `GET /payments`** in this release ([07](../07-roles-permissions.md) §6.1/§6.2 updated accordingly).
2. **Empty-list KPIs** (applies C1): "Oldest" tiles show "—" / "None" instead of Runtruck1's crash. Unreachable with the seed.
3. **Paid KPIs:** "Collected this month" sums every payment of the organization received in the current month (literal 03 §6.7.5); "Paid via factoring" sums the rows' invoice totals and lists the distinct factor names sorted, "—" when none; a paid invoice without a payment shows Paid "—", Via "—", Days 0 and counts 0 days in the average (Runtruck1 `p ? … : 0`).
4. **Server-side `q`** is evaluated in the service over the view rows (§7.0), after the SQL fetch, over at most the first 5,000 rows of the list's filter in list order (the cap of [04 §5.1](../04-api.md)); rows beyond it are not searched. Exact parity within the cap; a SQL search document replaces the cap when a screen needs full-history search (the web never sends `q` today).
5. **Header "Invoice N loads"** (accounting.md §10 D5): prefetched on the server for `/app/accounting/*` and hydrated above the Header; fetched on the client only on `/app/accounting/uninvoiced` with `billing.view`; hidden without `billing.view` or while the count is unknown (§7.1).

Cross-domain dependencies:
- **Loads domain:** the first-pickup / last-delivery / route-label / `delivered_on` SQL helpers (03 §6.0.3) are shared; billing imports them.
- **Dashboard domain:** "Unbilled loads" (`11`, `$34,900 waiting`) must call the billing module's uninvoiced query (exported provider, e.g. `UninvoicedLoadsQuery.summary(tx, ctx)`), not re-implement §3.
- **Customers domain:** CRM "Open AR" and per-customer AR balances use `outstandingCents` of `sent` + `overdue` invoices (this document §4.1; 03 §8 gives $26.2K).
- **`@runtruck/calculations` owner:** add `formatMonthName` and the view-row mappers of §7 (`uninvoicedViewRow`, `invoiceViewRow`, `paidInvoiceViewRow`, `invoiceBatchViewRow`), plus the label/tone maps of §1.1.
- **Web shell:** `apps/web/src/lib/api/billing.ts` must export `useUninvoicedCount()` over the query key of §7.1 with the `enabled` rule and the server prefetch/hydration of §7.1 (the Header already imports it; its current `Invoice ${uninvoiced ?? ''} loads` must change to hide the button while the count is unknown).
