# API — Customers (CRM)

Endpoint specification for `/app/crm` (KPIs, top-account cards, "All accounts" table) and for the New Load "Customer" and "Bill to" selects. It follows [04-api.md](../04-api.md) and computes every value by the rules of [03-database.md §6.5](../03-database.md) (D5). The screen is specified in [reference/runtruck1/core-pages.md](../reference/runtruck1/core-pages.md) §5; the selects in [new-load.md](../reference/runtruck1/new-load.md) §6.1.

- Wire types: `packages/types/src/customers.ts`. Input schemas: `packages/validation/src/customers.ts`.
- API module (architecture §6): `apps/api/src/customers/`, registered in `apps/api/src/modules/fleet-crm.ts`.

## 0. Feature summary (architecture §44)

| item | content |
|---|---|
| FEATURE | CRM read view: accounts with year-to-date loads, revenue, on-time rate and open AR; KPI row; top-account cards. |
| PURPOSE | Runtruck1 parity (R1) with every figure computed from loads and invoices (R2, D5). |
| USERS | Dispatchers, accounting, managers. |
| PERMISSIONS | `customers.view` ([07 §6.1](../07-roles-permissions.md)). |
| DATABASE TABLES | read: `customers`, `customer_contacts`, `loads`, `load_stops`, `invoices`, `invoice_items`, `payments`. |
| DATABASE CHANGES | none. |
| API ENDPOINTS | `GET /customers` (CRM), `GET /customers/options` (New Load selects, §2.8). |
| BUSINESS RULES | 03 §6.5 (Loads YTD by load date, revenue, lateness, AR balance, top-3 share, top-account selection). |
| STATE CHANGES / EVENTS / JOBS / NOTIFICATIONS / INTEGRATIONS / AI | none. Read-only; "+ Add Customer" is an inert stub (§4). |
| SECURITY | session auth, permission guard, organization from the session only; contact e-mails are personal data and are returned only for the primary contact. |
| ERROR CASES | §1.4. |
| TESTS | §5. |
| ACCEPTANCE CRITERIA | the seed renders the strings of §3 (formatting and wording identical to Runtruck1; the numbers of §6 differ, D5); tenant isolation and permission denial proven; architecture §45. |

## 1. Shared rules

### 1.1 Clock

`today = ClockService.today(ctx.timezone)` (D4; 2026-09-03). **YTD** = January 1 of today's year … today, inclusive (2026-01-01 … 2026-09-03).

### 1.2 List mechanics, `q`, tenancy

As [fleet.md §1.2–§1.4](fleet.md) and the list strategy of [04 §5.1](../04-api.md): the service computes every customer row of the organization with the fixed statement of §2.7 (customers are reference data, tens to a few thousand per organization; the aggregates read only this year's loads and the open invoices, never the whole history), computes `meta.summary` over all rows (never filtered by `q`), then filters by `q` over the searchable display strings of §2.4 (Runtruck1 `matchesQuery`: trimmed, lowercased substring; an empty `q` matches all; at most the first 5,000 rows are matched, 04 §5.1), sets `meta.total` to the filtered count and returns `rows.slice(offset, offset + limit)`. Every table read is filtered by `organization_id = ctx.organizationId`, and every join matches `organization_id` on both sides.

### 1.3 Load facts used by the CRM (03 §6.0.3)

Over **all** the customer's loads, board and archived (`loads.customer_id`):

| term | rule (columns) |
|---|---|
| first pickup / last delivery | the `pickup` stop with the lowest `sequence` (else the lowest-sequence stop) / the `delivery` stop with the highest `sequence` (else the highest-sequence stop) |
| load date | the first pickup's `appointment_date`; for a load without stops, the smallest `invoices.issued_on` among invoices that have an `invoice_items` row for the load; otherwise none |
| YTD load | a load whose load date is in YTD |
| revenue | `line_haul_cents + fuel_surcharge_cents + accessorial_cents`, cast to `bigint` before adding in SQL (03 §6.0.3) |
| late | `loads.status = 'delayed'`, or the last delivery's `arrived_at` is later than `appointment_date + coalesce(window_close, '23:59')` read as wall clock in `load_stops.timezone` |
| invoice outstanding | Σ `invoice_items.amount_cents` − Σ `payments.amount_cents` of the invoice |

### 1.4 Errors

| HTTP | code | when |
|---|---|---|
| 400 | `VALIDATION_ERROR` | `limit` outside 1–500, negative `offset`, `q` longer than 200. |
| 401 | `UNAUTHORIZED` | no or expired session. |
| 403 | `FORBIDDEN` | the member lacks `customers.view`. |
| 403 | `NO_ACTIVE_MEMBERSHIP` | the account has no active organization. |
| 500 | `INTERNAL_ERROR` | anything unexpected (logged with the request id). |

### 1.5 Audit and events

None (read-only). The future "+ Add Customer" write is listed in §4.

## 2. `GET /api/v1/customers`

| | |
|---|---|
| Permission | `customers.view`. It covers the account aggregates (YTD revenue, on-time rate, AR balance) computed from loads and invoices, as `dashboard.view` covers the Dashboard's billing figures (07 §7; decision CU1). |
| Query | `customerListQuerySchema` → `CustomerListQuery`: `limit`, `offset`, `q`. |
| Response | `CustomerListResponse` = `{ data: CustomerListItem[], meta: CustomerListMeta }`. |
| Consumers | CRM. New Load's "Customer" and "Bill to" selects use the light `GET /customers/options` (§2.8), which computes no aggregates. |

### 2.1 `CustomerListItem`

| field | type | computed from |
|---|---|---|
| `id` | `string` (uuid) | `customers.id` |
| `name` | `string` | `customers.name` |
| `standing` | `CustomerStanding` | `customers.standing` |
| `paymentTerms` | `PaymentTerms` | `customers.payment_terms` (New Load's default terms) |
| `primaryContact` | `{ id, fullName, email } \| null` | the `customer_contacts` row with `is_primary` (at most one, `customer_contacts_primary_uq`); `email` may be null; null when the customer has no primary contact. Phone is not returned (not displayed). |
| `loadsYtd` | `number` | count of the customer's YTD loads (§1.3) |
| `revenueYtdCents` | `number` | Σ revenue of those loads |
| `onTimePercent` | `number \| null` | `Math.round(100 × (n − late) / n)` over those `n` loads; null when `n = 0` |
| `arBalanceCents` | `number` | Σ outstanding of the customer's invoices with `status IN ('sent', 'overdue')` (drafts and paid invoices excluded) |

### 2.2 Order

`ORDER BY customers.position, customers.id`: Northgate Foods, Bayline Distribution, Cascade Building Supply, Harbor Point Retail, Sierra Ag Partners, Vantage Home Goods (Runtruck1's `CUSTOMERS` order, also the New Load select order).

### 2.3 Top accounts (deterministic rule)

`summary.topAccounts` = customers with `standing = 'key_account'`, then those with `standing = 'at_risk'`, each group in `position, id` order, **first 3**. Growing accounts never appear. The cards are not filtered by the search (Runtruck1 parity). Seed: Northgate Foods, Bayline Distribution, Sierra Ag Partners, exactly Runtruck1's `TOP_ACCOUNTS`.

The "Top 3 accounts = N%" note is a different selection, kept from Runtruck1 (core-pages B10): the three customers with the **largest `revenueYtdCents`** (ties by `position`, then `id`), whatever their standing.

### 2.4 Searchable fields (`q`)

The Runtruck1 `Customer` fields except `tagClass`, as display strings (view-model §3.1): `name`, `contact`, `loads`, `revenue` ("$11K"), `onTime` ("100%"), `terms` ("Net 45"), `ar` ("$8,550"), `tier` ("At risk"). So "net 45" matches Cascade Building Supply and "at risk" matches Sierra Ag Partners, as in Runtruck1.

### 2.5 `meta.summary`: `CustomerListSummary`

Computed over all of the organization's customers.

| field | type | formula | seed | Runtruck1 |
|---|---|---|---|---|
| `asOf` | `string` | `today` | `"2026-09-03"` | |
| `ytdStart` | `string` | January 1 of today's year | `"2026-01-01"` | |
| `accountCount` | `number` | count of customers | 6 | 6 |
| `keyAccountCount` | `number` | count `standing = 'key_account'` | 2 | 2 |
| `atRiskCount` | `number` | count `standing = 'at_risk'` | 1 | 1 |
| `revenueYtdCents` | `number` | Σ `revenueYtdCents` | 8,360,000 → "$0.1M" | "$1.3M" |
| `top3SharePercent` | `number` | `Math.round(100 × Σ of the three largest revenueYtdCents / revenueYtdCents)`; 0 when the total is 0 | Sierra 1,820,000 + Cascade 1,713,000 + Bayline 1,480,000 = 5,013,000 → 60 | 73 |
| `onTimePercent` | `number \| null` | `Math.round(100 × Σ (loadsYtd − late) / Σ loadsYtd)` ("Weighted by loads"); null when Σ loadsYtd = 0 | 28 / 29 → 97 | 92 |
| `openArCents` | `number` | Σ `arBalanceCents` | 2,618,000 → "$26.2K" | "$91.9K" |
| `topAccounts` | `CustomerListItem[]` | §2.3, full items so the cards never depend on the filtered rows | Northgate, Bayline, Sierra | same names |

### 2.6 Rows against the seed

| customer | standing | terms | primary contact (email) | YTD loads | loadsYtd (R1) | revenueYtdCents → F-K (R1) | onTimePercent (R1) | arBalanceCents → F-MONEY (R1) |
|---|---|---|---|---|---|---|---|---|
| Northgate Foods | key_account | net_30 | Dana Ruiz (dana@northgate.com) | L-40218, 40214, 40209, 40203, 40187 | 5 (184) | 1,131,000 "$11K" ($412K) | 100 (96) | 198,000 "$1,980" ($18,400) |
| Bayline Distribution | key_account | net_30 | Owen Petrakis (ops@bayline.co) | L-40219, 40212, 40208, 40202, 40183 | 5 (151) | 1,480,000 "$15K" ($338K) | 100 (94) | 164,000 "$1,640" ($12,900) |
| Cascade Building Supply | growing | net_45 | Marta Lind (—) | L-40220 (delayed), 40207, 40201, 40198, 40196, 40176 | 6 (77) | 1,713,000 "$17K" ($196K) | 83 (91) | 855,000 "$8,550" ($21,300) |
| Harbor Point Retail | growing | net_30 | Jules Amari (—) | L-40206, 40191, 40178 | 3 (44) | 913,000 "$9K" ($121K) | 100 (89) | 218,000 "$2,180" ($6,100) |
| Sierra Ag Partners | at_risk | net_60 | Ben Okafor (ben@sierraag.com) | L-40210, 40205, 40200, 40190, 40168 | 5 (62) | 1,820,000 "$18K" ($154K) | 100 (82) | 798,000 "$7,980" ($29,300) |
| Vantage Home Goods | growing | net_30 | Iris Chen (—) | L-40204, 40199, 40197, 40189, 40172 | 5 (29) | 1,303,000 "$13K" ($74K) | 100 (93) | 385,000 "$3,850" (same) |

Not YTD: L-40222 (Cascade, first pickup Sep 5) and L-40221 (Harbor Point, Sep 4) are after today. The invoice-only loads count by their invoice's `issued_on` (01 C8). AR items: Northgate INV-8841; Bayline INV-8840; Cascade INV-8829, INV-8842, INV-8819; Harbor Point INV-8821; Sierra INV-8836, INV-8811; Vantage INV-8844, INV-8815. No seeded stop has an `arrived_at`, so the only late load is the `delayed` L-40220.

Example item:

```json
{
  "id": "…", "name": "Sierra Ag Partners", "standing": "at_risk", "paymentTerms": "net_60",
  "primaryContact": { "id": "…", "fullName": "Ben Okafor", "email": "ben@sierraag.com" },
  "loadsYtd": 5, "revenueYtdCents": 1820000, "onTimePercent": 100, "arBalanceCents": 798000
}
```

### 2.7 Query plan (no N+1)

One statement, whatever the number of customers. It reads only this year's candidate loads and the open invoices, never the organization's whole history (architecture §37, §38): the stop look-ups are per candidate load (`LATERAL … LIMIT 1` on `load_stops_load_sequence_uq`), not an organization-wide `DISTINCT ON` over every stop.

```sql
WITH candidate AS (   -- every load whose load date can fall in YTD (§1.3)
  SELECT s.load_id AS id
  FROM load_stops s                                     -- a stop dated in YTD (load_stops_org_date_idx)
  WHERE s.organization_id = $org AND s.appointment_date BETWEEN $ytdStart AND $today
  UNION
  SELECT ii.load_id                                     -- or an invoice issued in YTD (stop-less loads, 01 C8)
  FROM invoices i
  JOIN invoice_items ii ON ii.organization_id = i.organization_id AND ii.invoice_id = i.id
  WHERE i.organization_id = $org AND i.issued_on BETWEEN $ytdStart AND $today AND ii.load_id IS NOT NULL),
ytd_load AS (
  SELECT l.customer_id, l.status,
         l.line_haul_cents::bigint + l.fuel_surcharge_cents + l.accessorial_cents AS revenue,   -- cast before adding (03 §6.0.3)
         ls.appointment_date AS last_on, ls.window_close, ls.timezone, ls.arrived_at
  FROM candidate c
  JOIN loads l ON l.organization_id = $org AND l.id = c.id
  LEFT JOIN LATERAL (SELECT s.appointment_date FROM load_stops s
                     WHERE s.organization_id = l.organization_id AND s.load_id = l.id
                     ORDER BY (s.kind <> 'pickup'), s.sequence LIMIT 1) fs ON true
  LEFT JOIN LATERAL (SELECT s.appointment_date, s.window_close, s.timezone, s.arrived_at FROM load_stops s
                     WHERE s.organization_id = l.organization_id AND s.load_id = l.id
                     ORDER BY (s.kind <> 'delivery'), s.sequence DESC LIMIT 1) ls ON true
  LEFT JOIN LATERAL (SELECT min(i.issued_on) AS issued_on FROM invoice_items ii
                     JOIN invoices i ON i.organization_id = ii.organization_id AND i.id = ii.invoice_id
                     WHERE ii.organization_id = l.organization_id AND ii.load_id = l.id) fi ON true
  WHERE coalesce(fs.appointment_date, fi.issued_on) BETWEEN $ytdStart AND $today),
ytd AS (
  SELECT customer_id,
         count(*)::int AS loads_ytd,
         sum(revenue)::bigint AS revenue_ytd,
         (count(*) FILTER (WHERE status = 'delayed'
            OR arrived_at > ((last_on + coalesce(window_close, time '23:59')) AT TIME ZONE timezone)))::int AS late_ytd
  FROM ytd_load
  GROUP BY customer_id),
ar AS (               -- open invoices only (invoices_org_status_issued_idx)
  SELECT i.customer_id, sum(coalesce(t.total, 0) - coalesce(p.paid, 0))::bigint AS ar_balance
  FROM invoices i
  LEFT JOIN LATERAL (SELECT sum(ii.amount_cents) AS total FROM invoice_items ii
                     WHERE ii.organization_id = i.organization_id AND ii.invoice_id = i.id) t ON true
  LEFT JOIN LATERAL (SELECT sum(py.amount_cents) AS paid FROM payments py
                     WHERE py.organization_id = i.organization_id AND py.invoice_id = i.id) p ON true
  WHERE i.organization_id = $org AND i.status IN ('sent', 'overdue')
  GROUP BY i.customer_id)
SELECT c.id, c.name, c.standing, c.payment_terms,
       cc.id AS contact_id, cc.full_name AS contact_name, cc.email AS contact_email,
       coalesce(ytd.loads_ytd, 0) AS loads_ytd, coalesce(ytd.revenue_ytd, 0) AS revenue_ytd,
       coalesce(ytd.late_ytd, 0) AS late_ytd, coalesce(ar.ar_balance, 0) AS ar_balance
FROM customers c
LEFT JOIN customer_contacts cc ON cc.organization_id = c.organization_id AND cc.customer_id = c.id AND cc.is_primary
LEFT JOIN ytd ON ytd.customer_id = c.id
LEFT JOIN ar ON ar.customer_id = c.id
WHERE c.organization_id = $org
ORDER BY c.position, c.id;
```

`UNION` removes duplicate candidates. The candidate set is exact: a YTD load either has its first pickup (a stop) dated in YTD, or has no stops and its first invoice issued in YTD; the final `WHERE` applies the load-date rule itself. Indexes used: `customers_org_position_idx`, `customer_contacts_primary_uq`, `load_stops_org_date_idx`, `load_stops_load_sequence_uq`, `invoice_items_org_load_idx`, `invoice_items_invoice_position_uq`, `invoices_org_status_issued_idx`, `payments_org_invoice_idx`. `onTimePercent` and the summary are computed in memory from these rows; `bigint` sums are converted with `Number()`.

### 2.8 `GET /api/v1/customers/options` (select lists)

The New Load "Customer" and "Bill to" options and the default "Payment terms" (loads group, [loads.md §8.3.1](loads.md)). A select list needs no YTD, on-time or AR aggregate, so this endpoint reads only the `customers` table.

| | |
|---|---|
| Permission | `customers.view`. |
| Query | `customerOptionsQuerySchema` → `CustomerOptionsQuery`: `limit` (1–500, default 500), `offset`, `q` (over `name`, 04 §5 semantics, evaluated in SQL with an escaped `ILIKE`). |
| Response | `CustomerOptionsResponse` = `{ data: CustomerOption[], meta: PageMeta }`; `CustomerOption = { id, name, paymentTerms }`. |
| Order | `customers.position, customers.id` (as §2.2; Runtruck1's `CUSTOMERS` order). |
| Query plan | one statement: `SELECT id, name, payment_terms, count(*) OVER () FROM customers WHERE organization_id = $org [AND name ILIKE $q] ORDER BY position, id LIMIT $limit OFFSET $offset` (`customers_org_position_idx`). |
| Errors | 400 `VALIDATION_ERROR` (bad `limit`/`offset`/`q`) · 401 · 403 `FORBIDDEN` without `customers.view`. |
| Seed | Northgate Foods (net_30), Bayline Distribution (net_30), Cascade Building Supply (net_45), Harbor Point Retail (net_30), Sierra Ag Partners (net_60), Vantage Home Goods (net_30). |
| Tenancy | organization from the session; a Test Carrier Co member gets only Prairie Goods Co. |
| Route order | declared before any future `GET /customers/:id`. |

## 3. Web mapping

### 3.1 CRM (`/app/crm`)

`'use client'` page under the `/app` layout. Calls `GET /api/v1/customers?limit=500` once (no `q`) and filters the table locally with `matchesQuery(row, query)`. Markup and CSS are exactly core-pages §5.1.

**Label and tone maps** (web presentation):

| enum | value → label (tone) |
|---|---|
| `CustomerStanding` | `key_account` → "Key account" (blue) · `growing` → "Growing" (gray) · `at_risk` → "At risk" (amber) |
| `PaymentTerms` | `net_15` → "Net 15" · `net_30` → "Net 30" · `net_45` → "Net 45" · `net_60` → "Net 60" · `quick_pay` → "Quick pay" |

**KPIs** (label · value · note):

| label | value | note | seed (Runtruck1) |
|---|---|---|---|
| Accounts | `String(summary.accountCount)` | `` `${summary.keyAccountCount} key accounts` `` | 6 · "2 key accounts" (same) |
| Revenue YTD | `formatMoneyM1(summary.revenueYtdCents)` | `` `Top 3 accounts = ${summary.top3SharePercent}%` `` | "$0.1M" · "Top 3 accounts = 60%" ("$1.3M" · "= 73%") |
| On time | `` summary.onTimePercent === null ? '—' : `${summary.onTimePercent}%` `` | literal "Weighted by loads" | "97%" ("92%") |
| Open AR | `formatMoneyK1(summary.openArCents)` | `` `${summary.atRiskCount} account at risk` `` (no plural, as Runtruck1) | "$26.2K" · "1 account at risk" ("$91.9K") |

**Top-account cards** (`summary.topAccounts`, `div.ui-grid-3`, not filtered by search). Card view-model (`TopAccountVm`, Runtruck1 `TopAccount`):

| key | from `CustomerListItem` | seed (Northgate Foods) |
|---|---|---|
| `tier` | standing label | "Key account" |
| `name` | `name` | "Northgate Foods" |
| `contact` | `` primaryContact === null ? '—' : primaryContact.email ? `${fullName} · ${email}` : fullName `` | "Dana Ruiz · dana@northgate.com" |
| `loads` | `formatInt(loadsYtd)` | "5" (Runtruck1 "184") |
| `revenue` | `formatMoneyK(revenueYtdCents)` | "$11K" ("$412K") |
| `onTime` | `` onTimePercent === null ? '—' : `${onTimePercent}%` `` | "100%" ("96%") |

Seed cards: Northgate 5 / $11K / 100%, Bayline 5 / $15K / 100%, Sierra Ag 5 / $18K / 100% (Runtruck1 184/$412K/96%, 151/$338K/94%, 62/$154K/82%).

**All accounts** row view-model (`CustomerRowVm`, Runtruck1 `Customer`):

| key | from `CustomerListItem` | seed (Cascade Building Supply) |
|---|---|---|
| `name` | `name` | "Cascade Building Supply" |
| `contact` | `primaryContact?.fullName ?? '—'` | "Marta Lind" |
| `loads` | `formatInt(loadsYtd)` | "6" |
| `revenue` | `formatMoneyK(revenueYtdCents)` | "$17K" |
| `onTime` | `` onTimePercent === null ? '—' : `${onTimePercent}%` `` | "83%" |
| `terms` | terms label | "Net 45" |
| `ar` | `formatMoney(arBalanceCents)` | "$8,550" |
| `tier` | standing label (chip tone from `ref.tone`) | "Growing" |
| `ref` | `{ id, tone }` (an object, so never searched) | |

Rows: `vms.filter(r => matchesQuery(r, query))`; empty → `Nothing matches “{query}”.` (also with zero customers and an empty query, core-pages B2, D6). Rows are not clickable. "Filters" and "+ Add Customer" are inert.

### 3.2 New Load "Customer" / "Bill to" (loads group, [loads.md](loads.md))

`GET /customers/options?limit=500` (§2.8), query key `['customers', 'options']`, same order as the CRM. Options: value `id`, text `name`; the first options stay "Select a customer" / "Same as customer". Picking a customer sets the draft's terms to `paymentTerms` (label via the terms map), exactly as Runtruck1's `CUSTOMERS.find(...).terms`. Review "Customer" maps the chosen id back to its `name` ([loads.md §8.3.3](loads.md)).

## 4. Stub controls (not implemented, 01 §7)

"Filters" and "+ Add Customer" stay inert. When built: `POST /customers` (`customers.create`, Zod body with bounded name and contact, audit `CUSTOMER_CREATED`, event `CustomerCreated`), in one transaction.

## 5. Tests

- Integration: `GET /customers/options` returns the six options of §2.8 in order with no aggregate fields, 403 without `customers.view`, only Prairie Goods Co for Test Carrier Co; a load created with the largest total the schema accepts (2,147,483,647 cents, pickup earlier this year) leaves `GET /customers` answering 200 (no integer overflow, 03 §6.0.3); the six rows and the summary of §2.5–§2.6 in order; `topAccounts` = Northgate, Bayline, Sierra; `q=net 45` → Cascade only and the summary unchanged; `q=at risk` → Sierra; paging totals; 403 without `customers.view`; a "Test Carrier Co" member sees none of these customers and a summary of zeros (`onTimePercent` null); 400 on a bad `limit`.
- Unit (pure functions over rows): load date fallback to the first issued invoice; lateness at the window-close boundary in the stop's time zone; top-3 tie-break by position; `onTimePercent` null for zero loads.

## 6. Differences from Runtruck1 (D5)

| value | Runtruck1 | computed |
|---|---|---|
| Revenue YTD | $1.3M | $0.1M |
| Revenue YTD note | Top 3 accounts = 73% | Top 3 accounts = 60% |
| On time | 92% | 97% |
| Open AR | $91.9K | $26.2K |
| Loads YTD (Northgate, Bayline, Cascade, Harbor Point, Sierra, Vantage) | 184, 151, 77, 44, 62, 29 | 5, 5, 6, 3, 5, 5 |
| Revenue (same order) | $412K, $338K, $196K, $121K, $154K, $74K | $11K, $15K, $17K, $9K, $18K, $13K |
| On time (same order) | 96%, 94%, 91%, 89%, 82%, 93% | 100%, 100%, 83%, 100%, 100%, 100% |
| AR balance (same order) | $18,400, $12,900, $21,300, $6,100, $29,300, $3,850 | $1,980, $1,640, $8,550, $2,180, $7,980, $3,850 |
| Top-account cards (Northgate, Bayline, Sierra) | 184/$412K/96%, 151/$338K/94%, 62/$154K/82% | 5/$11K/100%, 5/$15K/100%, 5/$18K/100% |

"Accounts 6 · 2 key accounts", "1 account at risk", the terms, standings, contacts and the card selection equal Runtruck1's (03 §8).

These equalities hold for the **untouched seed**. The CRM figures are computed from loads (R2, D5), while Runtruck1's `CUSTOMERS` row values were constants: a load created with New Load (pickup on or before today) adds to its customer's Loads YTD, Revenue and On time, and to the Revenue YTD, top-3 share and On time KPIs. Runtruck1's CRM never changed after "+ New Load". Recorded in 01 §6; the New Load success handler invalidates `['customers']` ([loads.md §8.3.4](loads.md)).

## 7. Decisions made in this document

| # | Decision | Why |
|---|---|---|
| CU1 | `customers.view` alone covers the CRM aggregates, including AR balances computed from invoices; `billing.view` is not required. A Dispatcher (no `billing.view`) therefore sees AR balances on the CRM. | 07 §6.1 maps `GET /customers` to `customers.view` only; same pattern as the Dashboard's figures under `dashboard.view` (07 §7). Raised for review. |
| CU2 | Top-account cards: key accounts, then at-risk, by position, first 3; the "Top 3 accounts" share uses the three largest revenues. Both kept distinct as in Runtruck1. | Deterministic rule that reproduces `TOP_ACCOUNTS` (03 §6.5); core-pages B10 kept (D6). |
| CU3 | Empty cases: `onTimePercent` null → "—" (row, card and KPI); no primary contact → "—"; top-3 share 0 when there is no revenue. | Runtruck1 never shows them; "—" is the codebase's missing-value mark (03 §6.0.9). |
| CU4 | New Load reads `GET /customers/options` (id, name, terms) instead of `GET /customers`, so filling a dropdown computes no aggregates. | Architecture §37/§38: the CRM statement is the wrong cost for a select list. |
| CU5 | After New Load, the CRM row and KPIs of the load's customer reflect the new load (computed from records); Runtruck1 showed constants. | R2/D5; recorded in 01 §6. |
