# Port spec: core pages (Dashboard, Loads, Load detail, CRM, Facilities)

Reference: Runtruck1 prototype `app/` (Vite + React 19 + react-router-dom v7, mock data, "today" = 2026-09-03, which is a **Thursday**; the mock comments and `REVENUE_DAYS` wrongly assume Wednesday, see §2.3 C and gaps.md).
Target: Runtruck2 (pnpm + Turborepo; Next.js App Router `apps/web`; NestJS `apps/api` under `/api/v1`; PostgreSQL + Drizzle), governed by `docs/02-development-architecture.md`.

This spec is meant to be complete. You should be able to rebuild these five screens to match pixel for pixel and behaviour for behaviour without opening the prototype source. Paths are relative to `Runtruck1/app/`.
All strings are quoted exactly as they appear in the source. CSS `text-transform: uppercase` changes some of them on screen, and those cases are marked **(UPPERCASE on screen)**.

---

## 0. Files covered

| File | Lines | Role |
|---|---|---|
| `src/pages/app/DashboardPage.tsx` | 97 | `/app/dashboard` |
| `src/pages/app/LoadsPage.tsx` | 171 | `/app/loads` |
| `src/pages/app/LoadDetailPage.tsx` | 124 | `/app/loads/:id` |
| `src/pages/app/CustomersPage.tsx` | 68 | `/app/crm` |
| `src/pages/app/FacilitiesPage.tsx` | 17 | `/app/facilities` |
| `src/data/mock.ts` | 332 | LOADS, stopsOf, DRIVERS, CUSTOMERS, TOP_ACCOUNTS, ACTIVE_STATUSES, REVENUE_BARS/DAYS, USER (+ INVOICES, AR, COMPLIANCE: see §7.6) |
| `src/data/accounting.ts` | 127 | UNINVOICED, `dollars()`, `money()` (used by Dashboard) |
| Supporting, read in full: `src/components/Card.tsx` (27), `Kpis.tsx` (24), `Tag.tsx` (12), `ComingSoon.tsx` (28), `lib/search.ts` (10), `context/AppShellContext.tsx` (51), `components/Header.tsx` (87, per-page top bar), `components/AppLayout.tsx` (20), `App.tsx` (81), `main.tsx` (19), `index.html` (17), `styles/shell.css` (332), `styles/app.css` (88), `styles/industry.css` (285) | | |
| Partially read: `components/NewLoadDialog.tsx` (763). I read lines 1–289: the `Load` shape it creates (`toLoad`, `nextId`). Load detail and Loads render those created loads. | | |

---

## 1. Shared building blocks (the exact markup these pages depend on)

### 1.1 Page frame (AppLayout, not in this area but it affects spacing)
`div.ui-shell > aside.ui-sidebar + div.ui-column > header.ui-topbar + main.ui-main > {page}`.
`.ui-main { flex:1; overflow-y:auto; padding:20px 24px 32px; display:flex; flex-direction:column; gap:20px }`. Each top-level child a page renders (a React fragment's children) is therefore a flex item with 20px vertical gaps. `.ui-main` is the scroll container. The window does not scroll (`.ui-shell{height:100vh;overflow:hidden}`).
None of these five routes is in `SECTION_TABS`, so no pill tab bar is rendered.

### 1.2 `Card` (`components/Card.tsx`)
```
<section class="ui-card {className}" style={style}>        // className default '' → class="ui-card " (trailing space, harmless)
  [if title || action] <div class="ui-card-head">
       <div class="ui-card-title">{title}</div>
       <div style="flex:1"></div>
       {action}
     </div>
  <div class={flush ? 'ui-card-flush' : 'ui-card-body'}>{children}</div>
</section>
```
CSS: `.ui-card{background:var(--ui-card);border-radius:16px;overflow:hidden}` · `.ui-card-head{display:flex;align-items:center;gap:12px;padding:14px 24px;border-bottom:1px solid var(--ui-border)}` · `.ui-card-title{font-size:15px;font-weight:600}` · `.ui-card-body{padding:20px 24px}` · `.ui-card-flush{overflow-x:auto}`.

### 1.3 `Kpis` (`components/Kpis.tsx`)
```
<div class="ui-kpis">
  for k: <div key={k.label} class="ui-kpi[ is-clickable]" onClick={k.onClick}>
           <div><div class="ui-kpi-label">{label}</div>[note && <div class="ui-kpi-note">{note}</div>]</div>
           <div class="ui-kpi-value">{value}</div>
         </div>
```
CSS: `.ui-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px}`. `.ui-kpi{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:8px 12px;min-height:96px;padding:20px 24px;background:var(--ui-card);border-radius:16px}`. `.ui-kpi.is-clickable{cursor:pointer}` and `:hover{box-shadow:0 0 0 2px var(--ui-primary-soft)}`. `.ui-kpi-label{font-size:16px;font-weight:600}` (NOT uppercase). `.ui-kpi-note{margin-top:4px;font-size:12px;color:var(--ui-muted)}`. `.ui-kpi-value{margin-left:auto;font-size:clamp(30px,3.2vw,44px);font-weight:700;line-height:1;letter-spacing:-0.02em;font-variant-numeric:tabular-nums}`.
React key = label, so labels must be unique within a row.

### 1.4 `Tag` (status chip): `components/Tag.tsx`
`<span class="ui-chip {CHIP[tagClass] ?? 'ui-chip-gray'}">{label}</span>`, where:

| mock `tagClass` | chip class | light bg / fg | dark bg / fg |
|---|---|---|---|
| `tag-accent` | `ui-chip-blue` | `#dce6ff` / `#164bd6` | `#1f2f52` / `#7aa2ff` |
| `tag-neutral` | `ui-chip-gray` | `#eef0f4` / `#4b5563` | `#273142` / `#b8c0cc` |
| `tag-outline` | `ui-chip-amber` | `#fff1d6` / `#a05a00` | `#3a2b12` / `#f2b45c` |
| `tag-green` | `ui-chip-green` | `#dff5e6` / `#167a3b` | `#12301d` / `#5ccb86` |
| anything else | `ui-chip-gray` | | |

`.ui-chip{display:inline-flex;align-items:center;padding:3px 10px;font-size:12px;font-weight:600;border-radius:999px;white-space:nowrap}`.
**Port rule:** `tagClass` is presentation data stored in the mock records. The API must not return it. The frontend derives it from the status or standing enum using the maps in §9.2.

### 1.5 `ComingSoon`: see §6.

### 1.6 Search (`lib/search.ts`)
`matchesQuery(row, query)`: `q = query.trim().toLowerCase()`. An empty `q` matches everything. Otherwise the row matches when **any own property whose value is a `string` or `number`, other than the key `tagClass`**, contains `q` when lowercased (substring match). Arrays and objects are skipped, so `stops` and `documents` are never searched. The rule matches the **display strings** (for example `'$2,450'`, `'Sep 3'`, `'41,200 lb'`, `'MC 812044'`), including fields the row never shows (addresses, commodity, miles, margin…). §8.4 gives the server-side equivalent.

### 1.7 App-shell context (`context/AppShellContext.tsx`)
Provider mounted in `AppLayout`, so its state survives navigation inside `/app/*` and resets on a full reload.
- `query: string` (default `''`): the top-bar search text. **Client presentation state.**
- `loadTab: 'Active'|'Needs POD'|'Delivered'|'All'` (default `'Active'`): the Loads filter pill. **Client presentation state.** It persists across navigations within the session.
- `loads = [...created, ...LOADS]`: loads created with + New Load (newest first), followed by the 8 mock loads. `addLoad(l)` prepends. Memory only, lost on reload. **Business data**, which must move to PostgreSQL through `POST /api/v1/loads`.
- (Also `driverTab`, `approved`/`approveAll`, used by other areas.)

### 1.8 Top bar per page (`components/Header.tsx`; full spec belongs to the shell area)
The view key is `location.pathname.toLowerCase().split('/')[2] || 'dashboard'`. On load detail, `onLoadDetail = view==='loads' && !!segments[3]`.

| Route | Left | Filters button | Actions (right, in order) |
|---|---|---|---|
| `/app/dashboard` | `input.ui-search` placeholder `"Search"`, aria-label `"Search"` | **hidden** (NO_FILTERS) | `"+ New Load"` (primary) opens NewLoadDialog |
| `/app/loads` | search input | `"Filters"` (no-op) | `"+ New Load"` (primary) |
| `/app/loads/:id` | `button.ui-btn` `"← Loads"` → `navigate('/app/loads')` (query NOT cleared) | hidden | `"Message driver"` (no-op), `"Update status"` (primary, no-op) |
| `/app/crm` | search input | `"Filters"` (no-op) | `"+ Add Customer"` (primary, no-op) |
| `/app/facilities` | search input (typing has no visible effect) | hidden | none |

When NewLoadDialog creates a load it navigates to `/app/loads/{newId}`.

### 1.9 Global CSS facts that affect these pages (order: industry.css → app.css → shell.css → calendar.css)
- `*{box-sizing:border-box}`. `body{margin:0;font-size:15px;line-height:1.55;font-family:Barlow}`. `.ui-shell` overrides to `font-family:"Inter",system-ui,sans-serif;font-size:14px`, and **line-height 1.55 is inherited** (this matters for pixel parity).
- `h2` (industry): `font-family:Barlow Condensed; font-weight:600; font-size:32px; line-height:1.12; letter-spacing:-0.015em; margin:0 0 6.8px`. `.ui-shell h2{font-family:inherit;letter-spacing:-0.01em}`. `.ui-h2{margin:8px 0 0;font-size:22px;font-weight:700;line-height:1.2;letter-spacing:-0.01em}`.
- `.num` (app.css) sets Barlow Condensed, weight 600, and letter-spacing. Inside `.ui-table` shell.css resets it: `th.num, td.num {text-align:right; tabular-nums; font-family:inherit; letter-spacing:inherit}` and `td.num{font-weight:inherit;white-space:nowrap}`. Every `num` in these pages is inside `.ui-table`.
- `a{color:var(--color-accent);text-underline-offset:3px}`, overridden by `.ui-shell a{color:var(--ui-primary)}`. `.ui-link{padding:0;font:inherit;font-size:13px;font-weight:600;color:var(--ui-primary);background:none;border:0;cursor:pointer;text-decoration:none}` and `:hover{color:var(--ui-primary-hover);text-decoration:underline}`.
- `:focus{outline:none}` and `:focus-visible{outline:2px solid ...}`. `.ui-shell :focus-visible{outline-color:var(--ui-primary)}`.
- Fonts come from Google Fonts in `index.html`: `Barlow:wght@400;500;700`, `Barlow+Condensed:wght@400;600`, `Inter:wght@400;500;600;700`, `display=swap`.

### 1.10 Table CSS used by the Dashboard, Loads and CRM tables
`.ui-table{width:100%;border-collapse:collapse;font-size:14px}`. `th{padding:12px 16px;text-align:left;white-space:nowrap;font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--ui-text-2);background:var(--ui-thead)}` (**UPPERCASE on screen**). `td{padding:13px 16px;border-bottom:1px solid var(--ui-row);vertical-align:middle}`. The first cell gets `padding-left:24px` and the last cell `padding-right:24px`. The last row has no bottom border. `td.strong{font-weight:600;white-space:nowrap}`. `td.muted{color:var(--ui-muted)}`. `tr.is-clickable{cursor:pointer}` with `:hover td{background:var(--ui-row-hover)}`. `tr.is-open td{background:var(--ui-expand);border-bottom-color:transparent}`. `td.ui-expand-cell{padding:0}`.
`.ui-empty{padding:40px;text-align:center;font-size:14px;color:var(--ui-muted)}`.
`.ui-grid-2{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr));gap:20px;align-items:start}`. `.ui-grid-3{…minmax(min(100%,260px),1fr);gap:14px}` (no align-items, so cards stretch to equal height).

---

## 2. Dashboard: `/app/dashboard` (`DashboardPage.tsx`)

### 2.1 Layout
```
<Kpis items=[4 KPIs]/>                                   (§2.3 A)
<div class="ui-grid-2">
  <Card title="Active loads" flush action={<Link class="ui-link" to="/app/loads">View all</Link>}>
    <table class="ui-table">
      <thead><tr><th>Load</th><th>Customer</th><th>Route</th><th class="num">Rate</th><th class="num">Status</th></tr></thead>
      <tbody> rows: <tr class="is-clickable" onClick→/app/loads/{id}>
                     <td class="strong">{id}</td><td>{customer}</td><td class="muted">{route}</td>
                     <td class="num">{rate}</td><td class="num"><Tag label={status} tagClass/></td></tr>
      </tbody>
    </table>
    {rows.length===0 && <div class="ui-empty">Nothing matches “{query}”.</div>}
  </Card>
  <div style="display:flex;flex-direction:column;gap:20px;min-width:0">
    <Card title="Revenue, last 7 days"> bar chart (§2.1.1) </Card>
    <Card title="Drivers"> driver rows (§2.1.2) </Card>
  </div>
</div>
```
The empty message uses curly quotes U+201C/U+201D around the **raw, untrimmed** `query`, and ends with a period.

#### 2.1.1 Bar chart (inline styles, reproduce exactly)
```
<div style="display:grid;grid-template-columns:repeat(7, minmax(0, 1fr));gap:10px">   // 7 = number of bars
  for c: <div key={day} style="display:flex;flex-direction:column;align-items:center;gap:8px">
           <div style="display:flex;align-items:flex-end;width:100%;height:120px">
             <div style="width:100%;height:{h}%;background:{fill};border-radius:6px"/>
           </div>
           <div style="font-size:11px;font-weight:600;color:var(--ui-muted)">{day}</div>
         </div>
```
There are no axes, values, tooltips or units.

#### 2.1.2 Driver rows (inline styles)
```
for (d,i): <div key={name} onClick→/app/fleet/drivers
             style="display:flex;align-items:center;gap:12px;padding:10px 0;border-top:{i? '1px solid var(--ui-border)' : 0};cursor:pointer">
             <div style="width:8px;height:8px;border-radius:999px;background:{dot};flex:none"/>
             <div style="flex:1;font-weight:600">{name}</div>
             <div style="font-size:12px;color:var(--ui-muted)">{note}</div>
           </div>
```

### 2.2 Visible strings
KPI labels: `"Active loads"`, `"Revenue this week"`, `"Deadhead miles"`, `"Unbilled loads"`. Card titles: `"Active loads"`, `"Revenue, last 7 days"`, `"Drivers"`. Link: `"View all"`. Table headers: `Load`, `Customer`, `Route`, `Rate`, `Status` (UPPERCASE on screen). Empty state: `Nothing matches “{query}”.`

### 2.3 Data contract and derived values (against mock data)

**A. KPI row**

| Label | Value (formula → mock result) | Note (formula → mock) | onClick | Authoritative? |
|---|---|---|---|---|
| Active loads | `String(active.length)`, where `active = loads.filter(l => ACTIVE_STATUSES.includes(l.status))` → **`5`** (adds 1 per created load) | hardcoded `"+4 vs. last week"` | `navigate('/app/loads')` | **Backend** (count + week-over-week delta) |
| Revenue this week | hardcoded **`"$168K"`** | hardcoded `"+9.2%"` | `navigate('/app/accounting/invoiced')` | **Backend financial** (no source data; see §12) |
| Deadhead miles | hardcoded **`"7.8%"`** | hardcoded `"1.4 pts better"` | `navigate('/app/fleet/trucks')` | **Backend** (needs tracking data; none exists) |
| Unbilled loads | `String(UNINVOICED.length)` → **`11`** | `` `${money(Σ dollars(UNINVOICED[i].amount))} waiting` `` → **`"$34,900 waiting"`** | `navigate('/app/accounting/uninvoiced')` | **Backend financial** (sum of uninvoiced delivered loads) |

`dollars(s) = Number(s.replace(/[$,]/g,'')) || 0`. `money(n) = '$' + n.toLocaleString('en-US')`.
UNINVOICED amounts: 2450 + 3180 + 2910 + 3540 + 2880 + 1980 + 4120 + 3620 + 2760 + 3050 + 4410 = **34,900**.
All four KPIs are clickable (they get `is-clickable`). Navigating from a KPI does **not** clear `query`, and it does not change `loadTab`.

**B. Active loads table**
`searching = query.trim().length > 0`. `rows = (searching ? loads.filter(matchesQuery) : active).slice(0, 6)`.
- While searching, the table covers **all** loads, not only active ones, and the card title still reads "Active loads".
- The list keeps the order of `loads` (created loads first, newest first, then mock order).

Mock result with no search (5 rows):

| Load | Customer | Route | Rate | Status (chip) |
|---|---|---|---|---|
| L-40218 | Northgate Foods | Fresno, CA → Reno, NV | $2,450 | In transit (blue) |
| L-40219 | Bayline Distribution | Stockton, CA → Salt Lake City, UT | $3,180 | At pickup (gray) |
| L-40220 | Cascade Building Supply | Sacramento, CA → Boise, ID | $2,910 | Delayed (amber) |
| L-40221 | Harbor Point Retail | Oakland, CA → Portland, OR | $3,540 | Needs driver (amber) |
| L-40222 | Cascade Building Supply | Redding, CA → Seattle, WA | $2,760 | Dispatched (gray) |

Fields read per load: `id`, `customer`, `route`, `rate`, `status`, and `tagClass` (derived). Plus every string field for search.

**C. Revenue chart**: `REVENUE_BARS=[42,58,51,66,74,38,29]` and `REVENUE_DAYS=['Thu','Fri','Sat','Sun','Mon','Tue','Wed']` (meant as the 7 days ending on "today", but the labels are **off by one weekday**: 2026-09-03 is a Thursday, so the real weekdays of Aug 28 … Sep 3 are Fri … Thu. The labels are hard-coded strings; for parity the port must render exactly `Thu … Wed`, i.e. store/serve the labels literally and **not** derive them from the pinned date — deriving gives `Fri … Thu`. Corrected by the completeness critic.)
`MAX = max(bars) = 74`. `h = Math.round(v/MAX*100) + '%'`. `fill = v===MAX ? 'var(--ui-primary)' : 'var(--ui-primary-soft)'` (every bar equal to the max is highlighted).

| Day | Thu | Fri | Sat | Sun | Mon | Tue | Wed |
|---|---|---|---|---|---|---|---|
| value | 42 | 58 | 51 | 66 | 74 | 38 | 29 |
| height | 57% | 78% | 69% | 89% | 100% | 51% | 39% |
| fill | soft | soft | soft | soft | **primary** | soft | soft |

The units are undefined (probably $K). Daily revenue per day is a **backend financial** value. Bar height % and highlighting are **presentation**.

**D. Drivers card** (from `DRIVERS`, all 6, no search filtering). `note = status==='On duty' ? `On duty · ${hos} left` : status`. `dot = On duty → var(--ui-primary) · Available → var(--ui-green) · else var(--ui-muted)`.

| name | note | dot |
|---|---|---|
| Marcus Hale | On duty · 6h 20m left | primary |
| Dara Whitfield | On duty · 9h 05m left | primary |
| Ellis Nakamura | On duty · 1h 45m left | primary |
| Priya Raman | Available | green |
| Ana Cortez | Available | green |
| Tobias Frey | Home time | muted |

Fields: `name`, `status` (duty status), and `hos` (HOS remaining, formatted `{h}h {mm}m` with 2-digit minutes; `'—'` when none). HOS normally comes from an ELD, which means an integration (§25 of the architecture). Until one exists it has to be a stored field.

### 2.4 Interactions

| Trigger | Effect | State touched |
|---|---|---|
| Click KPI | navigate (targets above) | none (query kept) |
| Click "View all" | `<Link to="/app/loads">` | none (query kept) |
| Click table row | `navigate('/app/loads/{id}')` | none (query kept) |
| Click driver row | `navigate('/app/fleet/drivers')` | none |
| Type in top-bar search | filters the table live, on every keystroke | `query` (client) |
| "+ New Load" (top bar) | opens NewLoadDialog; on create, the load is prepended and the app navigates to its detail page | **business data** |

---

## 3. Loads: `/app/loads` (`LoadsPage.tsx`)

### 3.1 Layout
```
<Kpis items=[Undispatched, In transit, Delivered, Needs POD]/>      // no notes, not clickable
<Card flush title={countText} action={filter}>
  <table class="ui-table">
    <thead><tr><th>Load #</th><th>Tender #</th><th>Truck</th><th>Route</th><th>Pickup</th><th>Driver</th>
               <th class="num">Rate</th><th class="num">Status</th></tr></thead>
    <tbody> per load (Fragment key=id):
      <tr class="is-clickable[ is-open]" onClick={toggle}>
        <td class="strong">{id}</td>
        <td class="strong">{ref}</td>
        <td class={unassigned ? 'muted' : ''}>{unassigned ? 'Unassigned' : unit}</td>   // unassigned = unit === '—'
        <td>{route}</td><td>{pickup}</td><td>{driver}</td>
        <td class="num">{rate}</td><td class="num"><Tag label={status}/></td>
      </tr>
      [open] <tr><td colSpan=8 class="ui-expand-cell"><div class="ui-expand"> 4 columns (§3.1.1) </div></td></tr>
    </tbody>
  </table>
  {rows.length===0 && <div class="ui-empty">{searching ? `Nothing matches “${query}”.` : 'No loads in this view.'}</div>}
</Card>
```
`countText = searching ? `${rows.length} matching “${query}”` : `${rows.length} loads``. There is no singular form ("1 loads"). The query is shown raw and untrimmed.
Filter (the card's `action`):
```
<div class="ui-filter">
  for o in ['Active','Needs POD','Delivered','All']:
    <button type="button" class="ui-filter-opt[ is-active]">{o}</button>   // is-active iff !searching && loadTab===o
</div>
```
`.ui-filter{display:inline-flex;gap:2px;padding:3px;background:var(--ui-filter-bg);border-radius:999px}`. `.ui-filter-opt{padding:5px 12px;font:inherit;font-size:13px;font-weight:600;color:var(--ui-muted);background:transparent;border:0;border-radius:999px;cursor:pointer}`. `.is-active{color:var(--ui-text);background:var(--ui-card);box-shadow:0 1px 2px var(--ui-shadow)}`.

#### 3.1.1 Expanded row (`.ui-expand{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:24px 32px;padding:16px 24px 28px;background:var(--ui-expand)}`, 2 columns at `max-width:1100px`)
The expanded `<tr>` has no onClick, so clicks inside it do not toggle the row.
1. **Stops column**
   `<div class="ui-label">Stops ({stops.length})</div>` (UPPERCASE), then for each stop `i`:
   `<div class="ui-stop"><div class="ui-stop-kind {pickup|delivery}">{kind} · Stop {i+1}</div><div class="ui-stop-name">{name}</div><div class="ui-stop-meta">{address}</div><div class="ui-stop-meta">{when}</div></div>`.
   Stops come from `stopsOf(l)`: `l.stops` if present, otherwise `[{Pickup, from, fromAddr, `${pickup} · 08:00–14:00`}, {Delivery, to, toAddr, `${delivery} · 06:00–12:00`}]` (en dash U+2013). The class is `'pickup'` when kind is `'Pickup'`, else `'delivery'`.
2. **Load details column**
   `<div class="ui-label">Load details</div><div class="ui-kv">` with the pairs `System load #`→id, `Tender #`→ref, `Commodity`→commodity, `Weight`→weight, `Equipment`→equip, `Rate`→rate. Each pair renders as `<div><div class="ui-label">{k}</div><div class="ui-kv-value">{v}</div></div>`.
3. **Customer column**
   `<div class="ui-label">Customer</div><div class="ui-kv">` containing:
   - `<div><div class="ui-kv-value">{customer}</div><div class="ui-stop-meta">{temp} · {equip}</div></div>`
   - `<div><Link class="ui-link" to="/app/loads/{id}">Open load →</Link></div>`
4. **Truck & driver column**
   - `<div class="ui-label">Truck &amp; driver</div><div class="ui-kv">` with (`Truck` → `unassigned ? 'Unassigned' : unit`) and (`Driver` → driver).
   - Then `<div class="ui-label" style="margin-top:22px">Carrier</div><div class="ui-kv">` with (`Name` → carrier) and (`MC · DOT` → `${carrierMc} · ${carrierDot}`).

Stop and kv CSS:
- `.ui-label{font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--ui-muted)}`
- `.ui-kv{display:flex;flex-direction:column;gap:10px;margin-top:10px}`
- `.ui-kv-value{margin-top:2px;font-size:13px;font-weight:600}`
- `.ui-stop{margin-top:10px;padding-left:10px;border-left:3px solid var(--ui-primary)}`. `.ui-stop:has(> .pickup){border-left-color:var(--ui-amber)}`. `.ui-stop:has(> .delivery){border-left-color:var(--ui-green)}`.
- `.ui-stop-kind{font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase}`. `.pickup{color:var(--ui-amber)}`. `.delivery{color:var(--ui-green)}`.
- `.ui-stop-name{margin-top:2px;font-size:13px;font-weight:700}`. `.ui-stop-meta{margin-top:2px;font-size:12px;color:var(--ui-muted)}`.

### 3.2 Data and derived values
- `rows = searching ? loads.filter(matchesQuery) : listFor(loads, loadTab)`, where `listFor`:
  - `All` → all
  - `Active` → status ∈ ACTIVE_STATUSES (`['In transit','At pickup','Dispatched','Delayed','Needs driver']`)
  - otherwise → `status === tab` (`'Needs POD'`, `'Delivered'`)
- The KPIs count **all loads, whatever the tab or search**: `countOf(s) = loads.filter(l=>l.status===s).length`.

| KPI label | status counted | mock value |
|---|---|---|
| Undispatched | `Needs driver` | **1** |
| In transit | `In transit` | **1** |
| Delivered | `Delivered` | **2** |
| Needs POD | `Needs POD` | **1** |

(Each created load adds to Undispatched when it has no driver and is not brokered. Otherwise it gets status `Dispatched`, which none of these KPIs counts.)

Tab contents (mock order) and titles:

| Tab | rows | title |
|---|---|---|
| Active (default) | L-40218, L-40219, L-40220, L-40221, L-40222 | `5 loads` |
| Needs POD | L-40214 | `1 loads` |
| Delivered | L-40212, L-40210 | `2 loads` |
| All | L-40218, L-40219, L-40220, L-40221, L-40214, L-40212, L-40210, L-40222 | `8 loads` |

The full row values for all 8 loads are in §7.1. Two worked examples:
- L-40218: `L-40218 | PO 88-41207 | T-114 / RF-88 | Fresno, CA → Reno, NV | Sep 3 | Marcus Hale | $2,450 | In transit(blue)`.
- L-40221: the Truck cell is muted `Unassigned`, and the Driver cell reads `Unassigned` (not muted).

Expanded L-40218:
- Stops (2):
  - `Pickup · Stop 1` / Northgate Cold Storage / 4120 S Golden State Blvd, Fresno, CA / `Sep 3 · 08:00–14:00`
  - `Delivery · Stop 2` / Reno Grocers DC / 1855 E Greg St, Sparks, NV / `Sep 4 · 06:00–12:00`
- Load details: L-40218, PO 88-41207, Frozen produce, 41,200 lb, Reefer, 53 ft, $2,450.
- Customer: Northgate Foods / `-10 °F · Reefer, 53 ft` / Open load →.
- Truck `T-114 / RF-88`, Driver `Marcus Hale`, Carrier `Sunridge Freight (own fleet)`, MC · DOT `MC 812044 · DOT 2291176`. For L-40221 this is `Not yet covered` and `— · —`.

All values here are straight field reads. The KPI counts and tab lists should be served by the backend (§8).

### 3.3 Interactions / state

| Trigger | Effect | State |
|---|---|---|
| Mount | `openId = firstId(rows)`, so the **first row is expanded on arrival** (L-40218 by default). This comes from a `useState` initializer and runs once per mount. | `openId` local (client) |
| Click data row | `setOpenId(open ? null : l.id)`: accordion, at most one row open, and clicking the open row closes it | `openId` |
| Click filter pill `o` (the active one too) | `setLoadTab(o); setQuery(''); setOpenId(firstId(listFor(loads,o)))`. This clears the top-bar search and expands the first row of the new tab. | `loadTab` (context), `query`, `openId` |
| Type in search | Rows = all loads matching the query, ignoring the tab. No pill is active. The title becomes `N matching “q”`. **openId is NOT recomputed**: if the open row is still in the results it stays open, otherwise nothing is open. | `query` |
| Click "Open load →" | navigate to `/app/loads/{id}` (query kept) | none |
| Leave and come back | LoadsPage remounts, so openId resets to the first row. `loadTab` and `query` persist, because they live in the context. | |
| Sidebar "Loads" click | clears the query | `query` |

All of this is **client presentation state**. The only business mutation reachable from this page is + New Load in the top bar.

---

## 4. Load detail: `/app/loads/:id` (`LoadDetailPage.tsx`)

### 4.1 Selection
`const { id } = useParams(); sel = loads.find(l => l.id === id) ?? loads[0]`. An unknown id **silently shows the first load** (see §12). `delivered = sel.status === 'Delivered'`.

### 4.2 Layout
```
<Card>                                               // no title → no head
  <h2 class="ui-h2" style="margin:0">{route}</h2>
  <div style="margin-top:6px;font-size:14px;color:var(--ui-muted)">Load {id} · {customer} · {status}</div>
</Card>
<Kpis items=facts/>                                  // 4 KPIs, not clickable
<div class="ui-grid-2">
  <Card title="Stops">
    <div style="display:flex;flex-direction:column;gap:8px">
      for s: <div class="ui-stop"><div class="ui-stop-kind[ {kindClass}]">{kind}</div>
               <div class="ui-stop-name">{name}</div><div class="ui-stop-meta">{address}</div><div class="ui-stop-meta">{window}</div></div>
    </div>
    <div class="ui-placeholder" style="margin-top:20px">Live map / ELD trace</div>
  </Card>
  <div style="display:flex;flex-direction:column;gap:20px;min-width:0">
    <Card title="Freight & pay">{kv(freight)}</Card>
    <Card title="Carrier">{kv(carrier)}</Card>
    <Card title="Documents"> rows: <div style=rowStyle(i)><div style="flex:1">{name}</div><Tag label={state} tagClass={state==='Attached'?'tag-green':'tag-outline'}/></div></Card>
    <Card title="Activity"> rows: <div style=rowStyle(i)>
         <div style="width:96px;flex:none;font-size:13px;color:var(--ui-muted);font-variant-numeric:tabular-nums">{when}</div>
         <div style="flex:1">{what}</div></div></Card>
  </div>
</div>
```
- `kv(rows)` = `<div class="ui-kv" style="margin-top:0">` + for each: `<div key={k}><div class="ui-label">{k}</div><div class="ui-kv-value">{v}</div></div>`.
- `rowStyle(i) = {display:flex; align-items:center; gap:14px; padding:10px 0; border-top: i ? '1px solid var(--ui-border)' : 0}`.
- `.ui-placeholder{display:flex;align-items:center;justify-content:center;min-height:220px;font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--ui-muted);background:var(--ui-expand);border:2px dashed var(--ui-dash);border-radius:16px}`.
- The kind class is appended only when non-empty: `ui-stop-kind` alone for the fuel stop, so its left border is `var(--ui-primary)` blue and the kind text uses the default text colour.

### 4.3 Data contract and derivations

**KPIs (`facts`)**
- `Miles` → `sel.miles`.
- `Line haul` → `sel.rate`, with note `` `${sel.rpm} / mi` `` unless `rpm === '—'`.
- `sel.carrierRate ? 'Carrier cost' : 'Driver pay'` → `sel.pay`.
- `Margin` → `sel.margin`.

**Freight & pay** (despite the title, it shows no pay items)
- `Mode` (only if `sel.mode`)
- `Commodity`, `Weight`, `Equipment`, `Temperature` (temp), `Reference` (ref)
- `LTL` (only if `sel.ltl`)

**Carrier**
- `Carrier` (carrier), `MC #` (carrierMc, whose value already contains "MC "), `DOT #` (carrierDot)
- `Carrier rate` (only if `sel.carrierRate`)

**Stops**
- **Load created with + New Load** (`sel.stops` present): one entry per stop, `kind` = `'Pickup'|'Delivery'`, kindClass `pickup|delivery`, name, address, `window = s.when` (e.g. `Sep 10 · 08:00–14:00`, or `Sep 10 · Any time`).
- **Mock load**: 3 stops, all fabricated from the load fields:
  1. kind = `sel.status==='At pickup' ? 'Pickup · at shipper' : 'Pickup · complete'`, class `pickup`, name `from`, address `fromAddr`, window `` `Pickup ${pickup} · 08:00–14:00` ``
  2. kind `'Fuel stop'`, class `''`, name `'Planned · 92 gal, DEF top-off'`, address `'Routed automatically on the lane'`, window `` `${pickup} · 16:40` ``
  3. kind = `delivered ? 'Delivery · complete' : 'Delivery'`, class `delivery`, name `to`, address `toAddr`, window `` `Deliver ${delivery} · 06:00–12:00` ``

**Documents**
- **Created load**: 5 rows in the order `Rate confirmation`, `Customer load tender`, `Bill of lading`, `Proof of delivery`, `Lumper receipt`. State is `Attached` if a file name was chosen, else `Pending`.
- **Mock load**:
  - `Rate confirmation` → always `Attached`
  - `Bill of lading` → `Attached` if delivered or status `Needs POD`, else `Pending`
  - `Proof of delivery` → `Attached` if delivered, else `Pending`
- Chip colour: `Attached` = green, `Pending` = amber.

**Activity**
- **Created load**:
  - `{when: createdAt, what: 'Load created by Rosa Medina'}` (from `USER.name`)
  - plus, if notes exist, `{when: createdAt, what: 'Driver instructions: {notes}'}`
  - `createdAt` = `` `Today ${HH}:${MM}` `` from the browser's local clock at creation time.
- **Mock load**, always these 4:
  - `Today 07:12` · `Driver accepted the load in the app`
  - `Today 08:41` · `Arrived at {from}`
  - `Today 10:05` · `Bill of lading uploaded from the cab`
  - `Today 10:06` · `delivered ? 'Invoice queued for billing' : 'Dispatch notified the consignee'`

Per-load rendered matrix (mock data):

| Load | Header sub-line | Miles | Line haul (note) | Driver pay | Margin | Stop 1 kind | Stop 3 kind | BOL | POD | Activity #4 |
|---|---|---|---|---|---|---|---|---|---|---|
| L-40218 | Load L-40218 · Northgate Foods · In transit | 478 | $2,450 ($5.13 / mi) | $612 | $1,214 | Pickup · complete | Delivery | Pending | Pending | Dispatch notified the consignee |
| L-40219 | … Bayline Distribution · At pickup | 736 | $3,180 ($4.32 / mi) | $795 | $1,540 | **Pickup · at shipper** | Delivery | Pending | Pending | Dispatch notified… |
| L-40220 | … Cascade Building Supply · Delayed | 602 | $2,910 ($4.83 / mi) | $728 | $1,388 | Pickup · complete | Delivery | Pending | Pending | Dispatch notified… |
| L-40221 | … Harbor Point Retail · Needs driver | 632 | $3,540 ($5.60 / mi) | — | — | Pickup · complete | Delivery | Pending | Pending | Dispatch notified… |
| L-40214 | … Northgate Foods · Needs POD | 389 | $1,980 ($5.09 / mi) | $495 | $986 | Pickup · complete | Delivery | **Attached** | Pending | Dispatch notified… |
| L-40212 | … Bayline Distribution · Delivered | 271 | $1,640 ($6.05 / mi) | $410 | $842 | Pickup · complete | **Delivery · complete** | Attached | Attached | **Invoice queued for billing** |
| L-40210 | … Sierra Ag Partners · Delivered | 1,142 | $4,120 ($3.61 / mi) | $1,030 | $1,904 | Pickup · complete | Delivery · complete | Attached | Attached | Invoice queued for billing |
| L-40222 | … Cascade Building Supply · Dispatched | 578 | $2,760 ($4.78 / mi) | $690 | $1,312 | Pickup · complete | Delivery | Pending | Pending | Dispatch notified… |

Rate confirmation is always Attached. The h2 is the `route`. Arrival text is `Arrived at {from}` (e.g. `Arrived at Northgate Cold Storage`). The Freight & pay and Carrier values are the raw fields in §7.1.

**Financial derivations (authoritative, so they must be computed on the backend):**
- `rpm = rate / miles`, formatted `$X.XX`. This checks out for all 8 mock loads (e.g. 2450/478 = 5.1255 → `$5.13`). For created loads it is `lineHaul/miles` and uses line haul only.
- Mock `pay` = exactly 25% of the rate, rounded half-to-even (612.5 → 612, 727.5 → 728). This **contradicts** the per-driver pay bases in `SETTLEMENTS` (e.g. Marcus Hale `$0.62 / mi`). For created loads, `pay` = the entered driver pay, or the carrier rate when brokered.
- Mock `margin` is **not** derivable from the displayed fields. `rate − pay − margin` leaves an implied "other cost" of 624, 845, 794, (n/a), 499, 388, 1186, 758 for the loads in table order, which is not constant per mile. For created loads, `margin = (lineHaul + fuel + accessorials) − cost`, signed (`-$…` when negative), and `'—'` when cost is 0. **The seed must store cost components so that the backend formula reproduces the displayed margins** (suggestion: `other_cost_cents` per load, set to the implied values above).

### 4.4 Interactions
None on the page itself. Top bar: `← Loads` goes to `/app/loads`. `Message driver` and `Update status` do nothing in the prototype. In the target, "Update status" becomes a state-machine transition (`loads.update`, audit + event), and "Message driver" becomes messaging. Both are out of scope for parity and should stay inert or be specified separately.

---

## 5. CRM: `/app/crm` (`CustomersPage.tsx`)

### 5.1 Layout
```
<Kpis items=KPIS/>                          // module constant, not clickable
<div class="ui-grid-3">
  for a in TOP_ACCOUNTS: <Card key={name}>   // no title; not clickable; NOT filtered by search
    <div class="ui-label" style="color:var(--ui-primary)">{tier}</div>
    <div style="font-size:18px;font-weight:700;margin-top:6px">{name}</div>
    <div style="font-size:13px;color:var(--ui-muted);margin-top:2px">{contact}</div>
    <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-top:18px;padding-top:14px;border-top:1px solid var(--ui-border)">
      for [k,v] in [['Loads',loads],['Revenue',revenue],['On time',onTime]]:
        <div><div class="ui-label">{k}</div><div style="font-size:22px;font-weight:700;margin-top:4px">{v}</div></div>
    </div>
  </Card>
</div>
<Card title="All accounts" flush>
  <table class="ui-table"><thead><tr>
    <th>Customer</th><th>Primary contact</th><th class="num">Loads YTD</th><th class="num">Revenue</th>
    <th class="num">On time</th><th class="num">Terms</th><th class="num">AR balance</th><th class="num">Standing</th></tr></thead>
  <tbody> for c in rows: <tr key={name}>   // NOT clickable
    <td class="strong">{name}</td><td class="muted">{contact}</td><td class="num">{loads}</td><td class="num">{revenue}</td>
    <td class="num">{onTime}</td><td class="num">{terms}</td><td class="num">{ar}</td><td class="num"><Tag label={tier} tagClass/></td></tr>
  </tbody></table>
  {rows.length===0 && <div class="ui-empty">Nothing matches “{query}”.</div>}
</Card>
```
`rows = CUSTOMERS.filter(c => matchesQuery(c, query))`. The searched fields are name, contact, loads, revenue, onTime, terms, ar and tier. For example, "net 45" matches Cascade and "at risk" matches Sierra.

### 5.2 KPIs: hardcoded in the source, but all derivable (which makes them backend aggregates)

| Label | Shown | Source | Derivation that reproduces it |
|---|---|---|---|
| Accounts | `6` (note `2 key accounts`) | `CUSTOMERS.length`; note hardcoded | count(customers); count(standing='Key account') = 2 |
| Revenue YTD | `$1.3M` (note `Top 3 accounts = 73%`) | hardcoded | Σ revenue = 412+338+196+121+154+74 = **$1,295K** → compact `$1.3M`; the top 3 **by revenue** (Northgate, Bayline, Cascade) = 946/1295 = **73.05%** → `73%` |
| On time | `92%` (note `Weighted by loads`) | hardcoded | Σ(loads×onTime)/Σloads = 50,562/547 = **92.44%** → `92%` (the unweighted mean would be 91%) |
| Open AR | `$91.9K` (note `1 account at risk`) | hardcoded | Σ ar = 18,400+12,900+21,300+6,100+29,300+3,850 = **$91,850** → `$91.9K`; count(standing='At risk') = 1 |

Compact currency matching all prototype strings: `Intl.NumberFormat('en-US',{style:'currency',currency:'USD',notation:'compact',maximumFractionDigits:1})` gives 412000 → `$412K`, 91850 → `$91.9K`, 1295000 → `$1.3M`, 168000 → `$168K`. Pin this with unit tests. It requires the seeded values to be exact round thousands (e.g. revenue 412,000), otherwise the output becomes `$412.3K`.

### 5.3 Rendered mock data
Top-account cards (in order):

| tier (blue label) | name | contact | Loads | Revenue | On time |
|---|---|---|---|---|---|
| Key account | Northgate Foods | Dana Ruiz · dana@northgate.com | 184 | $412K | 96% |
| Key account | Bayline Distribution | Owen Petrakis · ops@bayline.co | 151 | $338K | 94% |
| At risk | Sierra Ag Partners | Ben Okafor · ben@sierraag.com | 62 | $154K | 82% |

Selection rule (not in the code; TOP_ACCOUNTS is a separate constant): exactly the customers whose standing ≠ `Growing`, in CUSTOMERS order, which is also revenue-descending order. The backend can serve this as `standing IN ('key_account','at_risk') ORDER BY revenue_ytd DESC`. The top-card email is **not** in CUSTOMERS.contact, so the backend needs `primary_contact.email`.

All accounts table:

| Customer | Primary contact | Loads YTD | Revenue | On time | Terms | AR balance | Standing (chip) |
|---|---|---|---|---|---|---|---|
| Northgate Foods | Dana Ruiz | 184 | $412K | 96% | Net 30 | $18,400 | Key account (blue) |
| Bayline Distribution | Owen Petrakis | 151 | $338K | 94% | Net 30 | $12,900 | Key account (blue) |
| Cascade Building Supply | Marta Lind | 77 | $196K | 91% | Net 45 | $21,300 | Growing (gray) |
| Harbor Point Retail | Jules Amari | 44 | $121K | 89% | Net 30 | $6,100 | Growing (gray) |
| Sierra Ag Partners | Ben Okafor | 62 | $154K | 82% | Net 60 | $29,300 | At risk (amber) |
| Vantage Home Goods | Iris Chen | 29 | $74K | 93% | Net 30 | $3,850 | Growing (gray) |

**Business vs presentation**
- Loads YTD, Revenue, On time and AR balance are **authoritative aggregates** computed from loads and invoices on the backend.
- Terms and Standing are stored customer attributes.
- The chip colour is presentation.

### 5.4 Interactions
Search only (the `query` context). No row or card clicks. Top bar: Filters and "+ Add Customer" are no-ops.

---

## 6. Facilities: `/app/facilities` (`FacilitiesPage.tsx` → `ComingSoon`)
```
<Card>
  <div class="ui-label" style="color:var(--ui-primary)">Coming soon</div>
  <h2 class="ui-h2">Every yard, shop and dock in one register</h2>
  <p class="ui-p">Where equipment is parked, where loads pick up and deliver, and what each site needs from the driver when they arrive.</p>
  <ul class="ui-bullets">
    <li>Yards and terminals: what is parked where, and for how long</li>
    <li>Shop bays with service scheduling and parts on order</li>
    <li>Customer pickup and delivery sites with hours, dock notes and contacts</li>
    <li>Fuel, scale and parking stops on frequent lanes</li>
  </ul>
</Card>
<div class="ui-placeholder">Yard map</div>
```
CSS:
- `.ui-p{margin:8px 0 0;max-width:60ch;font-size:14px;line-height:22px;color:var(--ui-text-2)}`
- `.ui-bullets{margin:16px 0 0;padding:0;list-style:none}` and `.ui-bullets li{padding:8px 0;border-top:1px solid var(--ui-border);font-size:14px}` (the first li also has a top border)
- `.ui-h2` keeps its `margin-top:8px`.

No data, no API. It can be a Server Component. The top bar still shows the search input, which has no effect here.

---

## 7. Canonical seed data (what the backend must serve so that the screens render identically)

### 7.1 Loads (mock order = required default list order; see §8.3)

| # | number | customer | route (lane label) | pickup | delivery | driver | truck / trailer | rate | status | miles | rpm | pay | margin | commodity | weight | equipment | temp | ref | from / fromAddr | to / toAddr | carrier / MC / DOT |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | L-40218 | Northgate Foods | Fresno, CA → Reno, NV | Sep 3 | Sep 4 | Marcus Hale | T-114 / RF-88 | $2,450 | In transit | 478 | $5.13 | $612 | $1,214 | Frozen produce | 41,200 lb | Reefer, 53 ft | -10 °F | PO 88-41207 | Northgate Cold Storage / 4120 S Golden State Blvd, Fresno, CA | Reno Grocers DC / 1855 E Greg St, Sparks, NV | own |
| 2 | L-40219 | Bayline Distribution | Stockton, CA → Salt Lake City, UT | Sep 3 | Sep 5 | Dara Whitfield | T-107 / DV-51 | $3,180 | At pickup | 736 | $4.32 | $795 | $1,540 | Palletized dry goods | 38,500 lb | Dry van, 53 ft | Ambient | PO 55-90114 | Bayline DC 4 / 2900 Navy Dr, Stockton, CA | Wasatch Crossdock / 1740 S 4130 W, Salt Lake City, UT | own |
| 3 | L-40220 | Cascade Building Supply | Sacramento, CA → Boise, ID | Sep 2 | Sep 4 | Ellis Nakamura | T-121 / FB-12 | $2,910 | Delayed | 602 | $4.83 | $728 | $1,388 | Lumber | 44,000 lb | Flatbed, tarped | Ambient | SO 7741 | Cascade Yard 2 / 8300 Elder Creek Rd, Sacramento, CA | Boise Builders Depot / 440 E Corporate Dr, Meridian, ID | own |
| 4 | L-40221 | Harbor Point Retail | Oakland, CA → Portland, OR | Sep 4 | Sep 6 | Unassigned | — | $3,540 | Needs driver | 632 | $5.60 | — | — | Consumer goods | 30,100 lb | Dry van, 53 ft | Ambient | PO 31-2280 | Port of Oakland, Berth 22 / 1599 Maritime St, Oakland, CA | Harbor Point DC / 6200 N Basin Ave, Portland, OR | Not yet covered / — / — |
| 5 | L-40214 | Northgate Foods | Bakersfield, CA → Phoenix, AZ | Sep 1 | Sep 2 | Priya Raman | T-103 / RF-27 | $1,980 | Needs POD | 389 | $5.09 | $495 | $986 | Dairy | 36,800 lb | Reefer, 53 ft | 34 °F | PO 88-41190 | Northgate Creamery / 3011 Buck Owens Blvd, Bakersfield, CA | Valley Foods DC / 2240 W Buckeye Rd, Phoenix, AZ | own |
| 6 | L-40212 | Bayline Distribution | Los Angeles, CA → Las Vegas, NV | Aug 31 | Sep 1 | Marcus Hale | T-114 / DV-88 | $1,640 | Delivered | 271 | $6.05 | $410 | $842 | Beverages | 42,000 lb | Dry van, 53 ft | Ambient | PO 55-89902 | Bayline LA Annex / 5200 S Boyle Ave, Vernon, CA | Sunset Beverage DC / 3900 W Cheyenne Ave, North Las Vegas, NV | own |
| 7 | L-40210 | Sierra Ag Partners | Modesto, CA → Denver, CO | Aug 29 | Sep 1 | Tobias Frey | T-118 / DV-14 | $4,120 | Delivered | 1,142 | $3.61 | $1,030 | $1,904 | Almonds | 43,500 lb | Dry van, 53 ft | Ambient | SO 2214 | Sierra Ag Huller 3 / 1901 Crows Landing Rd, Modesto, CA | Front Range Foods / 5400 Havana St, Denver, CO | own |
| 8 | L-40222 | Cascade Building Supply | Redding, CA → Seattle, WA | Sep 5 | Sep 6 | Ana Cortez | T-109 / FB-04 | $2,760 | Dispatched | 578 | $4.78 | $690 | $1,312 | Steel coil | 46,000 lb | Flatbed, 48 ft | Ambient | SO 7802 | Cascade Mill / 3400 Airport Rd, Redding, CA | Duwamish Steel Yard / 8100 E Marginal Way S, Seattle, WA | own |

"own" = `Sunridge Freight (own fleet)` / `MC 812044` / `DOT 2291176`. Year 2026 throughout. The mock loads have no `mode`, `ltl`, `stops`, `documents`, `carrierRate`, `notes` or `createdAt`.
**Note:** the route's city is a lane or market label, and it does **not** always match the stop address city (Reno vs Sparks, Boise vs Meridian, Los Angeles vs Vernon, Las Vegas vs North Las Vegas). Either store a lane label per load, or store a `market_city` per location. Deriving the route from address cities would change 4 of the 8 routes.

### 7.2 Loads created with + New Load (shape produced by `NewLoadDialog.toLoad`, lines 138–194)
- `id = 'L-' + (max numeric suffix of all loads + 1)`, so the first is `L-40223`.
- `route` = `"{City}, {ST} → {City}, {ST}"` from the first pickup and last delivery stops.
- `pickup`/`delivery` = `"Mon D"`.
- `driver` = name or `'Unassigned'`. `unit` = `"truck / trailer"`, whichever parts exist, or `'—'`.
- `rate = money(lineHaul)`.
- `status` = `Dispatched` if brokered or a driver was chosen, else `Needs driver`.
- `miles` = `toLocaleString`, or `'—'`. `rpm`, `pay`, `margin` as in §4.3.
- `weight = "{n, en-US} lb"`.
- `temp` = `"{t} °F"` for Reefer with a temperature, `'Set at pickup'` for Reefer without one, else `'Ambient'`.
- `ref` = ref ‖ po ‖ `'—'`.
- `carrier` = the chosen partner (brokered), else own fleet. An **uncovered created load still shows own fleet**, unlike L-40221.
- `mode` ∈ `Full truckload | Less than truckload | Partial`. `ltl` = `"Class {c} · {n} {packaging lowercased} · {services…}"`.
- `stops[]` = `{kind, name, address:"{street}, {City}, {ST} {zip}", when:"Mon D · HH:MM–HH:MM" | "Mon D · HH:MM" | "Mon D · Any time"}`.
- `documents[5]`, `carrierRate` (brokered), `notes`, `createdAt:"Today HH:MM"`.
The target must return equivalent fields from the API (see §8.2).

### 7.3 Drivers (Dashboard)
Marcus Hale On duty 6h 20m · Dara Whitfield On duty 9h 05m · Ellis Nakamura On duty 1h 45m · Priya Raman Available 11h 00m · Ana Cortez Available 11h 00m · Tobias Frey Home time — (HOS `—`). Other DRIVERS fields (unit, load, cdl, pay, miles) are not used by these pages.

### 7.4 Customers and top accounts: §5.3.

### 7.5 Dashboard-only accounting data
UNINVOICED (11 rows, `data/accounting.ts:44-56`):
L-40209 $2,450 · L-40208 $3,180 · L-40207 $2,910 · L-40206 $3,540 · L-40204 $2,880 · L-40203 $1,980 · L-40205 $4,120 · L-40202 $3,620 · L-40201 $2,760 · L-40200 $3,050 · L-40199 $4,410. The Dashboard reads only the count and the sum. **None of these load numbers exists in LOADS** (see §12, conflict C1).
Revenue per day, as labelled `Thu … Wed` = 42, 58, 51, 66, 74, 38, 29 (unit unknown). Calendar dates Aug 28 → Sep 3 2026 are actually Fri → Thu, so label and date disagree by one day (corrected by the completeness critic; see §2.3 C). A `revenueByDay` seed must pick one: keep the prototype labels verbatim (parity) or the true weekdays (visible change).

### 7.6 Mock constants named in the brief that these pages do NOT read
- `COMPLIANCE`: used by `data/fleet.ts` (Drivers tab).
- `AR` (aging buckets $96,400 / $41,200 / $18,750 / $7,900): used by `accounting/InvoicedTab.tsx`.
- `INVOICES`: used via `ALL_INVOICES` in accounting tabs.
- `SETTLEMENTS`, `SETTLE_TAG`: Payroll. `CARRIERS`, `TRUCKS`, `TRAILERS`: NewLoadDialog and Fleet.
They matter here only because they have to be **consistent** with what these pages show once everything comes from one database (§12).

---

## 8. Backend contract (proposed; subject to `03-database.md` / `04-api.md`, which don't exist yet)

All endpoints: authenticated, `organization_id` taken from the session, `{data, meta}` envelope, Zod-validated query params, UUID `id`s, money in integer cents, dates as ISO (appointment windows with facility timezone), UTC timestamps.

### 8.1 Endpoints used by these screens

| Screen | Call | Permission (proposed) | Returns |
|---|---|---|---|
| Dashboard | `GET /api/v1/dashboard/summary` | `loads.view` + `billing.view` (+ `drivers.view`) | `{activeLoads, activeLoadsDeltaWoW, revenueThisWeekCents, revenueDeltaPct, deadheadPct, deadheadDeltaPts, unbilledCount, unbilledAmountCents, revenueByDay:[{date,weekday,amountCents}×7], drivers:[{id,name,dutyStatus,hosRemainingMinutes|null}]}` |
| Dashboard table | `GET /api/v1/loads?view=active&limit=6` or `?q=…&limit=6` | `loads.view` | load list items |
| Loads | `GET /api/v1/loads?view=active\|needs_pod\|delivered\|all&q=…` (+ cursor pagination) | `loads.view` | list items with expand fields (§8.2) |
| Loads KPIs | `GET /api/v1/loads/summary` | `loads.view` | `{needsDriver, inTransit, delivered, needsPod}`, counted over all loads regardless of view or q |
| Load detail | `GET /api/v1/loads/:id` | `loads.view` (financials: see §13 Q5) | full load + stops + documents + activity; 404 `LOAD_NOT_FOUND` |
| CRM | `GET /api/v1/customers?q=…` | `customers.view` | rows with aggregates |
| CRM KPIs/top | `GET /api/v1/customers/summary` | `customers.view` (+ `billing.view` for AR) | `{accounts, keyAccounts, revenueYtdCents, top3SharePct, onTimeWeightedPct, openArCents, atRiskCount, topAccounts:[…]}` |
| (header) New Load | `POST /api/v1/loads` | `loads.create` | created load. Audit `LOAD_CREATED`, event `LoadCreated`, number allocated server-side |

### 8.2 Load list item / detail fields (the minimum needed for parity)
- **Identity:** `id` (uuid), `number` (`L-40218`).
- **Customer:** `customer {id,name}`.
- **Lane:** `lane {originLabel:"Fresno, CA", destinationLabel:"Reno, NV"}`.
- **Status:** `status` (enum; the display label is mapped in §9.2), `isDelayed?`.
- **Dates:** `pickupDate`, `deliveryDate` (local dates of the first pickup and last delivery).
- **Assignment:** `driver {id,name}|null`, `truck {id,unit}|null`, `trailer {id,unit}|null`.
- **Money:** `lineHaulCents`, `fuelSurchargeCents`, `accessorialsCents`, `miles|null`, `ratePerMileCents|null` (computed), `costLabel:'driver_pay'|'carrier_cost'`, `costCents|null`, `marginCents|null` (computed).
- **Freight:** `commodity`, `weightLb`, `equipment`, `temperature {mode:'ambient'|'set_at_pickup'|'controlled', f?}`, `tenderRef|null`, `mode|null`, `ltlSummary|null`.
- **Carrier:** `carrier {name, mcNumber, dotNumber, isOwnFleet}|null` (null means "Not yet covered"), `carrierRateCents|null`.
- **Stops:** `stops[{sequence, kind:'pickup'|'delivery'|'fuel', status:'pending'|'arrived'|'complete', name, address, windowStart, windowEnd, timezone, note?}]`.
- **Documents:** `documents[{type, fileName|null, state:'attached'|'pending'}]`.
- **Activity:** `activity[{at (UTC), message}]`, from audit_logs/events.
- **Audit:** `notes`, `createdAt`, `createdBy {name}`.

### 8.3 Ordering
Default list order has to reproduce `[created newest-first…, L-40218, L-40219, L-40220, L-40221, L-40214, L-40212, L-40210, L-40222]`. That order is not by number or by date. Recommended: `ORDER BY created_at DESC, id` with seed `created_at` values descending in that order. Load numbers must be allocated per organization, starting after 40222.

### 8.4 Search (`q`)
To keep the exact prototype semantics (a case-insensitive substring match over display strings), the backend keeps a lowercased `search_text` per row built from the display strings, and filters with `ILIKE '%'||q||'%'` (with `%`/`_` escaped, and a pg_trgm index).
- **Load fields:** number, customer name, route, pickup/delivery (`Sep 3`), driver name (or `Unassigned`), unit (`T-114 / RF-88` or `—`), rate (`$2,450`), status label, miles, rpm, pay, margin, commodity, weight (`41,200 lb`), equipment, temp, ref, from, fromAddr, to, toAddr, carrier, `MC …`, `DOT …`, mode, ltl, notes.
- **Customer fields:** name, contact name, loads, revenue (`$412K`), on-time (`96%`), terms, AR (`$18,400`), standing label.
- Trim the query and lowercase it on the server. An empty `q` means no filter.

### 8.5 Computations that must move to the backend (`packages/calculations`, shared)
- Active count. The count per status. Unbilled count and sum.
- Revenue this week and its WoW %. Revenue per day. Deadhead %.
- rpm. Driver pay or carrier cost (from pay basis or carrier rate). Margin.
- Customer loads YTD, revenue YTD, weighted on-time %, AR balance.
- Top-3 revenue share. Key-account and at-risk counts.
- Load status transitions. Document state. Load number allocation.

**Pure presentation** (stays in web):
- Bar height % and max-bar highlight.
- Chip colour from status or standing.
- Duty-status dot colour and the `On duty · {hos} left` string.
- All string formatting (§9).
- `openId`, `loadTab`, `query`.
- `slice(0,6)` (better sent to the API as `limit=6`).

---

## 9. Presentation formatting rules (web)
### 9.1 Formatters
- **Money:** `'$' + Math.round(cents/100).toLocaleString('en-US')` → `$2,450`. Negative: `-$1,234`. Null → `—` (U+2014).
- **Rate per mile:** `'$' + (cents/100).toFixed(2)` → `$5.13`, plus `" / mi"` on the detail KPI note.
- **Compact money:** see §5.2.
- **Percent:** `Math.round(x) + '%'`.
- **Miles:** `toLocaleString('en-US')` → `1,142`. Weight: `41,200 lb`. Temperature: `-10 °F` (ASCII hyphen-minus, a space, then U+00B0), or `Ambient`, or `Set at pickup`.
- **Dates:** `MMM d` in English without a year (`Sep 3`, `Aug 31`). Times: 24-hour `HH:MM`, and windows joined with an en dash (`08:00–14:00`).
- **Separators:** `·` is U+00B7 with spaces on both sides. The route arrow is `→` U+2192.
- **HOS:** `{h}h {mm}m` (e.g. `9h 05m`).
- **Activity time:** `Today HH:MM` when it falls on the org-local today. Other days are unspecified in the prototype; propose `MMM d HH:MM`.
- **Carrier:** `MC {n}`, `DOT {n}`. Null carrier → `Not yet covered`, `—`, `—`.
### 9.2 Status and standing maps

| Display label | Chip | In "Active"? | Proposed enum (architecture §17) |
|---|---|---|---|
| Needs driver | amber | yes | BOOKED with no driver or carrier |
| Dispatched | gray | yes | DISPATCHED |
| At pickup | gray | yes | AT_PICKUP |
| In transit | blue | yes | IN_TRANSIT (also LOADED / AT_DELIVERY → label TBD) |
| Delayed | amber | yes | IN_TRANSIT + `is_delayed` exception flag (decision needed) |
| Needs POD | amber | no | DELIVERED (POD not received) |
| Delivered | gray | no | POD_RECEIVED / READY_FOR_BILLING / INVOICED / PAID |

Standing: Key account → blue, Growing → gray, At risk → amber. Document: Attached → green, Pending → amber. Duty dot: On duty → primary, Available → green, other → muted.

---

## 10. State classification

| State | Where | Class | Target |
|---|---|---|---|
| Loads list / detail / created loads | `AppShellContext.created` + `LOADS` | **(a) business** | PostgreSQL via `/api/v1/loads`. Server-fetched, never authoritative in the client |
| Load number generation | `NewLoadDialog.nextId` | **(a) business** | server sequence per org |
| rpm / pay / margin / KPIs / aggregates | client code or hardcoded | **(a) business (financial)** | backend-computed |
| Documents attached / pending | derived from status or file name | **(a) business** | `documents` table + object storage |
| Activity log | fabricated / `createdAt` string | **(a) business** | `audit_logs` / `events` (UTC) |
| Customers, standing, terms, contacts | `CUSTOMERS`, `TOP_ACCOUNTS` | **(a) business** | `customers`, contacts |
| Driver duty status / HOS | `DRIVERS` | **(a) business** (integration later) | `drivers` (+ tracking) |
| `query` (search text) | context | **(b) client** | React context in the `/app` layout (optionally debounced into the `q` param) |
| `loadTab` | context | **(b) client** | React context (not in the URL, to match the prototype) |
| `openId` (expanded row) | LoadsPage `useState` | **(b) client** | component state |
| Theme | localStorage `runtruck-theme` | **(b) client** | unchanged |

---

## 11. Next.js App Router porting hazards
1. **React Router APIs used by these pages**
   - `useNavigate` (Dashboard) → `useRouter().push` from `next/navigation`.
   - `Link` (Dashboard "View all", Loads "Open load →") → `next/link`. It renders the same `<a>`, so keep `className="ui-link"`.
   - `useParams` (LoadDetail) → the `params` prop of `app/.../loads/[id]/page.tsx`. In Next 15 this prop is a **Promise** and must be awaited. Alternatively use `useParams()` from `next/navigation` in a client component.
   - Shell-level: `Outlet` → layout `children`. `Navigate` (index `/app` → `/app/dashboard`, legacy redirects, `*` → `/`) → `redirect()` in `app/app/page.tsx`, `next.config` `redirects()`, and a catch-all or `not-found` that redirects to `/`. By default, Next renders a 404 page where the prototype redirects.
2. **Case sensitivity:** RR v7 route matching is case-insensitive (`/app/LOADS` works, and Header/Sidebar lowercase the path). Next is case-sensitive. Add middleware that lowercases the section segments while leaving `:id` alone, or accept the 404.
3. **Folder naming:** the URL prefix `/app` means `apps/web/app/app/...` (or a route group like `app/(shell)/app/...`). Keep the URLs exactly: `/app/dashboard`, `/app/loads`, `/app/loads/[id]`, `/app/crm`, `/app/facilities`.
4. **Client components:**
   - Must be `'use client'`: Dashboard (click handlers, `query`), Loads (`useState`, context), CRM (`query`), and the shell context provider, which goes in the `/app` layout so `query` and `loadTab` survive navigation like RR.
   - Load detail and Facilities can be Server Components, apart from the top bar.
5. **Initial expanded row:** `useState(firstId(rows))` only works when the rows exist on the first render. If data is fetched on the client, rows start empty, no row is expanded, and parity is broken. Pass server-fetched initial data (RSC → client props, or React Query `initialData` / hydration). As a fallback, set `openId` once when the first data arrives. Remount on navigation so it resets like RR.
6. **Loading and empty flashes:** the prototype has no loading state. Use server-rendered first paint, and `keepPreviousData` while the `q` search refetches. Otherwise the "Nothing matches “…”." or "No loads in this view." states flash. Server search adds latency where the prototype filters synchronously on every keystroke.
7. **Scroll behaviour:** in RR, `.ui-main` persists across navigation, so its scrollTop is kept (clamped) when you move between pages. The Next App Router scrolls the new segment into view on navigation. That is a visible difference, so decide which behaviour to keep (§13 Q8).
8. **Global CSS:** import `industry.css`, `app.css`, `shell.css`, `calendar.css` **in that order** in the root `app/layout.tsx`. Next only allows global CSS there. The order matters: shell.css overrides app.css `.num` and link colours. Don't convert them to CSS Modules, because the class names are global (`ui-*`).
9. **Fonts:** the prototype uses a Google Fonts `<link>` (Inter / Barlow / Barlow Condensed, `display=swap`), and the CSS names families literally (`"Inter"`, `"Barlow Condensed"`, `"Barlow"`). `next/font/google` hashes family names and adds size-adjusted fallbacks, so metrics differ slightly. Either keep the `<link>` in the root layout `<head>`, or use `next/font` with `variable` and rewrite the three font-family declarations to the CSS variables.
10. **Theme:** `index.html` runs an inline pre-paint script (`localStorage 'runtruck-theme'` → `data-theme="dark"` on `<html>`). Reproduce it with a `<script dangerouslySetInnerHTML>` in the root layout head, and add `suppressHydrationWarning` on `<html>`. `document`/`localStorage` must not be touched during SSR.
11. **Locale formatting:** always pass `'en-US'` explicitly. The prototype's `money()` already does; a server locale must not produce different output from the client, or hydration mismatches follow.
12. **"Today":** the prototype pins today to 2026-09-03 (a **Thursday**, although the chart's hard-coded weekday labels run Thu…Wed as if it were a Wednesday), `Today HH:MM` strings, `accounting.TODAY='Sep 3'`). A real backend uses the real clock, so for demo parity add an org- or environment-level "as-of" date for seeded demo data (§13 Q7).
13. **Module-scope computations** (`MAX_BAR`, `CHART`, `DRIVER_ROWS`, `KPIS` in DashboardPage and CustomersPage) become per-request derivations. Guard `Math.max(...[])` (gives `-Infinity`) and max = 0 (gives `NaN%` heights).
14. **Native `<dialog>`:** not used by these pages directly. The + New Load dialog (top bar on Dashboard and Loads) uses `showModal()` in `useEffect`, which is client-only (covered by the dialog spec).
15. **Accessibility / markup:** clickable `<tr>` and `<div>`s have no keyboard handlers. Reproduce the markup exactly; any a11y improvement must not change the visuals.
16. **URL ids:** the prototype URLs carry the load number (`/app/loads/L-40218`). The architecture wants UUID ids. Either put the UUID in the URL (visible URL change) or resolve by number server-side (`GET /api/v1/loads?number=L-40218`, or accept number-or-uuid). See §13 Q1.

---

## 12. Bugs, inconsistencies and architecture conflicts

**Architecture conflicts**
- **A1:** Business data lives in React state and is lost on reload: `AppShellContext.tsx:29,40-41` (`created`, `addLoad`). Violates Rule 1. → `POST /api/v1/loads` with audit + `LoadCreated` event.
- **A2:** The client generates load numbers: `NewLoadDialog.tsx:196-198` (`max+1`). This is race-prone and not tenant-scoped. → server sequence.
- **A3:** Authoritative financial maths runs in the client: `NewLoadDialog.tsx:143-166` (rpm, pay, margin) and `DashboardPage.tsx:36` (unbilled sum). → backend (§5 of the architecture: "Financial calculations that require authoritative results").
- **A4:** Hardcoded business KPIs:
  - `DashboardPage.tsx:33` `'+4 vs. last week'`
  - `:34` `'$168K'`, `'+9.2%'`
  - `:35` `'7.8%'`, `'1.4 pts better'`
  - `CustomersPage.tsx:8-13` (all four; they happen to reconcile with CUSTOMERS, §5.2)
- **A5:** Fabricated records presented as real:
  - `LoadDetailPage.tsx:18-22` (a fuel stop on every mock load)
  - `:40-44` (document states inferred from status)
  - `:50-55` (four "Today" activity entries on every mock load, delivered and unassigned ones included)
  → these need real `load_stops`, `documents` and `audit_logs`/`events`. To stay pixel-identical, the seed must insert them explicitly.
- **A6:** An unknown id falls back to the first load: `LoadDetailPage.tsx:12` (`?? loads[0]`). This should be 404 `LOAD_NOT_FOUND`. It also crashes when `loads` is empty (`sel.status` of undefined).
- **A7:** Presentation (`tagClass`) is stored in the data records (`mock.ts:95-118, 219-224`). Money, dates and weights are stored as preformatted strings. → enums, cents, ISO dates and client formatters.
- **A8:** `createdAt` is a local-clock string, `` `Today ${HH}:${MM}` `` (`NewLoadDialog.tsx:192`). It never ages and has no timezone. → a UTC `created_at` (architecture §9).
- **A9:** Search runs client-side over the full dataset (`lib/search.ts`, `LoadsPage.tsx:27`, `DashboardPage.tsx:30`, `CustomersPage.tsx:17`). Architecture §37 requires server-side search and pagination (§8.4).
- **A10:** The prototype's statuses (`Needs driver`, `Delayed`, `Needs POD`) don't map 1:1 onto the §17 lifecycle, and `08-load-lifecycle.md` doesn't exist. See §9.2 for the proposal.

**Data conflicts that block "identical + DB is source of truth"**
- **C1:** Dashboard "Unbilled loads 11 · $34,900" comes from `UNINVOICED` (`accounting.ts:44-56`). Those loads (L-40199…L-40209) **are not in LOADS**. If the backend derives unbilled from real loads, it gets 0. If those 11 loads are seeded as `Delivered`, the Loads page shows Delivered = 13 and All = 19 instead of 2 and 8. Likewise `INVOICES` references loads L-40198, L-40191 and others that aren't in LOADS, so FK integrity would add more rows to "All". **Decision required** (§13 Q2).
- **C2:** Three incompatible AR totals:
  - Customers Σ AR = $91,850 (`mock.ts:219-224`)
  - `AR` aging buckets = $164,250 (`mock.ts:324-329`)
  - open invoices (Sent + Overdue in `ALL_INVOICES`) = $26,180
  Once AR is derived from invoices, the CRM "$91.9K" and the per-row balances change.
- **C3:** Customer aggregates (184 loads, $412K…) can't be derived from 8 loads. Parity requires seeded history (loads and invoices YTD) sized to produce exactly these values, or a stored snapshot. Either one conflicts with C1.
- **C4:** The revenue chart (Σ = 358, unit unknown) doesn't reconcile with "Revenue this week $168K". Mon–Wed = 141 and Sun–Wed = 207.
- **C5:** Mock driver pay is 25% of the rate (`mock.ts:95-118`), while `SETTLEMENTS` lists per-mile bases (`mock.ts:274-278`). The margin can't be derived (§4.3).
- **C6:** L-40214 is `Needs POD` but already has invoice INV-8841 `Sent` (`mock.ts:255`). L-40218 is `In transit` but has invoice INV-8845 `Draft` (`mock.ts:254`). Invoicing before POD conflicts with the §17 lifecycle.
- **C7:** An uncovered mock load shows carrier `Not yet covered` (`mock.ts:106`), but an uncovered created load shows own fleet (`NewLoadDialog.tsx:147`).
- **C8:** Driver data in DRIVERS (fleet area, but visible on the Dashboard) contradicts other records:
  - Ana Cortez is `Available` while L-40222 is Dispatched to her.
  - Priya Raman's CDL `07/2026` has expired as of Sep 3 2026 (and COMPLIANCE says "CDL renewal Jul 2026"), yet she is `Available` and on L-40214. A backend rule "cannot assign a driver with an expired CDL" (architecture Rule 5 / §19) would reject this seed.
  - Trailer FB-12 is `Inspection · Yard · Modesto` (`mock.ts:203`) while on the Delayed L-40220.
  - RF-27 is `Loaded · Bakersfield` although L-40214 was delivered in Phoenix.
  - FB-04 is `Loaded` before L-40222's Sep 5 pickup.
- **C9:** The route label vs address city mismatch (§7.1 note).

**UI bugs and inconsistencies (reproduce, or fix with sign-off)**
- **B1:** `LoadsPage.tsx:38`: `"1 loads"`, no singular.
- **B2:** `DashboardPage.tsx:63`: when there are no active loads and no search, it shows `Nothing matches “”.`. Same for `CustomersPage.tsx:64` with zero customers. Unreachable with the mock data but reachable with a real DB.
- **B3:** `DashboardPage.tsx:30,44`: while searching, the table lists non-active loads under the title "Active loads".
- **B4:** `LoadDetailPage.tsx:19`: `'Pickup · complete'` is shown for loads whose pickup hasn't happened (L-40221 Needs driver Sep 4, L-40222 Dispatched Sep 5).
- **B5:** `LoadDetailPage.tsx:21`: L-40214 `Needs POD` (delivered Sep 2) shows `'Delivery'` rather than complete.
- **B6:** `LoadDetailPage.tsx:51-53` vs `:42`: the activity says "Bill of lading uploaded from the cab" while the BOL chip says `Pending` (L-40218/19/20/21/22). L-40221 has no driver but says "Driver accepted the load in the app". Delivered loads (Aug 31, Aug 29) show "Today" activity.
- **B7:** Stops are inconsistent between the two screens for the same load. Loads expand shows 2 stops (`Pickup · Stop 1`, `Sep 3 · 08:00–14:00`). Detail shows 3 (with the fuel stop, `Pickup Sep 3 · 08:00–14:00`).
- **B8:** `LoadsPage.tsx:28`: `openId` isn't recomputed when the search changes, so the first match isn't auto-expanded. A tab click does auto-expand.
- **B9:** The query isn't cleared when navigating by KPI, "View all", a row click, "Open load →" or "← Loads". Only the sidebar, section tabs and the Loads filter pills clear it, so a Dashboard search carries over into Accounting and other tables.
- **B10:** Customers "Top 3 accounts = 73%" (`CustomersPage.tsx:10`) refers to Northgate, Bayline and **Cascade**. The top-account cards show Northgate, Bayline and **Sierra Ag** (`mock.ts:236-240`).
- **B11:** The "Freight & pay" card (`LoadDetailPage.tsx:99`) has no pay fields. For a brokered created load, the carrier cost appears twice: as the KPI and as "Carrier rate".
- **B12:** `money()` (`accounting.ts:28-30`) doesn't normalise fractions, so a decimal line haul from New Load renders as `$2,450.5`.
- **B13:** The Dashboard chart has no units or scale. Driver rows are not linked to the specific driver.
- **B14:** The Facilities page still shows a search box that filters nothing.

---

## 13. Open decisions to raise (architecture §49: don't pick silently)
1. **Q1** URL id: load number (as in the prototype) or UUID?
2. **Q2** How to seed so the Dashboard keeps 11 / $34,900 while Loads keeps 2 Delivered / 8 All (C1). Options: the Loads views exclude invoiced or historical loads; an as-of window; or accept the new numbers.
3. **Q3** The single source for AR, customer YTD aggregates and the revenue chart (C2–C4), and whether the prototype numbers must stay exact.
4. **Q4** Status enum and the `Delayed` representation (A10).
5. **Q5** Permissions for financial fields (rate, driver pay, margin, carrier rate) on load list and detail. Is it `loads.view` alone, or a separate `loads.financials.view` / `billing.view`? The demo user (Rosa Medina, Dispatch) must see them all for parity.
6. **Q6** Whether to keep the prototype bugs B1–B14 for "exactly the same", or fix them.
7. **Q7** A demo "as-of" clock (2026-09-03) and the org timezone. The data suggests America/Los_Angeles; stop windows should be facility-local.
8. **Q8** Scroll retention of `.ui-main` across navigation (RR keeps it; Next resets it).
9. **Q9** The fuel stop and HOS: seed them as data, or drop them until tracking and ELD integrations exist.
