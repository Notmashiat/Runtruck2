# Accounting area — port specification (Runtruck1 → Runtruck2)

Reference: `Runtruck1/app` (Vite + React 19 + react-router-dom v7, mock data only).
Target: `Runtruck2` (Next.js App Router web, NestJS `/api/v1`, PostgreSQL + Drizzle), governed by `docs/02-development-architecture.md` (cited below as "ARCH §n").

All paths below are relative to `Runtruck1/app/src/` unless stated otherwise. Every string in `code` or in quotes is exact, including Unicode punctuation:

| Glyph | Code point | Where it appears |
|---|---|---|
| `→` | U+2192 | route strings (`Fresno, CA → Reno, NV`) |
| `·` | U+00B7 | `Hold · fuel`, `Parts · T-118 turbo`, `$10,360 · auto-pay`, KPI notes, card title |
| `—` | U+2014 | empty values (`—`), `Modesto Yard — Lease` |
| `–` | U+2013 | AR labels `1–30 days`, `31–60 days` |
| `“` `”` | U+201C / U+201D | empty-state text `Nothing matches “…”.` |
| `-` | U+002D (hyphen-minus) | negative deductions `-$142` (NOT U+2212) |

"Today" in the prototype is the string `'Sep 3'` (`data/accounting.ts:5`), meaning 2026-09-03. **Note: 2026-09-03 is a Thursday, not a Wednesday** as the comments claim (see §9, B1).

---

## 1. Files covered

### 1.1 Primary (read in full)

| File | Lines | Role |
|---|---|---|
| `pages/app/accounting/UninvoicedTab.tsx` | 52 | `/app/accounting/uninvoiced` |
| `pages/app/accounting/InvoicedTab.tsx` | 46 | `/app/accounting/invoiced` |
| `pages/app/accounting/BatchesTab.tsx` | 54 | `/app/accounting/batches` |
| `pages/app/accounting/PastDueTab.tsx` | 57 | `/app/accounting/past-due` |
| `pages/app/accounting/PaidTab.tsx` | 64 | `/app/accounting/paid` |
| `pages/app/accounting/PayrollTab.tsx` | 66 | `/app/accounting/payroll` |
| `pages/app/accounting/BillsTab.tsx` | 53 | `/app/accounting/bills` |
| `data/accounting.ts` | 127 | `TODAY`, `daysBetween`, `ageDays`, `dollars`, `money`, `UNINVOICED`, `INVOICES_EXTRA`, `ALL_INVOICES`, `PAYMENTS`, `BATCHES`, `BILLS` |
| `data/mock.ts` (parts) | 332 | `Invoice`/`INVOICES` (242–260), `Settlement`/`SETTLEMENTS` (262–279), `SETTLE_TAG` (281–286), `SECTION_TABS.accounting` (297–305), `AR` (324–329), `CUSTOMERS` (218–225, only `.length` used), `NAV` (35) |

### 1.2 Supporting files the area depends on (read in full; owned by the shell spec, summarised here only as far as accounting needs them)

| File | Lines | What accounting uses |
|---|---|---|
| `App.tsx` | 81 | accounting routes 46–55, legacy redirects 75–77, catch-all 78 |
| `context/AppShellContext.tsx` | 51 | `query`, `setQuery`, `approved`, `approveAll` |
| `components/Header.tsx` | 87 | per-tab header buttons 39–45, search box, Filters button |
| `components/SectionTabs.tsx` | 29 | the 7-tab pill bar |
| `components/TabbedSection.tsx` | 13 | `<SectionTabs/>` + `<Outlet/>` |
| `components/AppLayout.tsx` | 20 | provider + shell; `<main className="ui-main">` |
| `components/Sidebar.tsx` | 55 | "Accounting" nav item, clears query |
| `components/Kpis.tsx` | 24 | KPI row |
| `components/Card.tsx` | 27 | card wrapper |
| `components/Tag.tsx` | 12 | status chip, tagClass → chip colour |
| `lib/search.ts` | 10 | `matchesQuery` |
| `styles/shell.css` | 332 | all `ui-*` classes used here |
| `styles/app.css` | 88 | global `.num` (overridden inside tables) |
| `styles/industry.css` | 285 | global body font/line-height, box-sizing |
| `main.tsx` | 19 | global CSS import order, `initTheme()` |
| `pages/app/DashboardPage.tsx` | 97 | consumes `UNINVOICED` (line 36) → cross-area dependency |
| `data/hr.ts` | 57 | pay bases mirror `SETTLEMENTS` (line 19 comment) |

---

## 2. Shell context for the area (routing, tab bar, header)

### 2.1 Routes (`App.tsx:46–55, 75–78`)

| URL | Renders |
|---|---|
| `/app/accounting` | index → `<Navigate to="uninvoiced" replace />` → `/app/accounting/uninvoiced` |
| `/app/accounting/uninvoiced` | `UninvoicedTab` |
| `/app/accounting/invoiced` | `InvoicedTab` |
| `/app/accounting/batches` | `BatchesTab` |
| `/app/accounting/past-due` | `PastDueTab` |
| `/app/accounting/paid` | `PaidTab` |
| `/app/accounting/payroll` | `PayrollTab` |
| `/app/accounting/bills` | `BillsTab` |
| `/app/invoices` (legacy) | `Navigate` replace → `/app/accounting/invoiced` |
| `/app/settlements` (legacy) | `Navigate` replace → `/app/accounting/payroll` |
| `/app/accounting/settlements` (legacy) | `Navigate` replace → `/app/accounting/payroll` |
| any other `/app/accounting/<x>` | falls to `path="*"` → `Navigate` replace → `/` (landing page) |

The legacy redirect routes sit OUTSIDE the `/app` layout route, so hitting one unmounts `AppLayout` (and its `AppShellProvider`) before the redirect lands: `query` resets to `''` and `approved` resets to `false`.

react-router matching is case-insensitive (`/app/Accounting/PAYROLL` works); `Header`, `SectionTabs`, `Sidebar` all lower-case `location.pathname` before reading segments.

### 2.2 Page skeleton (all 7 tabs)

```
<div class="ui-shell">
  <aside class="ui-sidebar">…"Accounting" item has class "ui-nav-item is-active"…</aside>
  <div class="ui-column">
    <header class="ui-topbar">…see 2.4…</header>
    <main class="ui-main">                      ← flex column, gap 20px, padding 20px 24px 32px, overflow-y auto
      <nav class="ui-tabs">…7 tab links…</nav>  ← from TabbedSection/SectionTabs
      <div class="ui-kpis">…4 KPI cards…</div>   ← tab component (Fragment child)
      <section class="ui-card ">…</section>      ← tab component (Fragment child)
    </main>
  </div>
</div>
```

`TabbedSection` and every tab return React Fragments, so `nav.ui-tabs`, `div.ui-kpis` and `section.ui-card` are **direct children of `main.ui-main`** and are spaced by its `gap: 20px`. Wrapping any of them in an extra element in the port breaks the spacing.

### 2.3 Tab bar (`SectionTabs.tsx`, data `mock.ts:297–305`)

```
<nav class="ui-tabs">
  <a href="/app/accounting/uninvoiced" class="ui-tab is-active" aria-current="page">Uninvoiced</a>
  <a href="/app/accounting/invoiced"   class="ui-tab">Invoiced</a>
  <a href="/app/accounting/batches"    class="ui-tab">Batches</a>
  <a href="/app/accounting/past-due"   class="ui-tab">Past Due</a>
  <a href="/app/accounting/paid"       class="ui-tab">Paid</a>
  <a href="/app/accounting/payroll"    class="ui-tab">Payroll</a>
  <a href="/app/accounting/bills"      class="ui-tab">Bills</a>
</nav>
```

- These are `NavLink`s. When active, react-router adds `aria-current="page"`. Because `className` is a function, NO default `active` class is added. Active is decided by case-insensitive prefix match on the pathname.
- `onClick={() => setQuery('')}`: clicking any tab, including the one already active, clears the search box.

### 2.4 Header on accounting routes (`Header.tsx`)

Key = `accounting/<segments[3]>` from the lower-cased path. Order inside `header.ui-topbar`: search input, spacer, `Filters`, then the action buttons.

```
<header class="ui-topbar">
  <input class="ui-search" value="{query}" placeholder="Search" aria-label="Search">
  <div style="flex: 1"></div>
  <button class="ui-btn" type="button">Filters</button>                       ← present on every accounting tab, no handler
  …action buttons…  each: <button class="ui-btn[ ui-btn-primary]" type="button">{label}</button>
</header>
```

| Tab | Buttons (in order). A primary button has `ui-btn ui-btn-primary`; a secondary one has `ui-btn` only | Behaviour |
|---|---|---|
| uninvoiced | **`Invoice 11 loads`** (primary). The label is `` `Invoice ${UNINVOICED.length} loads` `` | `navigate('/app/accounting/invoiced')`. It navigates only: no invoices are created and the search is NOT cleared |
| invoiced | `Export batch` (secondary), **`+ New Batch`** (primary) | `Export batch` does nothing. `+ New Batch` runs `navigate('/app/accounting/batches')` and does not clear the search |
| batches | **`+ New Batch`** (primary) | does nothing (stub) |
| past-due | **`Send reminders`** (primary) | does nothing (stub) |
| paid | `Export` (secondary) | does nothing (stub) |
| payroll | **`Run settlements`** (primary) | `approveAll()`, see §7 |
| bills | **`+ Add Bill`** (primary) | does nothing (stub) |

The search input is controlled. `onChange` runs `setQuery(e.target.value)` on every keystroke, with no debounce and no Enter handling. The raw value is stored untrimmed.

### 2.5 Shared rendering components

**Kpis** (`components/Kpis.tsx`): `items: {label, value, note?, onClick?}[]`. No accounting KPI has an `onClick`.
```
<div class="ui-kpis">
  <div class="ui-kpi">               ← key = label; would be "ui-kpi is-clickable" only when onClick is set
    <div>
      <div class="ui-kpi-label">{label}</div>
      <div class="ui-kpi-note">{note}</div>   ← only if note is truthy (every accounting note is)
    </div>
    <div class="ui-kpi-value">{value}</div>
  </div>
  …
</div>
```

**Card** (`components/Card.tsx`). Every accounting card uses `flush`, and none passes a `className` (which leaves a trailing space: `class="ui-card "`).
```
<section class="ui-card ">
  <div class="ui-card-head">
    <div class="ui-card-title">{title}</div>
    <div style="flex: 1"></div>
    {action}                          ← only Payroll passes one
  </div>
  <div class="ui-card-flush">{children}</div>
</section>
```

**Tag** (`components/Tag.tsx`): `<span class="ui-chip {CHIP[tagClass] ?? 'ui-chip-gray'}">{label}</span>`

| mock `tagClass` | chip class | light theme bg / fg | dark theme bg / fg |
|---|---|---|---|
| `tag-accent` | `ui-chip-blue` | `#dce6ff` / `#164bd6` | `#1f2f52` / `#7aa2ff` |
| `tag-neutral` | `ui-chip-gray` | `#eef0f4` / `#4b5563` | `#273142` / `#b8c0cc` |
| `tag-outline` | `ui-chip-amber` | `#fff1d6` / `#a05a00` | `#3a2b12` / `#f2b45c` |
| `tag-green` | `ui-chip-green` | `#dff5e6` / `#167a3b` | `#12301d` / `#5ccb86` |
| anything else or undefined | `ui-chip-gray` | | |

**Table conventions** (all tabs): `<table class="ui-table"><thead><tr><th>…</th></tr></thead><tbody>…</tbody></table>`. Cell classes:
- `td.strong`: font-weight 600, nowrap. Used for ids and names.
- `td.muted`: colour `--ui-muted`.
- `th.num` / `td.num`: right-aligned, tabular-nums, and `font-family: inherit`. This resets the global Barlow Condensed `.num` from app.css. `td.num` is nowrap.
- `td.num.strong` (Payroll "Net"): `.ui-table td.strong` is declared after `.ui-table td.num` with equal specificity (0,2,1), so the cell is **weight 600**. Keep the declaration order.
- Header text is written in Title/sentence case in the DOM. CSS uppercases it (`text-transform: uppercase`, 12px, 700, letter-spacing .04em).
- No row in any accounting table is clickable, hoverable, or expandable.

**Empty state** (all tabs): renders directly after `</table>`, inside `.ui-card-flush`, when the filtered row list is empty. The `<thead>` stays visible.
```
<div class="ui-empty">Nothing matches “{query}”.</div>
```
`{query}` is the raw, untrimmed search text. Nothing else in the prototype handles an empty dataset: with no search and no rows it would print `Nothing matches “”.`

**Search filter** (`lib/search.ts`): `q = query.trim().toLowerCase()`. An empty `q` matches every row. Otherwise a row matches when **any own property** other than `tagClass` whose value is a string or number satisfies `String(v).toLowerCase().includes(q)`. The match runs against the **pre-formatted display strings** (`'$2,450'`, `'41 d'`, `'Sep 2'`). The searched properties are listed per screen in §3. KPIs and footer totals always use the **unfiltered** data, so searching never changes them.

### 2.6 CSS used by the area (verbatim from `styles/shell.css`; tokens in shell.css 5–76)

```css
.ui-main { flex: 1; overflow-y: auto; padding: 20px 24px 32px; display: flex; flex-direction: column; gap: 20px; }
.ui-tabs { align-self: center; max-width: 100%; display: inline-flex; flex-wrap: wrap; justify-content: center; gap: 4px; padding: 6px; background: var(--ui-card); border-radius: 999px; }
.ui-tab { padding: 8px 18px; font-size: 14px; font-weight: 500; white-space: nowrap; color: var(--ui-primary); text-decoration: none; border-radius: 999px; }
.ui-tab:hover { background: var(--ui-tab-hover); color: var(--ui-primary); }
.ui-tab.is-active { background: var(--ui-primary-soft); color: var(--ui-primary-hover); font-weight: 600; }
.ui-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px; }
.ui-kpi { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 8px 12px; min-height: 96px; padding: 20px 24px; background: var(--ui-card); border-radius: 16px; }
.ui-kpi-label { font-size: 16px; font-weight: 600; }
.ui-kpi-note { margin-top: 4px; font-size: 12px; color: var(--ui-muted); }
.ui-kpi-value { margin-left: auto; font-size: clamp(30px, 3.2vw, 44px); font-weight: 700; line-height: 1; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
.ui-card { background: var(--ui-card); border-radius: 16px; overflow: hidden; }
.ui-card-head { display: flex; align-items: center; gap: 12px; padding: 14px 24px; border-bottom: 1px solid var(--ui-border); }
.ui-card-title { font-size: 15px; font-weight: 600; }
.ui-card-flush { overflow-x: auto; }
.ui-table { width: 100%; border-collapse: collapse; font-size: 14px; }
.ui-table th { padding: 12px 16px; text-align: left; white-space: nowrap; font-size: 12px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: var(--ui-text-2); background: var(--ui-thead); }
.ui-table td { padding: 13px 16px; border-bottom: 1px solid var(--ui-row); vertical-align: middle; }
.ui-table th:first-child, .ui-table td:first-child { padding-left: 24px; }
.ui-table th:last-child, .ui-table td:last-child { padding-right: 24px; }
.ui-table tbody tr:last-child td { border-bottom: 0; }
.ui-table th.num, .ui-table td.num { text-align: right; font-variant-numeric: tabular-nums; font-family: inherit; letter-spacing: inherit; }
.ui-table td.num { font-weight: inherit; white-space: nowrap; }
.ui-table td.strong { font-weight: 600; white-space: nowrap; }
.ui-table td.muted { color: var(--ui-muted); }
.ui-chip { display: inline-flex; align-items: center; padding: 3px 10px; font-size: 12px; font-weight: 600; border-radius: 999px; white-space: nowrap; }
.ui-link { padding: 0; font: inherit; font-size: 13px; font-weight: 600; color: var(--ui-primary); background: none; border: 0; cursor: pointer; text-decoration: none; }
.ui-link:hover { color: var(--ui-primary-hover); text-decoration: underline; }
.ui-empty { padding: 40px; text-align: center; font-size: 14px; color: var(--ui-muted); }
.ui-total { display: flex; justify-content: flex-end; align-items: baseline; gap: 12px; padding: 14px 24px; border-top: 1px solid var(--ui-border); font-size: 14px; color: var(--ui-muted); }
.ui-total strong { font-size: 20px; color: var(--ui-text); font-variant-numeric: tabular-nums; }
```
Inherited globals: `.ui-shell` sets `font-family: "Inter", system-ui, sans-serif; font-size: 14px`. `industry.css` sets `body { line-height: 1.55 }` and `*, *::before, *::after { box-sizing: border-box }`. The shell does not reset line-height, so every text line in these screens is 1.55. `app.css`'s global `.num { font-family: "Barlow Condensed"; font-weight: 600; … }` is overridden inside `.ui-table` only.

---

## 3. Screens

In every KPI table the **Class** column means:
- **AUTH**: an authoritative business or financial computation. It must be computed by the backend and returned in `meta.summary` (ARCH §2 Rule 2, §5 "Frontend must NOT be responsible for… Financial calculations").
- **PRES**: pure presentation (static text or formatting).

All values shown are the exact prototype output against the mock data.

### 3.1 Uninvoiced: `/app/accounting/uninvoiced` (`UninvoicedTab.tsx`)

Data: `UNINVOICED` (`accounting.ts:44–56`), 11 rows, rendered in array order (no sort).

**KPIs** (module-level, lines 8–18):

| # | label | value | note | formula | Class |
|---|---|---|---|---|---|
| 1 | `Loads` | `11` | `Delivered, not yet invoiced` | `UNINVOICED.length` | AUTH (count) |
| 2 | `Amount waiting` | `$34,900` | `Across 6 customers` | value `money(Σ dollars(amount))`; note `` `Across ${new Set(customer).size} customers` `` | AUTH (sum, distinct count) |
| 3 | `Missing POD` | `3` | `Cannot invoice until attached` | `count(pod === 'Missing')` (L-40207, L-40204, L-40200) | AUTH |
| 4 | `Oldest (days)` | `7` | `L-40199 · delivered Aug 27` | `oldest = reduce(max daysBetween(delivered, TODAY))`, strict `>` so the first maximum wins, seeded with `UNINVOICED[0]`; value `String(daysBetween(oldest.delivered,'Sep 3'))`; note `` `${oldest.id} · delivered ${oldest.delivered}` `` | AUTH (age uses the business "today") |

Crash hazard: with an empty dataset, `UNINVOICED[0]` is undefined and line 17 throws.

**Card**: title `Delivered, not yet invoiced`, no action.

**Columns**:

| # | `<th>` text | th class | cell | td class | field / format |
|---|---|---|---|---|---|
| 1 | `Load` | – | `{id}` | `strong` | load number `L-40209` |
| 2 | `Customer` | – | `{customer}` | – | customer name |
| 3 | `Route` | – | `{route}` | `muted` | `"{origin city}, {ST} → {dest city}, {ST}"` |
| 4 | `Delivered` | – | `{delivered}` | – | short date `MMM D` |
| 5 | `POD` | – | `<Tag label={pod} tagClass>` | – | `Attached` → green, `Missing` → amber (**left-aligned** chip) |
| 6 | `Amount` | `num` | `{amount}` | `num` | `$N,NNN` |

Row `key` = `id`.

**Rows (exact render order)**:

| Load | Customer | Route | Delivered | POD | Amount |
|---|---|---|---|---|---|
| L-40209 | Northgate Foods | Fresno, CA → Reno, NV | Sep 2 | Attached (green) | $2,450 |
| L-40208 | Bayline Distribution | Stockton, CA → Salt Lake City, UT | Sep 2 | Attached (green) | $3,180 |
| L-40207 | Cascade Building Supply | Sacramento, CA → Boise, ID | Sep 2 | Missing (amber) | $2,910 |
| L-40206 | Harbor Point Retail | Oakland, CA → Portland, OR | Sep 1 | Attached (green) | $3,540 |
| L-40204 | Vantage Home Goods | Stockton, CA → Las Vegas, NV | Aug 31 | Missing (amber) | $2,880 |
| L-40203 | Northgate Foods | Bakersfield, CA → Phoenix, AZ | Aug 31 | Attached (green) | $1,980 |
| L-40205 | Sierra Ag Partners | Modesto, CA → Denver, CO | Aug 30 | Attached (green) | $4,120 |
| L-40202 | Bayline Distribution | Fresno, CA → Portland, OR | Aug 30 | Attached (green) | $3,620 |
| L-40201 | Cascade Building Supply | Redding, CA → Seattle, WA | Aug 29 | Attached (green) | $2,760 |
| L-40200 | Sierra Ag Partners | Modesto, CA → Salt Lake City, UT | Aug 28 | Missing (amber) | $3,050 |
| L-40199 | Vantage Home Goods | Sacramento, CA → Denver, CO | Aug 27 | Attached (green) | $4,410 |

This order equals `ORDER BY delivered_date DESC, load_number DESC`.

**Searchable fields**: `id, customer, route, delivered, pod, amount`.

**Header**: `Filters`, then **`Invoice 11 loads`**. The `11` = uninvoiced count; the Header needs the same summary.

**Cross-area**: `DashboardPage.tsx:36` KPI `Unbilled loads` shows value `11` and note `$34,900 waiting` from the same data, and clicking it navigates here.

### 3.2 Invoiced: `/app/accounting/invoiced` (`InvoicedTab.tsx`)

Data: `OPEN = ALL_INVOICES.filter(status === 'Sent').sort((a,b) => ageDays(a.age) - ageDays(b.age))` (line 10), a stable ascending sort by age ("newest first").

**KPIs**: the hardcoded `AR` constant (`mock.ts:324–329`). Nothing is computed:

| label | value | note | Class |
|---|---|---|---|
| `Current` | `$96,400` | `32 invoices` | AUTH in the target (AR aging). Currently static fiction, see §9 B4 |
| `1–30 days` | `$41,200` | `14 invoices` | AUTH (same) |
| `31–60 days` | `$18,750` | `5 invoices` | AUTH (same) |
| `60+ days` | `$7,900` | `2 invoices · collections` | AUTH (same) |

**Card**: title `Open invoices`, no action.

**Columns**: `Invoice` (td `strong`, id) · `Customer` · `Load` (td `muted`) · `Issued` · `Amount` (th/td `num`) · `Age` (th/td `num`, `"{n} d"`) · `Status` (th/td `num`, right-aligned chip). Row key = `id`.

**Rows**:

| Invoice | Customer | Load | Issued | Amount | Age | Status |
|---|---|---|---|---|---|---|
| INV-8844 | Vantage Home Goods | L-40197 | Sep 2 | $2,260 | 1 d | Sent (blue) |
| INV-8841 | Northgate Foods | L-40214 | Sep 1 | $1,980 | 2 d | Sent (blue) |
| INV-8842 | Cascade Building Supply | L-40196 | Sep 1 | $2,760 | 2 d | Sent (blue) |
| INV-8840 | Bayline Distribution | L-40212 | Aug 31 | $1,640 | 3 d | Sent (blue) |
| INV-8829 | Cascade Building Supply | L-40198 | Aug 16 | $2,880 | 18 d | Sent (blue) |

The tie at 2 d keeps source order (8841 comes from `INVOICES`, 8842 from `INVOICES_EXTRA`). The equivalent SQL is `ORDER BY issued_date DESC, invoice_number ASC`. Open total (not displayed) = $11,520.

**Searchable fields**: `id, customer, load, issued, amount, age, status`.

**Header**: `Filters`, `Export batch` (no-op), **`+ New Batch`** (→ `/app/accounting/batches`).

### 3.3 Batches: `/app/accounting/batches` (`BatchesTab.tsx`)

Data: `BATCHES` (`accounting.ts:99–107`), 7 rows, array order. This is `created DESC` (and also `batch_number DESC`).

**KPIs** (lines 8–19):

| label | value | note | formula | Class |
|---|---|---|---|---|
| `Batches` | `7` | `22 invoices` | `BATCHES.length`; note `` `${Σ invoices} invoices` `` (2+3+2+4+3+5+3) | AUTH |
| `Ready to send` | `2` | `$12,550 to go out` | `count(status==='Ready')`; note `` `${money(Σ total of Ready)} to go out` `` (4,430 + 8,120) | AUTH |
| `Sent this week` | `2` | `Last 7 days` | `count(status==='Sent' && daysBetween(created, TODAY) < 7)`: B-2033 (2 d) ✓, B-2032 (5 d) ✓, B-2031 (8 d) ✗ | AUTH |
| `Total batched` | `$59,110` | `Ready, sent and settled` | `money(Σ total of all)` | AUTH |

**Card**: title `Invoice batches`, no action.

**Columns**: `Batch` (td `strong`) · `Created` · `Invoices` (th/td `num`, a plain integer) · `Sent to` (td `muted`) · `Total` (th/td `num`) · `Status` (th/td `num`, chip). Row key = `id`.

**Rows**:

| Batch | Created | Invoices | Sent to | Total | Status |
|---|---|---|---|---|---|
| B-2035 | Sep 3 | 2 | Northgate Foods | $4,430 | Ready (blue) |
| B-2034 | Sep 2 | 3 | Cascade Building Supply | $8,120 | Ready (blue) |
| B-2033 | Sep 1 | 2 | TriPoint Capital (factoring) | $4,940 | Sent (blue) |
| B-2032 | Aug 29 | 4 | Bayline Distribution | $11,310 | Sent (blue) |
| B-2031 | Aug 26 | 3 | Harbor Point Retail | $7,670 | Sent (blue) |
| B-2030 | Aug 22 | 5 | TriPoint Capital (factoring) | $14,230 | Settled (green) |
| B-2029 | Aug 19 | 3 | Northgate Foods | $8,410 | Settled (green) |

`Ready` and `Sent` both use `tag-accent` (blue), so they are visually identical.

**Searchable fields**: `id, created, invoices (number), total, sentTo, status`.

**Header**: `Filters`, **`+ New Batch`** (no-op).

### 3.4 Past Due: `/app/accounting/past-due` (`PastDueTab.tsx`)

Data: `OVERDUE = ALL_INVOICES.filter(status==='Overdue').sort((a,b) => ageDays(b.age) - ageDays(a.age))`, oldest first (line 10).

**KPIs** (lines 11–21):

| label | value | note | formula | Class |
|---|---|---|---|---|
| `Overdue invoices` | `5` | `Past terms` | `OVERDUE.length` | AUTH |
| `Amount overdue` | `$14,660` | `2 in collections (60+ days)` | `money(Σ amount)`; note `` `${count(ageDays(age) > 60)} in collections (60+ days)` ``: INV-8811 (67), INV-8815 (63) | AUTH. `> 60` vs the "60+" wording, see §9 |
| `Oldest` | `67 d` | `INV-8811 · Sierra Ag Partners` | `OVERDUE[0]`; value = its `age` string; note `` `${id} · ${customer}` `` | AUTH |
| `Accounts affected` | `4` | `of 6 accounts` | `new Set(customer).size` (Sierra Ag, Vantage, Cascade, Harbor Point); note `` `of ${CUSTOMERS.length} accounts` `` (the org's total customer count) | AUTH |

Crash hazard: with 0 overdue invoices, `OVERDUE[0]` is undefined and line 19 throws.

**Card**: title `Past due`, no action.

**Columns**: identical to Invoiced: `Invoice` (strong) · `Customer` · `Load` (muted) · `Issued` · `Amount` (num) · `Age` (num) · `Status` (num, chip).

**Rows**:

| Invoice | Customer | Load | Issued | Amount | Age | Status |
|---|---|---|---|---|---|---|
| INV-8811 | Sierra Ag Partners | L-40168 | Jun 28 | $3,860 | 67 d | Overdue (amber) |
| INV-8815 | Vantage Home Goods | L-40172 | Jul 2 | $1,590 | 63 d | Overdue (amber) |
| INV-8819 | Cascade Building Supply | L-40176 | Jul 15 | $2,910 | 50 d | Overdue (amber) |
| INV-8836 | Sierra Ag Partners | L-40210 | Jul 24 | $4,120 | 41 d | Overdue (amber) |
| INV-8821 | Harbor Point Retail | L-40178 | Jul 29 | $2,180 | 36 d | Overdue (amber) |

The equivalent SQL is `ORDER BY issued_date ASC`.

**Searchable fields**: `id, customer, load, issued, amount, age, status`.

**Header**: `Filters`, **`Send reminders`** (no-op).

### 3.5 Paid: `/app/accounting/paid` (`PaidTab.tsx`)

Data (lines 9–14): `ALL_INVOICES.filter(status==='Paid')`. Each row is joined with `PAYMENTS[id]`:
- `paid = p?.paid ?? '—'`
- `via = p?.via ?? '—'`
- `days = p ? daysBetween(issued, p.paid) : 0` (a number)

The result is sorted with `daysBetween(a.paid, TODAY) - daysBetween(b.paid, TODAY)`, ascending, stable, so the most recently paid come first.

**KPIs** (lines 16–27):

| label | value | note | formula | Class |
|---|---|---|---|---|
| `Paid this month` | `5` | `September` | `count(paid.startsWith('Sep'))`. The note is the hardcoded string `September` | AUTH (value); the note should be derived from the current month |
| `Amount` | `$13,980` | `Collected this month` | `money(Σ amount of this-month rows)` (3,180 + 3,410 + 1,890 + 3,050 + 2,450) | AUTH |
| `Avg days to pay` | `15` | `Issued to paid` | `Math.round(Σ days / max(PAID.length,1))` = round(77/5 = 15.4) | AUTH. Note: this averages ALL paid rows, not just this month's |
| `Paid via factoring` | `2` | `TriPoint Capital · $4,940` | `count(via==='Factoring')`; note `` `TriPoint Capital · ${money(Σ factored amount)}` `` (3,050 + 1,890). The factor's name is hardcoded | AUTH |

**Card**: title `Paid invoices`, no action.

**Columns**: `Invoice` (strong) · `Customer` · `Load` (muted) · `Issued` · `Paid` · `Via` (**left-aligned** chip: `Factoring` → `tag-accent` blue, anything else, including `ACH`, `Check`, `—` → `tag-neutral` gray) · `Amount` (th/td `num`) · `Days to pay` (th/td `num`, plain integer, no " d").

**Rows**:

| Invoice | Customer | Load | Issued | Paid | Via | Amount | Days to pay |
|---|---|---|---|---|---|---|---|
| INV-8823 | Bayline Distribution | L-40183 | Aug 5 | Sep 3 | Check (gray) | $3,180 | 29 |
| INV-8824 | Harbor Point Retail | L-40191 | Aug 7 | Sep 2 | ACH (gray) | $3,410 | 26 |
| INV-8838 | Vantage Home Goods | L-40189 | Aug 28 | Sep 2 | Factoring (blue) | $1,890 | 5 |
| INV-8839 | Sierra Ag Partners | L-40190 | Aug 29 | Sep 1 | Factoring (blue) | $3,050 | 3 |
| INV-8830 | Northgate Foods | L-40187 | Aug 18 | Sep 1 | ACH (gray) | $2,450 | 14 |

Ties are resolved by source order: 8824 before 8838 on Sep 2, and 8839 before 8830 on Sep 1. **No natural column ordering reproduces this.** Invoice number ASC fails on Sep 1, and issued date fails on one day or the other. Seed `payments.paid_at` as timestamps whose time of day gives this order: 8823 Sep 3; 8824 Sep 2 later than 8838 Sep 2; 8839 Sep 1 later than 8830 Sep 1. Then use `ORDER BY paid_at DESC`.

**Searchable fields** (the row object is `{...invoice, paid, via, days}`): `id, customer, load, issued, amount, age, status, paid, via, days`. **`age` (e.g. `29 d`) and `status` (`Paid`) are searchable but not displayed.** Searching `paid` therefore matches every row, and `29 d` matches INV-8823.

**Header**: `Filters`, `Export` (secondary, no-op).

### 3.6 Payroll: `/app/accounting/payroll` (`PayrollTab.tsx`)

Everything is computed on every render from `SETTLEMENTS` (`mock.ts:273–279`) and the context flag `approved`:

```ts
settlementRows = SETTLEMENTS.map(x => {
  const status = approved && x.status === 'Ready' ? 'Approved' : x.status;
  return { ...x, status, tagClass: SETTLE_TAG[status] };   // SETTLE_TAG: Ready/Approved→tag-accent, Paid→tag-green, 'Hold · fuel'→tag-outline
});
```

**KPIs** (lines 17–28, computed over all rows, unaffected by search):

| label | value | note (approved = false) | note (approved = true) | formula | Class |
|---|---|---|---|---|---|
| `Drivers` | `5` | `3 ready to approve` | `Approved for payment` | value `rows.length`; note `` approved ? 'Approved for payment' : `${count(status==='Ready')} ready to approve` `` | AUTH (count + approval state) |
| `Gross` | `$5,477` | `Week of Sep 1` | `Week of Sep 1` | `money(Σ dollars(gross))` = 1,326 + 1,188 + 1,455 + 824 + 684 | AUTH |
| `Deductions` | `$512` | `Fuel advances and escrow` | same | `money(Math.abs(Σ dollars(ded)))` = \|−142 − 96 − 210 − 64 + 0\|. `'—'` parses to 0 | AUTH |
| `Net payable` | `$4,965` | `Awaiting approval` | `Approved` | `money(Σ dollars(net))` = 1,184 + 1,092 + 1,245 + 760 + 684 | AUTH (includes Held and Paid rows, see §9) |

**Card**:
- title `Driver settlements · week of Sep 1` (lower-case "week")
- `action` = `<button type="button" class="ui-link">{approved ? 'Approved' : 'Approve all'}</button>`, `onClick={approveAll}`. The button stays enabled and clickable after approval, and clicking it again is a no-op because `setApproved(true)` is idempotent.

**Columns**: `Driver` (td `strong`) · `Pay basis` (td `muted`) · `Loads` (num) · `Miles` (num) · `Gross` (num) · `Deductions` (num) · `Net` (td `num strong`, weight 600) · `Status` (num, chip). Row key = `name`.

**Rows, before approval**:

| Driver | Pay basis | Loads | Miles | Gross | Deductions | Net | Status |
|---|---|---|---|---|---|---|---|
| Marcus Hale | $0.62 / mi | 4 | 2,140 | $1,326 | -$142 | $1,184 | Ready (blue) |
| Dara Whitfield | $0.60 / mi | 3 | 1,980 | $1,188 | -$96 | $1,092 | Ready (blue) |
| Ellis Nakamura | 25% of line haul | 3 | 1,760 | $1,455 | -$210 | $1,245 | Hold · fuel (amber) |
| Priya Raman | $0.58 / mi | 2 | 1,420 | $824 | -$64 | $760 | Ready (blue) |
| Ana Cortez | $0.58 / mi | 2 | 1,180 | $684 | — | $684 | Paid (green) |

**Rows, after approval**: identical except that the three `Ready` chips read `Approved`. They are still blue (`tag-accent`), so the colour does not change.

Row order equals `ORDER BY miles DESC` (2140 > 1980 > 1760 > 1420 > 1180) and also matches the `DRIVERS` order.

**Footer** (after the table and after any empty-state div, still inside `.ui-card-flush`):
```
<div class="ui-total">Net payable this week <strong>$4,965</strong></div>
```
The total is computed over all rows, not the filtered ones, and is always shown, even when the search empties the table.

Display formats:
- Deductions: negative → `-$N` (hyphen-minus); zero → `—`.
- Miles: thousands separator.
- Loads: plain integer.
- Pay basis: `$0.62 / mi` (per mile, 2 decimals) or `25% of line haul`.
- A held status shows as `Hold · {reason}`.

**Searchable fields**: `name, basis, loads, miles, gross, ded, net, status`. Status is the **post-approval** label, so after approval `approved` matches 3 rows.

**Header**: `Filters`, **`Run settlements`** (primary). It calls the same `approveAll()`; see §7.

### 3.7 Bills: `/app/accounting/bills` (`BillsTab.tsx`)

Data: `BILLS` (`accounting.ts:118–127`), 8 rows, array order. This equals `ORDER BY due_date ASC`.

`total(list) = money(Σ dollars(amount))` (line 8).

**KPIs** (lines 10–20):

| label | value | note | formula | Class |
|---|---|---|---|---|
| `Due this week` | `3` | `$15,000` | `status==='Due' && daysBetween(TODAY, due) <= 7` (no lower bound): Bridgestone +1, Pilot +2, Valley Diesel +5 → 2,380 + 8,640 + 3,980 | AUTH |
| `Overdue` | `1` | `$486` | `status==='Overdue'` (Verizon) | AUTH |
| `Scheduled` | `2` | `$10,360 · auto-pay` | `status==='Scheduled'` (6,210 + 4,150); note `` `${total} · auto-pay` `` | AUTH |
| `Paid this month` | `2` | `$4,115` | `status==='Paid' && due.startsWith('Sep')`. This uses the **due** date, not a paid date (3,900 + 215) | AUTH |

**Card**: title `Bills`, no action.

**Columns**: `Vendor` (td `strong`) · `Category` (td `muted`) · `Due` · `Amount` (num) · `Status` (num, chip). Row key = `vendor`.

**Rows**:

| Vendor | Category | Due | Amount | Status |
|---|---|---|---|---|
| Verizon Connect ELD | Telematics | Aug 28 | $486 | Overdue (amber) |
| Modesto Yard — Lease | Facilities | Sep 1 | $3,900 | Paid (green) |
| Comdata | Fuel card fees | Sep 2 | $215 | Paid (green) |
| Bridgestone Commercial | Tires | Sep 4 | $2,380 | Due (amber) |
| Pilot Flying J | Fuel | Sep 5 | $8,640 | Due (amber) |
| Valley Diesel & Turbo | Parts · T-118 turbo | Sep 8 | $3,980 | Due (amber) |
| Great West Casualty | Insurance | Sep 10 | $6,210 | Scheduled (blue) |
| Ryder Trailer Lease | Equipment lease | Sep 15 | $4,150 | Scheduled (blue) |

`Due` and `Overdue` share amber. `Valley Diesel & Turbo` contains a literal `&`, which React escapes.

**Searchable fields**: `vendor, category, due, amount, status`.

**Header**: `Filters`, **`+ Add Bill`** (no-op).

---

## 4. Data contract

### 4.1 Mock helpers → target equivalents

| Prototype (`data/accounting.ts`) | Behaviour | Target |
|---|---|---|
| `TODAY = 'Sep 3'` (5) | the business "today" | The backend `Clock` service returns "today" as a calendar date in the **organization's timezone**. For parity, dev/test/seed use a fixed date of `2026-09-03` (e.g. `APP_FIXED_TODAY`). Real today is 2026-09-29, and without pinning every age, "this week" and "this month" figure differs. |
| `daysBetween(from, to)` (10–16) | whole calendar days, year fixed to 2026, UTC | Backend date arithmetic on DATE values in the org timezone. |
| `ageDays('41 d')` (19–21) | `parseInt(age)` or 0 | Not needed: the backend returns an integer `ageDays`. |
| `dollars('$2,450')` (24–26) | strips `$` and `,`; `'—'` → 0; `'-$142'` → −142 | Not needed: the backend returns integer **cents** (bigint). |
| `money(n)` (28–30) | `` `$${n.toLocaleString('en-US')}` ``: no decimals for integers, `$` before any minus sign | Shared frontend formatter `formatMoney(cents)` returns `'$' + (cents/100).toLocaleString('en-US')`. Every mock value is whole dollars. Rows must use a separate `formatDeduction` (`-$142` / `—`). |

Date display format everywhere is `MMM D` in en-US: `Sep 3`, `Aug 28`, with no leading zero and no year. The frontend formats an ISO date or timestamp in the org timezone.

### 4.2 Entities and seed data the backend must serve

All entities are tenant-owned: `id uuid`, `organization_id uuid`, `created_at`/`updated_at timestamptz` (UTC). Human-facing numbers (`L-40209`, `INV-8845`, `B-2035`) are **separate unique-per-org text columns**, not primary keys (ARCH §8). React keys must use `id` (UUID), not `vendor` or `name`.

> ARCH §7 requires `docs/03-database.md` to be authoritative, and it does not exist yet in Runtruck2. Invoice batches, bills, vendors, factoring companies and pay periods are **not** in ARCH §7's core table list. They must be added to the database spec before they are implemented (ARCH §7 "must not invent", §49).

**(a) Customers** (owned by the CRM area; needed here). The 6 names, with payment terms needed for overdue/aging: Northgate Foods (Net 30), Bayline Distribution (Net 30), Cascade Building Supply (Net 45), Harbor Point Retail (Net 30), Sierra Ag Partners (Net 60), Vantage Home Goods (Net 30). The Past Due note `of 6 accounts` = the org's customer count.

**(b) Uninvoiced loads.** Derived from `loads` (delivered, no non-void invoice) plus `documents` (a POD exists). The 11 loads **do not exist in `LOADS`** (see §9 B2). They must be seeded as real delivered loads with an origin, a destination, a delivered timestamp, a rate, and POD docs for the 8 "Attached" ones:

| load_number | customer | origin → destination | delivered (local date) | POD | rate |
|---|---|---|---|---|---|
| L-40209 | Northgate Foods | Fresno, CA → Reno, NV | 2026-09-02 | yes | 2,450.00 |
| L-40208 | Bayline Distribution | Stockton, CA → Salt Lake City, UT | 2026-09-02 | yes | 3,180.00 |
| L-40207 | Cascade Building Supply | Sacramento, CA → Boise, ID | 2026-09-02 | **no** | 2,910.00 |
| L-40206 | Harbor Point Retail | Oakland, CA → Portland, OR | 2026-09-01 | yes | 3,540.00 |
| L-40204 | Vantage Home Goods | Stockton, CA → Las Vegas, NV | 2026-08-31 | **no** | 2,880.00 |
| L-40203 | Northgate Foods | Bakersfield, CA → Phoenix, AZ | 2026-08-31 | yes | 1,980.00 |
| L-40205 | Sierra Ag Partners | Modesto, CA → Denver, CO | 2026-08-30 | yes | 4,120.00 |
| L-40202 | Bayline Distribution | Fresno, CA → Portland, OR | 2026-08-30 | yes | 3,620.00 |
| L-40201 | Cascade Building Supply | Redding, CA → Seattle, WA | 2026-08-29 | yes | 2,760.00 |
| L-40200 | Sierra Ag Partners | Modesto, CA → Salt Lake City, UT | 2026-08-28 | **no** | 3,050.00 |
| L-40199 | Vantage Home Goods | Sacramento, CA → Denver, CO | 2026-08-27 | yes | 4,410.00 |

**(c) Invoices** (`ALL_INVOICES` = `INVOICES` (mock.ts:253–260) followed by `INVOICES_EXTRA` (accounting.ts:60–71)). Status enum `DRAFT | SENT | PAID | OVERDUE`. "Age" = today − issued date, in days.

| invoice_number | customer | load_number | issued | amount | status | age @ Sep 3 | shown on |
|---|---|---|---|---|---|---|---|
| INV-8845 | Northgate Foods | L-40218 | — (null) | 2,450 | DRAFT | — | nowhere |
| INV-8841 | Northgate Foods | L-40214 | 2026-09-01 | 1,980 | SENT | 2 | Invoiced |
| INV-8840 | Bayline Distribution | L-40212 | 2026-08-31 | 1,640 | SENT | 3 | Invoiced |
| INV-8829 | Cascade Building Supply | L-40198 | 2026-08-16 | 2,880 | SENT | 18 | Invoiced |
| INV-8824 | Harbor Point Retail | L-40191 | 2026-08-07 | 3,410 | PAID | 27 | Paid |
| INV-8836 | Sierra Ag Partners | L-40210 | 2026-07-24 | 4,120 | OVERDUE | 41 | Past Due |
| INV-8844 | Vantage Home Goods | L-40197 | 2026-09-02 | 2,260 | SENT | 1 | Invoiced |
| INV-8842 | Cascade Building Supply | L-40196 | 2026-09-01 | 2,760 | SENT | 2 | Invoiced |
| INV-8839 | Sierra Ag Partners | L-40190 | 2026-08-29 | 3,050 | PAID | 5 | Paid |
| INV-8838 | Vantage Home Goods | L-40189 | 2026-08-28 | 1,890 | PAID | 6 | Paid |
| INV-8830 | Northgate Foods | L-40187 | 2026-08-18 | 2,450 | PAID | 16 | Paid |
| INV-8823 | Bayline Distribution | L-40183 | 2026-08-05 | 3,180 | PAID | 29 | Paid |
| INV-8821 | Harbor Point Retail | L-40178 | 2026-07-29 | 2,180 | OVERDUE | 36 | Past Due |
| INV-8819 | Cascade Building Supply | L-40176 | 2026-07-15 | 2,910 | OVERDUE | 50 | Past Due |
| INV-8815 | Vantage Home Goods | L-40172 | 2026-07-02 | 1,590 | OVERDUE | 63 | Past Due |
| INV-8811 | Sierra Ag Partners | L-40168 | 2026-06-28 | 3,860 | OVERDUE | 67 | Past Due |

Every stored `age` string matches `daysBetween(issued, 'Sep 3')` (verified). Seeding requires loads L-40168 … L-40198 (historical, not in `LOADS`), or a nullable `load_id` with a stored load number. Decide this with the Loads area.

**(d) Payments** (`PAYMENTS`, accounting.ts:81–87). Method enum `ACH | CHECK | FACTORING`. Display labels: `ACH`, `Check`, `Factoring`.

| invoice | paid (local date) | method | suggested seed `paid_at` (UTC, gives the required order) |
|---|---|---|---|
| INV-8823 | 2026-09-03 | Check | 2026-09-03T18:00:00Z |
| INV-8824 | 2026-09-02 | ACH | 2026-09-02T20:00:00Z |
| INV-8838 | 2026-09-02 | Factoring (TriPoint Capital) | 2026-09-02T17:00:00Z |
| INV-8839 | 2026-09-01 | Factoring (TriPoint Capital) | 2026-09-01T20:00:00Z |
| INV-8830 | 2026-09-01 | ACH | 2026-09-01T17:00:00Z |

(The times assume an org timezone of America/Los_Angeles, so each stays on the same local date. Confirm the org timezone.)

**(e) Factoring company**: `TriPoint Capital`. Displayed as `TriPoint Capital (factoring)` in batch "Sent to", and as `TriPoint Capital · $4,940` in the Paid KPI.

**(f) Invoice batches** (BATCHES). Status enum `READY | SENT | SETTLED`. The recipient is a customer or a factoring company.

| batch_number | created | invoice_count | recipient | total | status |
|---|---|---|---|---|---|
| B-2035 | 2026-09-03 | 2 | Northgate Foods | 4,430 | READY |
| B-2034 | 2026-09-02 | 3 | Cascade Building Supply | 8,120 | READY |
| B-2033 | 2026-09-01 | 2 | TriPoint Capital (factoring) | 4,940 | SENT |
| B-2032 | 2026-08-29 | 4 | Bayline Distribution | 11,310 | SENT |
| B-2031 | 2026-08-26 | 3 | Harbor Point Retail | 7,670 | SENT |
| B-2030 | 2026-08-22 | 5 | TriPoint Capital (factoring) | 14,230 | SETTLED |
| B-2029 | 2026-08-19 | 3 | Northgate Foods | 8,410 | SETTLED |

Batches are **not linked to invoices** in the mock: the counts sum to 22, while only 16 invoices exist. Either store `invoice_count`/`total` denormalised for the seed, or seed `invoice_batch_items` and accept that the totals will be derived (§9 B8).

**(g) Bills (accounts payable)**. Vendor, category (free text), due date, amount, status enum `DUE | SCHEDULED | PAID | OVERDUE`. `SCHEDULED` means auto-pay. Seed the 8 rows from §3.7 with 2026 dates.

**(h) Driver settlements** (SETTLEMENTS). Belong to a pay period starting **2026-09-01** (a Tuesday; §9 B1). Status enum `READY | APPROVED | ON_HOLD | PAID`, plus `hold_reason` (`fuel`). Pay basis: `PER_MILE` with rate (0.62 / 0.60 / 0.58), or `PERCENT_LINE_HAUL` with pct (25). These should come from the driver's contract (HR `CONTRACTS` has the same bases).

| driver | basis | loads | miles | gross | deductions | net | status |
|---|---|---|---|---|---|---|---|
| Marcus Hale | PER_MILE 0.62 | 4 | 2140 | 1,326.00 | −142.00 | 1,184.00 | READY |
| Dara Whitfield | PER_MILE 0.60 | 3 | 1980 | 1,188.00 | −96.00 | 1,092.00 | READY |
| Ellis Nakamura | PERCENT_LINE_HAUL 25 | 3 | 1760 | 1,455.00 | −210.00 | 1,245.00 | ON_HOLD (fuel) |
| Priya Raman | PER_MILE 0.58 | 2 | 1420 | 824.00 | −64.00 | 760.00 | READY |
| Ana Cortez | PER_MILE 0.58 | 2 | 1180 | 684.00 | 0 (displayed `—`) | 684.00 | PAID |

Store `gross`, `deductions`, `net` as cents. Net = gross + deductions (deductions negative), which holds for every row. Seed the stored values as-is and do **not** recompute gross from miles × rate: Marcus would come out as $1,326.80 (§9 B10).

**(i) AR aging**. Currently hardcoded (`mock.ts:324–329`). There is no source data that produces it (§9 B4, §10 D1).

### 4.3 Proposed API (REST, `/api/v1`, `{data, meta}`, Zod-validated query params, org from session)

Each list endpoint returns every row the screen needs plus a `meta.summary` holding the authoritative KPI numbers. The frontend only formats.

| Screen | Endpoint | Permission | `data[]` fields | `meta.summary` (seed values) | Order |
|---|---|---|---|---|---|
| Uninvoiced + Header label + Dashboard KPI | `GET /api/v1/billing/uninvoiced-loads` | `billing.view` | `loadId, loadNumber, customer{id,name}, origin{city,state}, destination{city,state}, deliveredOn (YYYY-MM-DD, org tz), podStatus ('ATTACHED'\|'MISSING'), amountCents` | `loadCount 11, amountCents 3490000, customerCount 6, missingPodCount 3, oldest {loadNumber 'L-40199', deliveredOn '2026-08-27', ageDays 7} \| null` | deliveredOn DESC, loadNumber DESC |
| Invoiced | `GET /api/v1/invoices?status=SENT` | `billing.view` | `id, invoiceNumber, customer{id,name}, loadNumber, issuedOn, amountCents, ageDays, status` | (none for the table) | issuedOn DESC, invoiceNumber ASC |
| Invoiced KPIs | `GET /api/v1/billing/ar-aging` | `billing.view` | `buckets: [{key:'CURRENT'\|'D1_30'\|'D31_60'\|'D60_PLUS', amountCents, invoiceCount}]` | prototype shows 9,640,000/32 · 4,120,000/14 · 1,875,000/5 · 790,000/2 (**not derivable**, §10 D1) | fixed bucket order |
| Batches | `GET /api/v1/invoice-batches` | `billing.view` | `id, batchNumber, createdOn, invoiceCount, recipient{type:'CUSTOMER'\|'FACTOR', name}, totalCents, status` | `batchCount 7, invoiceCount 22, readyCount 2, readyTotalCents 1255000, sentLast7DaysCount 2, totalCents 5911000` | createdOn DESC, batchNumber DESC |
| Past Due | `GET /api/v1/invoices?status=OVERDUE` | `billing.view` | as for Invoiced | `count 5, amountCents 1466000, inCollectionsCount 2 (ageDays > 60), oldest {invoiceNumber 'INV-8811', customerName 'Sierra Ag Partners', ageDays 67} \| null, accountsAffected 4, totalAccounts 6` | issuedOn ASC |
| Paid | `GET /api/v1/invoices?status=PAID&include=payment` | `billing.view` | invoice fields + `payment{paidOn, method, factoringCompanyName?} \| null` + `daysToPay` | `paidThisMonthCount 5, collectedThisMonthCents 1398000, avgDaysToPay 15 (Math.round semantics over ALL paid), factoredCount 2, factoredCents 494000, factoringCompanyName 'TriPoint Capital', monthLabel 'September'` | paidAt DESC |
| Bills | `GET /api/v1/bills` | `bills.view` (new, §10 D6) | `id, vendorName, category, dueOn, amountCents, status` | `dueThisWeek {count 3, cents 1500000}, overdue {count 1, cents 48600}, scheduled {count 2, cents 1036000}, paidThisMonth {count 2, cents 411500}` | dueOn ASC |
| Payroll | `GET /api/v1/settlements?period=current` (or `?periodStart=2026-09-01`) | `settlements.view` | `id, driver{id,name}, payBasis{type, rate?, percent?}, loadCount, miles, grossCents, deductionsCents, netCents, status, holdReason?` | `period {start '2026-09-01'}, driverCount 5, readyCount 3, approvedCount 0, grossCents 547700, deductionsCents -51200, netCents 496500, allApproved false` | miles DESC (or an explicit sort key) |
| Payroll approve | `POST /api/v1/settlements/approve-all` body `{periodStart}` (Zod) | `settlements.approve` | returns the same payload as GET | after approval: `readyCount 0, approvedCount 3, allApproved true`; money unchanged | – |

Architecture scaling (ARCH §37) requires `?page`/`?limit` on every list. The prototype shows all rows, so the default limit must be at least the seed size, and pagination UI is out of scope for parity.

### 4.4 Display-format rules (frontend, presentation)

| Value | Format | Example |
|---|---|---|
| money (cents) | `'$' + (cents/100).toLocaleString('en-US')` | `$34,900` |
| deduction row | `< 0` → `'-$' + abs`; `0` → `'—'` | `-$142`, `—` |
| deductions KPI | `formatMoney(Math.abs(sum))` | `$512` |
| short date | `MMM D` in the org timezone | `Sep 3` |
| null date (draft) | `—` | |
| invoice age | `` `${ageDays} d` `` | `41 d` |
| Past Due "Oldest" value | `` `${ageDays} d` `` | `67 d` |
| Uninvoiced "Oldest (days)" value | `String(ageDays)` (no suffix) | `7` |
| days to pay | `String(n)` | `29` |
| miles | `toLocaleString('en-US')` | `2,140` |
| pay basis | PER_MILE → `` `$${rate.toFixed(2)} / mi` ``; PERCENT → `` `${pct}% of line haul` `` | `$0.62 / mi` |
| settlement status | READY `Ready`, APPROVED `Approved`, ON_HOLD `` `Hold · ${reason}` ``, PAID `Paid` | |
| route | `` `${o.city}, ${o.state} → ${d.city}, ${d.state}` `` | |
| batch recipient | customer name, or `` `${factor} (factoring)` `` | |
| pluralisation | **none**: always `customers`, `invoices`, `accounts` | `Across 1 customers` would be literal |

Status → chip colour (derive from the enum; do not store `tagClass`):

| Domain | blue | green | amber | gray |
|---|---|---|---|---|
| Invoice | SENT | PAID | DRAFT, OVERDUE | – |
| POD | – | ATTACHED | MISSING | – |
| Payment method | FACTORING | – | – | ACH, CHECK, none |
| Batch | READY, SENT | SETTLED | – | – |
| Bill | SCHEDULED | PAID | DUE, OVERDUE | – |
| Settlement | READY, APPROVED | PAID | ON_HOLD | unknown |

### 4.5 Every derived value, its formula, and where it must live

| Value | Formula (to be reproduced exactly) | Seed result | Lives in |
|---|---|---|---|
| Uninvoiced count | count of delivered, un-invoiced loads | 11 | backend |
| Amount waiting | Σ rate (**including** Missing-POD loads) | $34,900 | backend |
| Distinct customers (uninvoiced) | count distinct customer | 6 | backend |
| Missing POD | count without POD | 3 | backend |
| Oldest uninvoiced | max(today − delivered); ties → first in sort order | 7 d, L-40199, Aug 27 | backend |
| Batches count / invoices | count; Σ invoice_count | 7 / 22 | backend |
| Ready to send | count READY; Σ total | 2 / $12,550 | backend |
| Sent this week | status SENT and (today − **created**) < 7 | 2 | backend |
| Total batched | Σ total (all statuses) | $59,110 | backend |
| Overdue count / amount | count / Σ OVERDUE | 5 / $14,660 | backend |
| In collections | OVERDUE and ageDays **> 60** | 2 | backend |
| Oldest overdue | max ageDays | 67 d, INV-8811 | backend |
| Accounts affected / total accounts | distinct customers of OVERDUE / count of customers | 4 / 6 | backend |
| Paid this month | PAID with paid date in the current month (org tz) | 5 | backend |
| Collected this month | Σ amount of those | $13,980 | backend |
| Days to pay (row) | paid date − issued date | 29, 26, 5, 3, 14 | backend |
| Avg days to pay | round(Σ days / max(n,1)) over **all** PAID | 15 | backend |
| Factored count / total | method FACTORING | 2 / $4,940 | backend |
| Due this week (bills) | DUE and (due − today) ≤ 7 (no lower bound) | 3 / $15,000 | backend |
| Overdue bills | OVERDUE | 1 / $486 | backend |
| Scheduled bills | SCHEDULED | 2 / $10,360 | backend |
| Bills paid this month | PAID and **due** month = current month | 2 / $4,115 | backend |
| Payroll driver count / ready | count; count READY | 5 / 3 | backend |
| Gross / Deductions / Net | Σ over **all** settlements in the period (incl. ON_HOLD and PAID) | $5,477 / $512 (abs) / $4,965 | backend |
| "approved" UI flag | see §7.3 | false → true | backend-derived |
| AR aging buckets | undefined (hardcoded) | see §3.2 | backend (definition needed) |
| Header label count | = Uninvoiced count | `Invoice 11 loads` | backend summary, shared query |
| Row filtering by search | `matchesQuery` over the display strings | – | frontend (presentation) |
| Chip colour, formatting | tables above | – | frontend |

---

## 5. Interactions and state

| # | Trigger | Where | Effect in the prototype | State touched | Classification |
|---|---|---|---|---|---|
| I1 | Type in `input.ui-search` | Header | `setQuery(value)` on every keystroke; the current tab re-filters instantly; KPIs and the Payroll total are unaffected | `AppShellContext.query` | (b) client presentation state |
| I2 | Click a tab in `nav.ui-tabs` | SectionTabs | navigate to `/app/accounting/<key>`; `setQuery('')` (also on the already-active tab) | route, `query` | (b) |
| I3 | Click `Accounting` in the sidebar | Sidebar | navigate to `/app/accounting`, then redirect to `uninvoiced`; `setQuery('')` | route, `query` | (b) |
| I4 | `Invoice 11 loads` | Header (uninvoiced) | `navigate('/app/accounting/invoiced')` only. No invoice is created and the search is kept | route | (b). The label implies a business action; §10 D4 |
| I5 | `+ New Batch` | Header (invoiced) | `navigate('/app/accounting/batches')`; search kept | route | (b) |
| I6 | `Export batch`, `+ New Batch` (on batches), `Send reminders`, `Export`, `+ Add Bill`, `Filters` | Header | nothing (no `onClick`) | – | stubs; render them identically as inert buttons |
| I7 | `Approve all` / `Approved` link | Payroll card head | `approveAll()` → `setApproved(true)`. Idempotent; the link stays clickable | `AppShellContext.approved` | **(a) business data**. Must become a persisted state transition (§7) |
| I8 | `Run settlements` | Header (payroll) | `approveAll()`, same as I7 | same | **(a)** |
| I9 | Dashboard `Unbilled loads` / `Revenue this week` KPI | Dashboard | navigate to `/app/accounting/uninvoiced` / `/app/accounting/invoiced`; search NOT cleared | route | (b) |
| I10 | Legacy URL `/app/invoices`, `/app/settlements`, `/app/accounting/settlements` | App routes | redirect (replace); unmounts the shell, so `query` = '' and `approved` = false | route | (b) |

There are no keyboard shortcuts, form submissions, dialogs, row clicks, sorting UIs or pagination anywhere in the area. The tabs are `<a>` elements and the buttons are native `<button type="button">`.

Lifetime of the prototype state: `query` and `approved` live in `AppShellProvider`, which `AppLayout` mounts at `/app`. Both survive navigation anywhere under `/app`, and both reset on a full reload, on `Log out` (a `<Link to="/">`), and on the legacy redirects (I10).

---

## 6. Porting hazards (Next.js App Router)

| # | Prototype construct | Location | Hazard / required port |
|---|---|---|---|
| H1 | `<Route path="accounting" element={<TabbedSection/>}>` + `<Outlet/>` | App.tsx:46, TabbedSection.tsx | Use `app/app/accounting/layout.tsx` returning `<><SectionTabs/>{children}</>`. **No wrapper element** (§2.2 gap). |
| H2 | index `<Navigate to="uninvoiced" replace/>` | App.tsx:47 | `app/app/accounting/page.tsx` calls `redirect('/app/accounting/uninvoiced')`. The prototype redirects on the client; the port redirects on the server (307). The visible result is the same. |
| H3 | Legacy redirects outside the layout | App.tsx:75–77 | `next.config` `redirects()` (non-permanent) or route handlers. With Next, the shell may no longer reset `query` on these; that is acceptable, just be aware. |
| H4 | Catch-all `*` → `/` | App.tsx:78 | Unknown `/app/accounting/foo` must redirect to `/`, not render Next's 404. Use a catch-all `[...rest]/page.tsx` with `redirect('/')`, or middleware. |
| H5 | Case-insensitive routing; `pathname.toLowerCase()` | Header.tsx:24, SectionTabs.tsx:11, Sidebar.tsx:11 | Next routes are case-sensitive. To keep `/app/Accounting/Payroll` working, add middleware that redirects to the lower-cased path, and keep lower-casing in the active-tab logic. |
| H6 | `NavLink` with a `className` function + automatic `aria-current="page"` | SectionTabs.tsx:18–25 | Use a client component with `usePathname()` and `next/link`. Set `className` `ui-tab[ is-active]` AND `aria-current="page"` manually. Compare case-insensitively with prefix semantics (`pathname === to \|\| pathname.startsWith(to + '/')`). Do not add an `active` class. |
| H7 | `useNavigate()` | Header.tsx:19 | `useRouter().push()` (push, not replace, as in the prototype). |
| H8 | `useLocation()` | Header, SectionTabs, Sidebar | `usePathname()` (client components only). |
| H9 | React context `AppShellProvider` holding `query` and `approved` | AppShellContext.tsx | Provider must be a `'use client'` component in `app/app/layout.tsx`. Keep `query` there. **Remove `approved` from context**: it becomes server data (§7). Every tab that reads `query` needs a client component for its table. |
| H10 | Module-level constant KPI computation (computed once at import) | every tab | Replace with API data. No module state may hold per-request or per-tenant data (SSR leaks across tenants). |
| H11 | Instant render, no loading states | all tabs | The prototype has no loading UI, and a `loading.tsx` skeleton would look different. Prefer server-component fetching for the first paint (data in HTML) with the client table filtering the rows it receives, or a prefetched shared query cache. Error UI does not exist in the prototype and needs a design decision. |
| H12 | Header reads `UNINVOICED.length` synchronously | Header.tsx:39 | The Header (layout-level) now needs the uninvoiced count. Share the query key with the Uninvoiced tab and the Dashboard to avoid duplicate fetches. Until it loads, the label has no number; define a fallback (e.g. `Invoice loads`) or render the header after the data (§10 D5). |
| H13 | Header button mutates state rendered by the page (`Run settlements`) | Header.tsx:44 | The mutation must invalidate or refresh the payroll data rendered in the page (e.g. TanStack Query `invalidateQueries(['settlements', period])` or `router.refresh()` if the page is a server component). Header and page are in different segments. |
| H14 | Global CSS imported in `main.tsx` in the order industry → app → shell → calendar | main.tsx:4–7 | Import them in the same order in the root `app/layout.tsx`. Keep class names global: **do not convert to CSS Modules**, which would hash `ui-*` names. Order matters for `.num` and for `td.num` vs `td.strong`. |
| H15 | Google Fonts `<link>` (Inter 400/500/600/700; Barlow; Barlow Condensed) | index.html:8–10 | `shell.css` names the family `"Inter"` literally. `next/font/google` generates a different family name, so either keep a `<link>` in the root layout or use `next/font` with `variable` and change the CSS to `var(--font-inter)`. Metrics must match. |
| H16 | Theme pre-paint inline script reading `localStorage['runtruck-theme']` | index.html:7, lib/theme.ts | Chip and table colours depend on `html[data-theme]`. Put an inline `<script>` in the root layout `<head>` (before CSS paint) and add `suppressHydrationWarning` on `<html>`. Theme stays in localStorage (presentation; allowed). |
| H17 | `toLocaleString('en-US')` | accounting.ts:29 | Deterministic because the locale is explicit. Safe on the server and the client (Node ships full ICU). Always pass the locale explicitly. |
| H18 | `Date.UTC(2026, …)` year-less dates | accounting.ts:10–16 | Replace with real ISO dates from the API. Never compute "today" with `new Date()` during render (hydration mismatch, wrong timezone). "Today" comes from the server. |
| H19 | `key={b.vendor}`, `key={s.name}` | BillsTab.tsx:39, PayrollTab.tsx:48 | Use UUID `id`. |
| H20 | Empty-state curly quotes | all tabs | Keep the literal `“` `”` characters in the JSX source. |
| H21 | StrictMode | main.tsx:14 | No side effects in this area; nothing to port. |
| H22 | No `window`/`document`/`localStorage`/`<dialog>` use | accounting tabs | None in this area, apart from the shell theme (H16). |

---

## 7. Payroll approval flow (`approved` flag) in detail

### 7.1 Current behaviour

- `AppShellContext.tsx:28`: `const [approved, setApproved] = useState(false)`; `approveAll: () => setApproved(true)` (line 39). This is one boolean for the whole app and is not tied to a period or an organization.
- Two triggers: the Payroll card link (`PayrollTab.tsx:37`, `onClick={approveAll}`) and the Header button `Run settlements` (`Header.tsx:44`, `onClick: () => approveAll()`). The Header button only exists on `/app/accounting/payroll`.
- Effects when `approved === true`:
  1. Rows with source status `Ready` render as `Approved` (still blue). `Hold · fuel` and `Paid` rows are unchanged.
  2. KPI `Drivers` note changes from `3 ready to approve` to `Approved for payment`.
  3. KPI `Net payable` note changes from `Awaiting approval` to `Approved`.
  4. The card link text changes from `Approve all` to `Approved` and stays clickable.
  5. Nothing else changes: amounts, footer, and the `Run settlements` label all stay the same.
- No confirmation, no permission check, no audit, no persistence. It is lost on reload, and there is no un-approve.
- Search does not limit the scope: approval applies to every `Ready` row even when the table is filtered.

### 7.2 Target behaviour (ARCH §2, §12, §13, §18, §23, §26, §30)

- **Endpoint**: `POST /api/v1/settlements/approve-all`, body `{ periodStart: '2026-09-01' }`, validated with Zod. The organization comes from the session.
- **Authorization**: authenticated → org owns the period → `settlements.approve` → business rule (only `READY` settlements of that period in that org transition).
- **State machine**: `READY → APPROVED` is allowed. `ON_HOLD` and `PAID` are untouched. Record `approved_by`, `approved_at` (UTC).
- **Transaction**: a single DB transaction. Write one **audit log** row per settlement (`SETTLEMENT_APPROVED`, previous `READY`, new `APPROVED`) and emit one **`SettlementApproved`** domain event per settlement (idempotent, keyed by settlement id + status version).
- **Idempotency**: when nothing is `READY`, return 200 with the unchanged payload and write no audit rows or events. This matches the prototype, where clicking `Approved` again does nothing.
- **Response**: the same `{data, meta}` as `GET /settlements`, so the client can replace its cache without a second request.
- **Sensitive action**: ARCH §26 lists "Approve settlement" as a sensitive action (explicit human confirmation for AI). The prototype has no confirm dialog. Adding one changes the UX (§10 D3).
- **Frontend**: both triggers call one shared mutation hook. An optimistic update keeps the prototype's instant feel; roll back on error. On success, invalidate `['settlements', period]`.
- **Persistence consequence**: after one click the seeded demo stays approved permanently. Parity/E2E tests need a reseed or a test-only reset (§10 D2).

### 7.3 Deriving the UI flag

Replace the boolean with server state:

```
approved := meta.summary.allApproved
allApproved (server) := readyCount === 0 && approvedCount > 0
```

- Seed: `readyCount 3` → `false`. This gives `Approve all`, `3 ready to approve`, `Awaiting approval`.
- After POST: `readyCount 0, approvedCount 3` → `true`. This gives `Approved`, `Approved for payment`, `Approved`.
- A period with no settlements, or with only ON_HOLD/PAID ones, would show `Approve all` and `0 ready to approve`. The prototype never shows that state.

The alternative is a stored pay-period status (`OPEN`/`APPROVED`). Choose one in the settlement lifecycle doc (`docs/12-settlement-lifecycle.md`, not yet written).

---

## 8. Parity checklist (what a reviewer compares)

1. `/app/accounting` lands on `/app/accounting/uninvoiced` with `Uninvoiced` active (`aria-current="page"`).
2. For each tab, the header shows exactly the buttons in §2.4, in order, after `Filters`.
3. Each tab shows 4 KPIs with the exact label, value and note from §3, then one card with the exact title and columns.
4. Row data and order match the tables in §3 exactly, including chip colours and alignment. Chips are right-aligned in Status columns, and left-aligned for Uninvoiced POD and Paid Via.
5. Typing `zzz` shows the header row plus `Nothing matches “zzz”.`. KPIs are unchanged, and the Payroll footer still shows `$4,965`.
6. Typing `sierra` on Past Due leaves INV-8811 and INV-8836. Typing `paid` on Paid leaves all 5 rows (hidden field).
7. Clicking a tab clears the search. `Invoice 11 loads` and `+ New Batch` keep it.
8. Payroll: `Run settlements` or `Approve all` flips the 3 Ready chips to `Approved` (still blue), the link text to `Approved`, and the notes to `Approved for payment` / `Approved`. The state now survives reloads (intended change).
9. Dark theme: chip and table colours use the dark tokens (§2.5).

---

## 9. Bugs, inconsistencies and architecture conflicts

| # | Finding | Evidence |
|---|---|---|
| B1 | **Wrong weekday.** The comments say "today" is **Wednesday** Sep 3, 2026, but 2026-09-03 is a **Thursday** (2025-09-03 was the Wednesday). Planner data agrees with Thursday: Labor Day is Mon 2026-09-07, and the Onboarding week is Mon Aug 31 – Sun Sep 6. Payroll's "week of Sep 1" therefore starts on a **Tuesday**, so a backend deriving Monday-start weeks would label it "week of Aug 31". Dashboard `REVENUE_DAYS` ends on `Wed`. | accounting.ts:2, hr.ts:2, safety.ts:3, OnboardingTab.tsx:8, mock.ts:332, PayrollTab.tsx:25,35 |
| B2 | **Uninvoiced loads are not real loads.** L-40199…L-40209 are absent from `LOADS`. Several duplicate live loads' customer, route and amount while those loads are still active: L-40209≈L-40218 (In transit), L-40208≈L-40219 (At pickup), L-40207≈L-40220 (Delayed), L-40206≈L-40221 (Needs driver), L-40201≈L-40222 (Dispatched), L-40203≈L-40214, L-40205≈L-40210. The genuinely delivered or needs-POD loads (L-40212, L-40210, L-40214) are **not** listed as uninvoiced. Seeding them as real loads changes the Loads page counts (Delivered/All tabs). Coordinate with the Loads spec. | accounting.ts:42–56 vs mock.ts:94–119 |
| B3 | **Invoice dates contradict loads.** INV-8836 (L-40210) was issued Jul 24 for a load picked up Aug 29. INV-8841 (L-40214) was issued Sep 1, before its Sep 2 delivery, and the load is still `Needs POD`, although the Uninvoiced KPI says loads "Cannot invoice until attached". INV-8840 (L-40212) was issued Aug 31, before its Sep 1 delivery. INV-8845 is a Draft for in-transit L-40218 and no tab shows Draft invoices. Backend business rules (invoice only after POD, per ARCH §17 lifecycle) would reject these seeds. | mock.ts:254–259, 101–113 |
| B4 | **AR aging KPIs are hardcoded fiction.** They total $164,250 across 53 invoices, while the system holds 5 open Sent ($11,520) and 5 Overdue ($14,660). They also conflict with CRM `Open AR $91.9K` (Σ customer AR = $91,850) and with Past Due (`60+` = 2 invoices $5,450, versus AR's `$7,900`). A backend-computed aging **cannot** reproduce these values from the seed. Computed alternatives: (i) by age since issue: 0–30 = 5 / $11,520, 31–60 = 3 / $9,210, 60+ = 2 / $5,450; (ii) by days past terms: Current 6 / $15,640, 1–30 = 3 / $8,950, 31–60 = 1 / $1,590, 60+ = 0. | mock.ts:324–329; CustomersPage.tsx:12 |
| B5 | **INV-8836 is "Overdue" but within terms.** Sierra Ag is Net 60, so issued Jul 24 means due Sep 22, not yet due. The note says `Past terms`. If the backend derives overdue from due dates, Past Due shows 4 invoices / $10,540, still **2** in collections (INV-8811 67 d and INV-8815 63 d are both > 60 d since issue; it would be 0 if collections were measured in days past terms), and 4 accounts. (Corrected by the completeness critic: an earlier draft said "1 in collections".) | mock.ts:223, 259; PastDueTab.tsx:17 |
| B6 | Collections threshold is `> 60` while the text says `60+ days`. An invoice at exactly 60 days is excluded. | PastDueTab.tsx:12,18 |
| B7 | Crash on an empty dataset: `UNINVOICED[0]` and `OVERDUE[0]` are dereferenced unguarded. There is also no empty-data state (`Nothing matches “”.` would show). | UninvoicedTab.tsx:11,17; PastDueTab.tsx:14,19 |
| B8 | Batches are not linked to invoices: 22 batched invoices vs 16 in the system. B-2035 (READY, $4,430) equals INV-8845 (Draft) + INV-8841 (already Sent). B-2034 Cascade $8,120 does not equal any combination of Cascade invoices ($2,880 / $2,760 / $2,910). B-2033 correctly equals the factored INV-8838 + INV-8839 = $4,940. "Sent this week" is measured from the **created** date, not the sent date, and excludes batches sent this week and already settled. | accounting.ts:99–107; BatchesTab.tsx:9 |
| B9 | Paid tab: `PAYMENTS` is `Partial`. An invoice without a payment gets `paid '—'`, so `daysBetween('—', TODAY)` returns NaN inside the sort comparator, which gives an undefined order. "This month" is detected by `startsWith('Sep')` and the note `September` is hardcoded. `Avg days to pay` averages all paid invoices, not just this month's. `TriPoint Capital` is hardcoded. Hidden `age`/`status` fields are searchable. | PaidTab.tsx:12–26 |
| B10 | Payroll money: gross is inconsistent with the pay basis. Marcus 2,140 × $0.62 = $1,326.80, shown as `$1,326` (truncated). Priya 1,420 × $0.58 = $823.60, shown as `$824` (rounded). Ana 1,180 × $0.58 = $684.40, shown as `$684`. The seed must store the gross values, and the settlement calculation rules (rounding) must be defined in the settlement doc. | mock.ts:274–278 |
| B11 | Payroll KPIs `Gross`, `Deductions`, `Net payable` and the footer `Net payable this week` include the **ON_HOLD** (Ellis, $1,245) and the **already-PAID** (Ana, $684) settlements. After approval they read `Net payable … Approved` and `Approved for payment` although one settlement is on hold. Payable to approve is really $3,036 (1,184 + 1,092 + 760). This is kept for parity, but it is a financial-correctness issue to confirm. | PayrollTab.tsx:18–27,62 |
| B12 | The approval has no permission check, audit, event, persistence, confirmation or period scope. It is a global boolean. This conflicts with ARCH §2 Rule 1/2, §12, §13 (`settlements.approve`), §18, §23 (`SettlementApproved`), §26 (sensitive action) and §30. | AppShellContext.tsx:28,39 |
| B13 | Settlements cover 5 drivers, but the fleet has 6. Tobias Frey (Home time, 640 mi, owner-operator $1.18/mi in HR contracts) has no settlement row, so the `Drivers 5` KPI is the settlement count, not the driver count. | mock.ts:158–165 vs 273–279; hr.ts |
| B14 | `Invoice 11 loads` does not invoice anything; it only navigates. It also counts the 3 Missing-POD loads, which the KPI says cannot be invoiced. | Header.tsx:39; UninvoicedTab.tsx:16 |
| B15 | Bills `Paid this month` uses the **due** date (`due.startsWith('Sep')`) because no paid date exists. `Due this week` has no lower bound, so an overdue bill left in status `Due` would count as "this week". | BillsTab.tsx:10,13 |
| B16 | `SETTLE_TAG` is keyed by the display string `'Hold · fuel'`, which conflates status with hold reason. An unknown status falls back to gray. | mock.ts:281–286 |
| B17 | `money()` would print decimals for non-integers (`$1,326.8`) and `$-142` for negatives. It is only safe because every mock value is whole dollars and negatives go through `Math.abs`. | accounting.ts:28–30 |
| B18 | No pluralisation (`Across 1 customers`, `1 invoices`). | UninvoicedTab.tsx:15; BatchesTab.tsx:15 |
| B19 | React keys `vendor` / `name` are not guaranteed unique. | BillsTab.tsx:39; PayrollTab.tsx:48 |
| B20 | Stub buttons (`Filters`, `Export batch`, `+ New Batch` on Batches, `Send reminders`, `Export`, `+ Add Bill`) do nothing. ARCH §43 forbids marking incomplete work complete, so port them as visibly identical inert buttons and track them as not implemented. | Header.tsx:40–45,72–76 |
| B21 | Architecture docs gap: `docs/03-database.md`, `04-api.md`, `07-roles-permissions.md`, `11-billing-lifecycle.md` and `12-settlement-lifecycle.md` do not exist in Runtruck2. Batches, bills/vendors, factoring companies and pay periods are not in ARCH §7's table list, and there is no `bills.*` permission in ARCH §13. The phases put Billing at 12 and Settlements at 13, after Loads/Documents. | Runtruck2/docs |
| B22 | Business dates are year-less strings. The port needs full dates; decide between DATE columns and UTC timestamps plus the org timezone (ARCH §9). | all accounting data |

---

## 10. Open decisions (must be resolved before implementation, per ARCH §49)

- **D1 AR aging**: keep the prototype's exact figures (only possible as static or configured numbers, which violates backend-authoritative), seed extra historical invoices so the computed buckets equal them (the aging covers 53 open invoices against 10 in the seed, so dozens of extra SENT/OVERDUE rows would appear in the Invoiced and Past Due tables and change their KPIs, breaking table parity), or accept computed buckets (B4). Also define the aging basis: days since issue, or days past terms.
- **D2 Pinned clock and demo reset**: a pinned `today = 2026-09-03` for parity environments, and a way to reset seeded approval state for repeatable E2E.
- **D3 Confirm dialog** for settlement approval (ARCH §26 "sensitive") versus exact UX parity (no dialog).
- **D4 `Invoice 11 loads`**: stay navigation-only (parity) or become `POST /api/v1/invoices/bulk-from-loads` (ARCH §38: a large bulk operation should be a background job).
- **D5 Header label before data loads**: fallback text, or block render until the data is available.
- **D6 Permissions** for bills (AP): `bills.view` / `payables.view`? Invoices and batches use `billing.view`; payroll uses `settlements.view` / `settlements.approve`.
- **D7 Overdue**: a stored status or derived from `due_date < today`? The derived version changes Past Due to 4 rows (B5).
- **D8 Seed loads** for uninvoiced and historical invoices (B2, B3). This affects Loads and Dashboard counts. Coordinate with the Loads spec.
- **D9 Search**: parity requires client-side substring matching over formatted display strings, including hidden Paid fields. A server-side `q` must replicate that or be deferred (ARCH §37 at scale).
- **D10 Payroll totals**: include or exclude ON_HOLD and PAID rows (B11). Parity says include.
