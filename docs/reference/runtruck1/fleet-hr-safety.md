# Port spec: Fleet, HR, Safety (Runtruck1 to Runtruck2)

Source: `Runtruck1/app` (Vite + React 19.2 + react-router-dom 7.18, mock data only).
Target: `Runtruck2` (Next.js App Router web, NestJS `/api/v1` API, PostgreSQL + Drizzle), following `docs/02-development-architecture.md` ("ARCH §n" below).

Throughout this spec:
- **Today** means the prototype's pinned date, **2026-09-03**. The prototype's comments call it "Wed Sep 3, 2026". It is actually a **Thursday** (see §15, B1).
- The special characters are: `·` U+00B7 (always written with a space on each side), `—` U+2014 em dash, `–` U+2013 en dash, `→` U+2192, and the curly quotes `“` U+201C and `”` U+201D.
- All 9 screens in this area are **read-only**. No screen in this area writes business data. The only state they change is client-side presentation state (§13).

---

## 1. Files covered

| File | Lines | Role |
|---|---|---|
| `app/src/pages/app/fleet/DriversTab.tsx` | 108 | Fleet › Drivers |
| `app/src/pages/app/fleet/TrucksTab.tsx` | 57 | Fleet › Trucks |
| `app/src/pages/app/fleet/TrailersTab.tsx` | 52 | Fleet › Trailers |
| `app/src/pages/app/hr/EmployeeContractsTab.tsx` | 53 | HR › Employee Contracts |
| `app/src/pages/app/hr/OnboardingTab.tsx` | 64 | HR › Onboarding |
| `app/src/pages/app/safety/MaintenanceTab.tsx` | 51 | Safety › Maintenance |
| `app/src/pages/app/safety/DriverDocumentsTab.tsx` | 50 | Safety › Driver Documents |
| `app/src/pages/app/safety/ViolationsTab.tsx` | 53 | Safety › Violations |
| `app/src/pages/app/safety/ClaimSettlementsTab.tsx` | 57 | Safety › Settlements (cargo/liability claims) |
| `app/src/data/fleet.ts` | 15 | `WATCHLIST` (= `COMPLIANCE` + 1 item) |
| `app/src/data/hr.ts` | 57 | `CONTRACTS`, `ONBOARDING` |
| `app/src/data/safety.ts` | 102 | `money()`, `MAINTENANCE`, `DRIVER_DOCUMENTS`, `VIOLATIONS`, `CLAIMS` |
| `app/src/data/mock.ts` | 332 | Used parts: `Driver`/`DRIVERS` (146–165), `Truck`/`TRUCKS` (167–185), `Trailer`/`TRAILERS` (187–204), `SECTION_TABS` (290–316), `COMPLIANCE` (318–322) |

Shared code these screens depend on. All of it was read in full. The port must reproduce the parts listed here.

| File | Lines | Used for |
|---|---|---|
| `app/src/App.tsx` | 81 | Routes, index redirects, legacy redirects, catch-all |
| `app/src/components/TabbedSection.tsx` | 13 | Section layout (tabs, then `<Outlet/>`) |
| `app/src/components/SectionTabs.tsx` | 29 | Pill tab bar |
| `app/src/components/Kpis.tsx` | 24 | KPI row |
| `app/src/components/Card.tsx` | 27 | Card shell |
| `app/src/components/Tag.tsx` | 12 | Status chip (`tagClass` mapped to a chip colour) |
| `app/src/context/AppShellContext.tsx` | 51 | `query`, `driverTab` |
| `app/src/lib/search.ts` | 10 | `matchesQuery` |
| `app/src/components/Header.tsx` | 87 | Top bar: search, "Filters", and the per-tab action buttons |
| `app/src/components/AppLayout.tsx` | 20 | `.ui-shell` / `.ui-column` / `.ui-main` |
| `app/src/styles/shell.css` | 332 | All `ui-*` classes |
| `app/src/styles/app.css` (88), `industry.css` (285), `index.html` (17), `main.tsx` (19) | | Global base styles, fonts, CSS import order |

Other consumers of this area's data, which the API contracts must also serve:
- `DashboardPage.tsx:17-21,80-92` uses `DRIVERS` (name, status, hos) for the "Drivers" card.
- `NewLoadDialog.tsx:565-582` uses the `DRIVERS`, `TRUCKS` and `TRAILERS` pickers. The option labels are `${name} · ${status}`, `${unit} · ${status}` and `${unit} · ${kind}`. Choosing a driver auto-fills the truck with `driver.unit`.

---

## 2. Shared building blocks (identical on all 9 screens)

### 2.1 Routing

| URL | Renders |
|---|---|
| `/app/fleet` | redirect (replace) to `/app/fleet/drivers` |
| `/app/fleet/drivers` · `/trucks` · `/trailers` | DriversTab · TrucksTab · TrailersTab |
| `/app/hr` | redirect to `/app/hr/employee-contracts` |
| `/app/hr/employee-contracts` · `/onboarding` | EmployeeContractsTab · OnboardingTab |
| `/app/safety` | redirect to `/app/safety/maintenance` |
| `/app/safety/maintenance` · `/driver-documents` · `/violations` · `/settlements` | MaintenanceTab · DriverDocumentsTab · ViolationsTab · ClaimSettlementsTab |
| `/app/drivers` (legacy) | redirect to `/app/fleet/drivers`. This route sits outside the `/app` layout. |
| `/app/trucks` (legacy) | redirect to `/app/fleet/trucks` |
| any unknown path, e.g. `/app/fleet/foo` | `*` redirects (replace) to `/` (the landing page) |

React Router matches paths **case-insensitively**, so `/app/FLEET/Drivers` renders DriversTab with the correct active tab. See hazard H9.

### 2.2 DOM skeleton for every tab page

```
div.ui-shell                      (AppLayout)
  aside.ui-sidebar                (Sidebar: "Fleet" / "HR" / "Safety" nav item gets .is-active)
  div.ui-column
    header.ui-topbar              (Header, §2.7)
    main.ui-main                  flex column, gap 20px, padding 20px 24px 32px, overflow-y auto
      nav.ui-tabs                 (SectionTabs) ← first flex child; NO wrapper element
      div.ui-kpis                 (Kpis)        ← direct child of main
      section.ui-card …           (Cards)       ← direct children of main
      [div.ui-grid-2 …]           (Drivers only)
```

`TabbedSection` and every tab component return **fragments**, so the tab bar, KPI row and cards are all direct flex children of `main.ui-main` and are spaced by its `gap: 20px`. Adding any wrapper `<div>` changes the layout.

### 2.3 SectionTabs (`nav.ui-tabs`)

```html
<nav class="ui-tabs">
  <a class="ui-tab is-active" href="/app/fleet/drivers" aria-current="page">Drivers</a>
  <a class="ui-tab" href="/app/fleet/trucks">Trucks</a>
  …
</nav>
```

- The section is taken from `pathname.toLowerCase().split('/')[2]`. The tabs come from `SECTION_TABS[section]`.
- **Fleet:** `drivers` "Drivers", `trucks` "Trucks", `trailers` "Trailers".
- **HR:** `employee-contracts` "Employee Contracts", `onboarding` "Onboarding".
- **Safety:** `maintenance` "Maintenance", `driver-documents` "Driver Documents", `violations` "Violations", `settlements` "Settlements".
- Active state uses NavLink semantics: `isActive` when the location equals `/app/<section>/<key>` or is a descendant of it. Matching is case-insensitive. NavLink adds `aria-current="page"` to the active link.
- Clicking any tab, including the active one, runs `setQuery('')`, which clears the search box.

CSS:
- `.ui-tabs{align-self:center;max-width:100%;display:inline-flex;flex-wrap:wrap;justify-content:center;gap:4px;padding:6px;background:var(--ui-card);border-radius:999px}`
- `.ui-tab{padding:8px 18px;font-size:14px;font-weight:500;white-space:nowrap;color:var(--ui-primary);text-decoration:none;border-radius:999px}`
- `.ui-tab:hover{background:var(--ui-tab-hover);color:var(--ui-primary)}`
- `.ui-tab.is-active{background:var(--ui-primary-soft);color:var(--ui-primary-hover);font-weight:600}`

### 2.4 Kpis (`div.ui-kpis`)

```html
<div class="ui-kpis">
  <div class="ui-kpi">                       <!-- + " is-clickable" only if onClick; none in this area -->
    <div>
      <div class="ui-kpi-label">{label}</div>
      <div class="ui-kpi-note">{note}</div>   <!-- rendered only when note is truthy (always true here) -->
    </div>
    <div class="ui-kpi-value">{value}</div>
  </div> ×4
</div>
```

- React key is `label`. No KPI card in this area is clickable, so none has an `onClick`.
- CSS:
  - `.ui-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px}`
  - `.ui-kpi{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:8px 12px;min-height:96px;padding:20px 24px;background:var(--ui-card);border-radius:16px}`
  - `.ui-kpi-label{font-size:16px;font-weight:600}`
  - `.ui-kpi-note{margin-top:4px;font-size:12px;color:var(--ui-muted)}`
  - `.ui-kpi-value{margin-left:auto;font-size:clamp(30px,3.2vw,44px);font-weight:700;line-height:1;letter-spacing:-0.02em;font-variant-numeric:tabular-nums}`

### 2.5 Card

```html
<section class="ui-card ">                  <!-- note trailing space: `ui-card ${className}` with className='' -->
  <div class="ui-card-head">                <!-- only if title || action -->
    <div class="ui-card-title">{title}</div>
    <div style="flex:1"></div>
    {action}
  </div>
  <div class="ui-card-flush | ui-card-body">{children}</div>
</section>
```

CSS:
- `.ui-card{background:var(--ui-card);border-radius:16px;overflow:hidden}`
- `.ui-card-head{display:flex;align-items:center;gap:12px;padding:14px 24px;border-bottom:1px solid var(--ui-border)}`
- `.ui-card-title{font-size:15px;font-weight:600}`
- `.ui-card-body{padding:20px 24px}`
- `.ui-card-flush{overflow-x:auto}`
- `.ui-grid-2{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr));gap:20px;align-items:start}`

### 2.6 Tables, chips, empty state, bars, links

- `table.ui-table`: `width:100%;border-collapse:collapse;font-size:14px`.
- `th`: `padding:12px 16px;text-align:left;white-space:nowrap;font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--ui-text-2);background:var(--ui-thead)`. The DOM text is written in mixed case (for example "Make / year"). CSS uppercases it on screen.
- `td`: `padding:13px 16px;border-bottom:1px solid var(--ui-row);vertical-align:middle`.
- The first cell of a row gets `padding-left:24px`. The last cell gets `padding-right:24px`. The last body row has no bottom border.
- `th.num, td.num`: `text-align:right;font-variant-numeric:tabular-nums;font-family:inherit;letter-spacing:inherit`. `td.num` also gets `font-weight:inherit;white-space:nowrap`.
  - This resets the global `app.css` class `.num{font-family:"Barlow Condensed";font-weight:600;…}`. The port must keep the same CSS cascade order (H6).
- `td.strong`: `font-weight:600;white-space:nowrap`. `td.muted`: `color:var(--ui-muted)`.
- Rows in this area are **not** clickable and have no hover style.
- **Tag / chip.** `<span class="ui-chip ui-chip-{c}">{label}</span>`. `tagClass` maps to a chip class as follows (`Tag.tsx:3-8`):
  - `tag-accent` → `ui-chip-blue`
  - `tag-neutral` → `ui-chip-gray`
  - `tag-outline` → `ui-chip-amber`
  - `tag-green` → `ui-chip-green`
  - anything else → `ui-chip-gray`

  CSS:
  - `.ui-chip{display:inline-flex;align-items:center;padding:3px 10px;font-size:12px;font-weight:600;border-radius:999px;white-space:nowrap}`
  - blue: `var(--ui-primary-soft)` / `var(--ui-primary-hover)`
  - gray: `var(--ui-gray-soft)` / `var(--ui-text-2)`
  - amber: `var(--ui-amber-soft)` / `var(--ui-amber)`
  - green: `var(--ui-green-soft)` / `var(--ui-green)`
- **Empty state.** It is rendered **after** the `<table>`, inside the flush card body, and the table head stays visible:

  ```html
  <div class="ui-empty">Nothing matches “{query}”.</div>
  ```

  `{query}` is the **raw, untrimmed** query string. CSS: `.ui-empty{padding:40px;text-align:center;font-size:14px;color:var(--ui-muted)}`.
- **Bars.**
  - `.ui-bar-track{height:10px;background:var(--ui-track);border-radius:999px;overflow:hidden}`
  - `.ui-bar-fill{height:100%;background:var(--ui-primary);border-radius:999px}`
- **Link.**
  - `.ui-link{padding:0;font:inherit;font-size:13px;font-weight:600;color:var(--ui-primary);background:none;border:0;cursor:pointer;text-decoration:none}`
  - `:hover{color:var(--ui-primary-hover);text-decoration:underline}`
- **Filter pills (Drivers only).**
  - `.ui-filter{display:inline-flex;gap:2px;padding:3px;background:var(--ui-filter-bg);border-radius:999px}`
  - `.ui-filter-opt{padding:5px 12px;font:inherit;font-size:13px;font-weight:600;color:var(--ui-muted);background:transparent;border:0;border-radius:999px;cursor:pointer}`
  - `.ui-filter-opt.is-active{color:var(--ui-text);background:var(--ui-card);box-shadow:0 1px 2px var(--ui-shadow)}`
- The base font is set by `.ui-shell{font-family:"Inter",system-ui,sans-serif;font-size:14px}`. `line-height` comes from `industry.css` `body{line-height:1.55}`, so the port must keep that global rule.
- The light and dark tokens are in `shell.css:5-76`. Dark mode is `html[data-theme="dark"]`.

### 2.7 Header (top bar) on these routes (`Header.tsx`)

`header.ui-topbar` contains, in this order:
1. `input.ui-search`. Attributes: value `query`, placeholder `"Search"`, aria-label `"Search"`. Its onChange calls `setQuery(e.target.value)`.
2. `<div style="flex:1">`.
3. `button.ui-btn` "Filters". It is shown on every route in this area, because fleet, hr and safety are not in `NO_FILTERS`. It has **no handler**.
4. Action buttons, keyed by `section/tab`. All of them are **inert stubs** with no `onClick`. The `ui-btn-primary` class is noted where it applies:

| Route | Buttons (in order) |
|---|---|
| fleet/drivers | "+ Add Driver" (primary) |
| fleet/trucks | "Log service", then "+ Add Unit" (primary) |
| fleet/trailers | "+ Add Trailer" (primary) |
| hr/employee-contracts | "+ New Contract" (primary) |
| hr/onboarding | "+ Start Onboarding" (primary) |
| safety/maintenance | "+ Log Service" (primary). Note the capital S here, unlike Trucks' "Log service". |
| safety/driver-documents | "Request document" (primary) |
| safety/violations | "+ Log Violation" (primary) |
| safety/settlements | "+ New Claim" (primary) |

For parity these buttons must stay inert. When they are built later, each one is a write and needs a permission, Zod validation, an audit log entry and a domain event (§12.6).

### 2.8 Search (`lib/search.ts`)

```ts
matchesQuery(row, query):
  q = query.trim().toLowerCase(); if (!q) return true;
  return Object.entries(row).some(([k, v]) => k !== 'tagClass'
    && (typeof v === 'string' || typeof v === 'number')
    && String(v).toLowerCase().includes(q));
```

The search runs over **every own field of the raw mock object**, including fields that are not displayed. Numbers are matched in raw form (`4850`, not `$4,850`). Booleans are skipped. Each screen's exact searchable field set is listed in its "Search haystack" line. The port must search a view-model built from exactly those fields, formatted the same way (H11).

The search filters **only the main table** of each screen. KPIs, the miles chart and the watchlist ignore it.

---

## 3. Fleet › Drivers (`/app/fleet/drivers`, `DriversTab.tsx`)

### 3.1 Layout

```
Kpis (4)
Card title="Roster" flush action={filter}
  table.ui-table
    thead: Driver | Status | Unit | Current load | Hours left (num) | CDL (num) | Pay YTD (num)
    tbody rows (key = name):
      td.strong {name} | td <Tag status> | td {unit} | td.muted {load} | td.num {hos} | td.num {cdl} | td.num {pay}
  [div.ui-empty "Nothing matches “{query}”."]   if rows.length === 0
div.ui-grid-2
  Card title="Miles per driver, this week"  (NOT flush → .ui-card-body)
       action=<span style="font-size:13px;color:var(--ui-muted)">{totalMiles.toLocaleString()} mi total</span>
    div style="display:flex;flex-direction:column;gap:14px"
      per driver (ALL drivers, ignores filter & search; key=name):
        div style="display:flex;align-items:center;gap:14px"
          div style="width:132px;flex:none"  {name}
          div.ui-bar-track style="flex:1"
            div.ui-bar-fill style="width:{round(miles/maxMiles*100)}%;opacity:{miles===maxMiles?1:0.55}"
          div style="width:58px;flex:none;text-align:right;font-weight:600;font-variant-numeric:tabular-nums"
             {miles.toLocaleString()}
  Card title="Compliance watchlist" flush
       action=<a class="ui-link" href="/app/safety/driver-documents">All documents →</a>
    table.ui-table
      thead: Driver | Item | Due (num)
      tbody (key = name+item): td.strong {name} | td.muted {item} | td.num {due}
      (no empty state; not searched)
```

Filter control, placed in the Roster card head:

```html
<div class="ui-filter">
  <button type="button" class="ui-filter-opt is-active">All</button>
  <button type="button" class="ui-filter-opt">On duty</button>
  <button type="button" class="ui-filter-opt">Available</button>
</div>
```

The Status chip cell is **left**-aligned: it has no `num` class.

### 3.2 Row filter

`rows = DRIVERS.filter(d => (driverTab === 'All' || d.status === driverTab) && matchesQuery(d, query))`

- There is no "Home time" pill. Home-time drivers appear only under "All".
- Search haystack (Driver object): `name, status, unit, load, hos, cdl, pay` as display strings, plus **`miles` as a raw number**. For example, "2140" matches Marcus Hale although miles are not shown in the roster.

### 3.3 Data: `DRIVERS` (mock.ts:158-165), in rendered order

| name | status (chip) | unit | load (Current load) | hos | cdl | pay | miles |
|---|---|---|---|---|---|---|---|
| Marcus Hale | On duty (blue) | T-114 | L-40218 · Fresno → Reno | 6h 20m | 04/2028 | $61,400 | 2140 |
| Dara Whitfield | On duty (blue) | T-107 | L-40219 · Stockton → SLC | 9h 05m | 11/2027 | $58,900 | 1980 |
| Ellis Nakamura | On duty (blue) | T-121 | L-40220 · Sacramento → Boise | 1h 45m | 02/2027 | $55,120 | 1760 |
| Priya Raman | Available (gray) | T-103 | — | 11h 00m | 07/2026 | $52,480 | 1420 |
| Ana Cortez | Available (gray) | T-109 | L-40222 · Sep 5 | 11h 00m | 09/2029 | $48,300 | 1180 |
| Tobias Frey | Home time (gray) | T-118 | — | — | 01/2028 | $63,750 | 640 |

Row counts by pill: All = 6, On duty = 3, Available = 2.

`WATCHLIST` (`fleet.ts:12-15` = `COMPLIANCE` mock.ts:318-322 + 1), in rendered order:

| name | item | due |
|---|---|---|
| Priya Raman | CDL renewal | Jul 2026 |
| Ellis Nakamura | Medical card | Oct 12 |
| Ana Cortez | Annual MVR review | Sep 24 |
| Marcus Hale | Clearinghouse query | Sep 20 |

### 3.4 Derived values (the exact formulas, with results against the seed)

| Value | Formula (source line) | Result | Class |
|---|---|---|---|
| hoursLeft(hos) | `'6h 20m'` → `h + m/60`. NaN (`'—'`) → `Infinity` (L13-16). | 6.33, 9.08, 1.75, 11, 11, ∞ | business (HOS) |
| onDuty | `status==='On duty'` (L18) | 3 | business |
| available | `status==='Available'` (L19) | 2 | business |
| atRisk | onDuty with `hoursLeft < 2` (L20) | [Ellis Nakamura] | **business / compliance rule (2 h threshold)** |
| maxMiles | `max(miles)` (L21) | 2140 | presentation (bar scale) |
| totalMiles | `Σ miles` (L22) | 9120 → "9,120 mi total" | business aggregate |
| KPI 1 | label "On the roster". value `DRIVERS.length`. note `${onDuty} on duty · ${len-onDuty-available} home time` | **6** / "3 on duty · 1 home time" | business |
| KPI 2 | label "Available now". value `available.length`. note is the **literal** "Both reset today". | **2** / "Both reset today" | count = business; note is static text |
| KPI 3 | label "Hours at risk". value `atRisk.length`. note is `atRisk.map(d => lastWord(name)+' · '+hos).join(', ')`, or "Nobody under 2h" if empty. | **1** / "Nakamura · 1h 45m" | business |
| KPI 4 | label "Docs to renew". value `WATCHLIST.length`. note is the literal "On the watchlist below". | **4** / "On the watchlist below" | business |
| bar width | `Math.round(miles/maxMiles*100)+'%'` | 100%, 93%, 82%, 66%, 55%, 30% | presentation |
| bar opacity | `miles===maxMiles ? 1 : 0.55` | 1 for Marcus, 0.55 for all others | presentation |
| miles label | `miles.toLocaleString()` (browser locale, H4) | 2,140 · 1,980 · 1,760 · 1,420 · 1,180 · 640 | presentation |

### 3.5 Interactions

| Trigger | Effect | State class |
|---|---|---|
| Click a filter pill | `setDriverTab(t)`. The roster re-filters. The pill gets `is-active`. | (b) presentation. It lives in AppShellContext and persists across in-app navigation, e.g. Drivers → Trucks → Drivers keeps "On duty". It resets to "All" on a full reload. It is not in the URL or localStorage. |
| Type in the top-bar search | `setQuery`. The roster filters live on each keystroke. | (b) |
| "All documents →" | Client navigation to `/app/safety/driver-documents`. It does **not** clear the query, so the documents table opens pre-filtered by the same text. | (b) |
| Keyboard | Only native behaviour: the buttons and the link are tabbable, and Enter/Space activate them. | n/a |

### 3.6 Proposed backend data contract

**`GET /api/v1/drivers`** (permission `drivers.view`; `payYtdCents` needs `settlements.view` or a new `drivers.pay.view`). Returns `data: DriverListItem[]` and `meta: { asOf: '2026-09-03', total: 6 }`. Default order is the seed order above (§12.4).

```ts
DriverListItem {
  id: uuid; fullName: string;
  dutyStatus: 'on_duty'|'available'|'home_time';           // label: 'On duty'|'Available'|'Home time'
  truck: { id: uuid; unitNumber: string } | null;          // 'T-114'
  currentLoad: { id: uuid; loadNumber: string; status: LoadStatus;
                 originShortName: string; destinationShortName: string;   // 'Stockton','SLC'
                 pickupDate: 'YYYY-MM-DD' } | null;
  hosRemainingMinutes: number | null;                       // 380 → '6h 20m'; null → '—'
  cdlExpiresOn: 'YYYY-MM-DD' | null;                        // month precision → '04/2028'
  payYtdCents: number;                                      // 6140000 → '$61,400'
  weekMiles: number;                                        // needed for search parity (hidden field)
}
```

Web formatting for the roster:
- `hos`: `${Math.floor(m/60)}h ${String(m%60).padStart(2,'0')}m`, or `—` when null.
- `cdl`: `MM/YYYY`.
- `pay`: `'$' + (cents/100).toLocaleString('en-US')`.
- `load`:
  - `null` → `—`.
  - When `currentLoad.status === 'Dispatched'` (not yet picked up) → `${loadNumber} · ${fmtMonDay(pickupDate)}`. Seed: "L-40222 · Sep 5".
  - Otherwise → `${loadNumber} · ${originShortName} → ${destinationShortName}`.
  - "Current load" means the driver's load whose status is in `ACTIVE_STATUSES` (In transit, At pickup, Dispatched, Delayed, Needs driver). That is why Priya (L-40214 is "Needs POD") and Tobias (L-40210 is "Delivered") show `—`.
  - `SLC` cannot be derived from "Salt Lake City", so locations need a `short_name` (B14).

**`GET /api/v1/drivers/summary`** returns:

```ts
{ rosterCount: 6, onDutyCount: 3, availableCount: 2, homeTimeCount: 1,
  hoursAtRisk: [{ driverId, fullName: 'Ellis Nakamura', hosRemainingMinutes: 105 }], // threshold < 120 min, server-side
  docsToRenewCount: 4 }
```

The web builds the notes from these fields. "Nakamura" is the last whitespace-separated token of `fullName`.

**`GET /api/v1/drivers/weekly-miles`** (the week containing asOf, Monday start: 2026-08-31 to 2026-09-06) returns `data: [{ driverId, fullName, miles }]` in roster order, and `meta: { weekStart, weekEnd, totalMiles: 9120, maxMiles: 2140 }`. These miles cannot be derived from `LOADS` (for example, Marcus's loads total 478 + 271 = 749, not 2,140). They need a source such as ELD/mileage entries or settlement lines. This is a decision to make (B15).

**`GET /api/v1/compliance/watchlist`** (`compliance.view`) returns `data: [{ driverId, driverName, item, dueOn, duePrecision }]` in the order shown above. The display format is "Jul 2026" (month precision) or "Oct 12" (day precision, current year). **This conflicts with the Driver Documents data (B6)**, and one of the options there must be chosen.

The pay YTD figures ($61,400 …) cannot be derived from any mock settlement data. The backend must compute them authoritatively (sum of posted settlement gross in the current year) and seed history to match (B15).

---

## 4. Fleet › Trucks (`/app/fleet/trucks`, `TrucksTab.tsx`)

### 4.1 Layout

```
Kpis (4)
Card title="Power units" flush
  thead: Unit | Make / year | Plate | Assigned to | Odometer (num) | Next service (num) | Status (num)
  row (key=unit): td.strong unit | td make | td.muted plate | td driver | td.num odo | td.num service | td.num <Tag status>
  [ui-empty]
```

The Status chip is **right**-aligned (`td.num`).

Search haystack: `unit, make, plate, driver, odo, service, status`. All are strings. `odo` and `service` are **comma-formatted** strings, so "318,440" matches and "318440" does not.

### 4.2 Data: `TRUCKS` (mock.ts:178-185)

| unit | make | plate | driver | odo | service | status (chip) |
|---|---|---|---|---|---|---|
| T-103 | Freightliner Cascadia · 2022 | CA 8HJ2019 | Priya Raman | 318,440 | 342,000 | In service (blue) |
| T-107 | Volvo VNL 760 · 2021 | CA 7RD8842 | Dara Whitfield | 402,190 | 425,000 | In service (blue) |
| T-109 | Kenworth T680 · 2023 | CA 9KM1174 | Ana Cortez | 141,220 | 165,000 | In service (blue) |
| T-114 | Peterbilt 579 · 2020 | CA 6PL4408 | Marcus Hale | 528,900 | 529,800 | Service due (amber) |
| T-118 | Freightliner Cascadia · 2019 | CA 5TT9930 | Tobias Frey | 611,780 | — | In shop (amber) |
| T-121 | International LT · 2022 | CA 8WQ2251 | Ellis Nakamura | 275,610 | 298,000 | In service (blue) |

### 4.3 Derived values

`miles(s) = Number(s.replace(/,/g,''))` (L9).

| KPI | Formula | Result |
|---|---|---|
| "Power units" | value `TRUCKS.length`. note `Avg ${Math.round(avgOdo/1000)}K mi`, where `avgOdo = Σodo/len` (2,278,140/6 = 379,690). | **6** / "Avg 380K mi" |
| "In service" | value `count(status==='In service')`. note `Of ${TRUCKS.length} units` | **4** / "Of 6 units" |
| "In shop" | value `count('In shop')`. note is `${units.join(', ')} · turbo` (**literal " · turbo"**), or "Bays clear" if none. | **1** / "T-118 · turbo" |
| "Service due" | value `count('Service due')`. note is `units.map(t => `${unit} in ${(miles(service)-miles(odo)).toLocaleString()} mi`).join(', ')`, or "Nothing due" if none. | **1** / "T-114 in 900 mi" |

All four are business/fleet aggregates and belong in the backend. "Miles until service" (529,800 − 528,900 = 900) is a maintenance rule.

### 4.4 Interactions

Search only. No row clicks. The header buttons "Log service" and "+ Add Unit" are inert.

### 4.5 Backend contract

**`GET /api/v1/trucks`** (`trucks.view`) returns:

```ts
{ id, unitNumber, make, model, modelYear, plateState, plateNumber,
  assignedDriver: {id, fullName} | null, odometerMiles: number,
  nextServiceOdometerMiles: number | null, status: 'in_service'|'service_due'|'in_shop' }
```

Display rules:
- `make` column: `${make} ${model} · ${modelYear}`.
- plate: `${plateState} ${plateNumber}`.
- `odo` and `service`: `toLocaleString('en-US')`, with `—` when null.
- Unassigned driver: `—` (not in the seed).
- Status labels: In service / Service due / In shop.
- Default order: unit number ascending.

**`GET /api/v1/trucks/summary`** returns:

```ts
{ total: 6, avgOdometerMiles: 379690, inServiceCount: 4,
  inShop: [{unitNumber:'T-118'}], serviceDue: [{unitNumber:'T-114', milesUntilService: 900}] }
```

The "turbo" reason is hardcoded in the prototype. It could come from the open in-shop work order (the work order says "Turbocharger replacement", so it does not string-match "turbo"). For parity, keep the literal suffix, or add a `work_orders.short_label` column (B9).

---

## 5. Fleet › Trailers (`/app/fleet/trailers`, `TrailersTab.tsx`)

### 5.1 Layout

```
Kpis (4)
Card title="Trailers" flush
  thead: Unit | Type | Status | Location          (no num columns)
  row (key=unit): td.strong unit | td kind | td <Tag status> (left) | td where
  [ui-empty]
```

Search haystack: `unit, kind, status, where`.

### 5.2 Data: `TRAILERS` (mock.ts:195-204), in rendered order

| unit | kind | status (chip) | where |
|---|---|---|---|
| RF-27 | Reefer · 53 ft | Loaded (blue) | Bakersfield, CA |
| RF-09 | Reefer · 53 ft | Empty (gray) | Yard · Modesto |
| RF-88 | Reefer · 53 ft | Loaded (blue) | En route · I-80 |
| DV-51 | Dry van · 53 ft | Loaded (blue) | Stockton, CA |
| DV-88 | Dry van · 53 ft | Empty (gray) | Yard · Modesto |
| DV-14 | Dry van · 53 ft | Empty (gray) | Las Vegas, NV |
| FB-04 | Flatbed · 48 ft | Loaded (blue) | Redding, CA |
| FB-12 | Flatbed · 48 ft | Inspection (amber) | Yard · Modesto |

### 5.3 Derived values

| KPI | Formula | Result |
|---|---|---|
| "Trailers" | value is the count. note `${kind startsWith 'Reefer'} reefer · ${'Dry van'} dry van · ${'Flatbed'} flatbed` | **8** / "3 reefer · 3 dry van · 2 flatbed" |
| "Loaded" | value `count('Loaded')`. note `${rolling} rolling · ${loaded−rolling} at shippers`, where `rolling` = loaded with `where.startsWith('En route')`. | **4** / "1 rolling · 3 at shippers" |
| "Empty" | value `count('Empty')`. note `${atYard} at the Modesto yard`, where `atYard` = empty with `where.startsWith('Yard')`. "Modesto" is a literal. | **3** / "2 at the Modesto yard" |
| "Inspection" | value `count('Inspection')`. note is `${units.join(', ')} · annual DOT` (literal suffix), or "None pending" if none. | **1** / "FB-12 · annual DOT" |

### 5.4 Backend contract

**`GET /api/v1/trailers`** (`trailers.view`) returns:

```ts
{ id, unitNumber, trailerType: 'reefer'|'dry_van'|'flatbed', lengthFt: 53|48,
  status: 'loaded'|'empty'|'inspection', locationKind: 'yard'|'en_route'|'site', locationLabel: string }
```

Display rules:
- `kind`: `${'Reefer'|'Dry van'|'Flatbed'} · ${lengthFt} ft`.
- `where`: stored as the label exactly as shown ("Yard · Modesto", "En route · I-80").
- Default order: seed order, which is **not** unit order (§12.4).

**`/trailers/summary`** returns:

```ts
{ total: 8, byType: {reefer:3, dry_van:3, flatbed:2}, loadedCount: 4, rollingCount: 1,
  emptyCount: 3, emptyAtYardCount: 2, inspection: [{unitNumber:'FB-12'}] }
```

For parity, store trailer status and location, and do **not** derive them from loads yet (B11).

---

## 6. HR › Employee Contracts (`/app/hr/employee-contracts`, `EmployeeContractsTab.tsx`)

### 6.1 Layout

```
Kpis (4)
Card title="Employee contracts" flush
  thead: Employee | Role | Type | Start | Renews | Pay basis | Status (num)
  row (key=employee): td.strong employee | td role | td type | td start | td renews | td.muted payBasis | td.num <Tag status>
  [ui-empty]
```

Search haystack: `employee, role, type, start, renews, payBasis, status`.

### 6.2 Data: `CONTRACTS` (hr.ts:21-32)

| employee | role | type | start | renews | payBasis | status (chip) |
|---|---|---|---|---|---|---|
| Marcus Hale | Company driver | W-2 | Mar 14, 2022 | Mar 14, 2027 | $0.62 / mi | Active (green) |
| Dara Whitfield | Company driver | W-2 | Aug 2, 2021 | Aug 2, 2027 | $0.60 / mi | Active (green) |
| Ellis Nakamura | Company driver | W-2 | Oct 1, 2023 | Oct 1 | 25% of line haul | Renewal due (amber) |
| Priya Raman | Company driver | W-2 | Sep 20, 2024 | Sep 20 | $0.58 / mi | Renewal due (amber) |
| Ana Cortez | Company driver | W-2 | Jan 12 | Jan 12, 2027 | $0.58 / mi | Active (green) |
| Tobias Frey | Owner-operator | Lease-purchase | Nov 15, 2023 | Nov 15 | $1.18 / mi | Expiring (amber) |
| Rosa Medina | Dispatcher | W-2 | Jun 6, 2020 | Jun 6, 2027 | $68,000 / yr | Active (green) |
| Luis Ortega | Mechanic | W-2 | Feb 9, 2023 | Feb 9, 2027 | $34.50 / hr | Active (green) |
| Evan Brooks | Dispatcher | W-2 | Jul 27 | Jul 27, 2027 | $52,000 / yr | Active (green) |
| Jamal Reed | Company driver | W-2 | Sep 8 | Sep 8, 2027 | $0.56 / mi | Draft (gray) |

Date display rule, which reproduces every cell: dates in the asOf year (2026) show as `Mon D`, and other years show as `Mon D, YYYY`. The underlying dates are:

| Employee | start | renews |
|---|---|---|
| Marcus | 2022-03-14 | 2027-03-14 |
| Dara | 2021-08-02 | 2027-08-02 |
| Ellis | 2023-10-01 | 2026-10-01 |
| Priya | 2024-09-20 | 2026-09-20 |
| Ana | 2026-01-12 | 2027-01-12 |
| Tobias | 2023-11-15 | 2026-11-15 |
| Rosa | 2020-06-06 | 2027-06-06 |
| Luis | 2023-02-09 | 2027-02-09 |
| Evan | 2026-07-27 | 2027-07-27 |
| Jamal | 2026-09-08 | 2027-09-08 |

Pay basis storage and display:

| `pay_basis_type` | Rate stored as | Display | Seed values |
|---|---|---|---|
| `per_mile` | `rate_cents` | `$${(c/100).toFixed(2)} / mi` | 62, 60, 58, 58, 118, 56 |
| `percent_line_haul` | `rate_bps` | `${bps/100}% of line haul` | 2500 |
| `annual_salary` | cents | `$${(c/100).toLocaleString('en-US')} / yr` | 6,800,000 and 5,200,000 |
| `hourly` | cents | `$${(c/100).toFixed(2)} / hr` | 3450 |

Pay basis is financial HR data and needs its own permission.

### 6.3 Derived values

| KPI | Formula | Result |
|---|---|---|
| "Active contracts" | value `count(status==='Active')`. note `${CONTRACTS.length} on file` | **6** / "10 on file" |
| "Renewals due (30 d)" | value `count('Renewal due')`. note is the **literal** "Raman Sep 20 · Nakamura Oct 1". | **2** |
| "Owner-operators" | value `count(role==='Owner-operator')`. note is the **literal** "Frey · lease-purchase ends Nov 15". | **1** |
| "Drafts" | value `count('Draft')`. note is the **literal** "Reed · starts Sep 8". | **1** |

For each literal note, the formula below reproduces it from the seed and should replace it:
- Renewals note: sort renewals by `renewsOn` ascending, map to `${lastName} ${fmtMonDay(renewsOn)}`, and join with " · ".
- Owner-operators note: `${lastName} · ${typeLabel.toLowerCase()} ends ${fmt(renewsOn)}`.
- Drafts note: `${lastName} · starts ${fmt(startOn)}`.

The status rules could be derived, which is a product decision (§49). Draft = unsigned. Expiring = fixed term with no renewal (Frey, Nov 15 is 73 days out). Renewal due = an auto-renewing contract with `renews_on` ≤ asOf + 30 d (Oct 3): Raman Sep 20 and Nakamura Oct 1 both qualify. Everything else is Active. Applied to the seed, these rules give exactly the stored statuses. With a live clock they would not (§12.5).

### 6.4 Backend contract

**`GET /api/v1/employee-contracts`** (`hr.contracts.view`) returns:

```ts
{ id, employee: {id, fullName}, role: 'company_driver'|'owner_operator'|'dispatcher'|'mechanic',
  contractType: 'w2'|'1099'|'lease_purchase', startOn, renewsOn, payBasisType, payRate,
  status: 'active'|'renewal_due'|'expiring'|'draft' }
```

Labels:
- role: Company driver / Owner-operator / Dispatcher / Mechanic
- type: W-2 / 1099 / Lease-purchase
- status: Active / Renewal due / Expiring / Draft

**`/employee-contracts/summary`** returns:

```ts
{ total: 10, activeCount: 6, renewalsDue: [{fullName, renewsOn}], ownerOperators: [{fullName, contractType, renewsOn}],
  drafts: [{fullName, startOn}] }
```

---

## 7. HR › Onboarding (`/app/hr/onboarding`, `OnboardingTab.tsx`)

### 7.1 Layout

```
Kpis (4)
Card title="Onboarding" flush
  thead: Candidate | Role | Stage | Started | Owner | Progress | Next step    (no num columns)
  row (key=candidate):
    td.strong candidate | td role | td <Tag stage> (left) | td started | td owner |
    td > div style="display:flex;align-items:center;gap:10px"
           div.ui-bar-track style="width:120px;flex:none" > div.ui-bar-fill style="width:{progress}%"
           span style="font-size:13px;color:var(--ui-muted);font-variant-numeric:tabular-nums" "{progress}%"
    td.muted nextStep
  [ui-empty]
```

Search haystack: `candidate, role, stage, started, owner, progress` (raw number: "85" matches), and `nextStep`. `docsPending` is a boolean and is not searched.

### 7.2 Data: `ONBOARDING` (hr.ts:50-57)

| candidate | role | stage (chip) | started | owner | progress | nextStep | docsPending |
|---|---|---|---|---|---|---|---|
| Jamal Reed | Company driver | Orientation (blue) | Aug 17 | Rosa Medina | 85 | Ride-along with Ana Cortez · Sep 5 | false |
| Sofia Nguyen | Company driver | Road test (blue) | Aug 24 | Luis Ortega | 60 | Road test in T-103 · Sep 4 | false |
| Derek Holt | Owner-operator | Background check (amber) | Aug 28 | Rosa Medina | 35 | Waiting on MVR consent and insurance certificate | true |
| Kevin Brandt | Company driver | Background check (amber) | Sep 1 | Rosa Medina | 30 | Waiting on medical card copy | true |
| Maya Patel | Company driver | Application (gray) | Sep 2 | Rosa Medina | 10 | Phone screen · Sep 4 | false |
| Evan Brooks | Dispatcher | Complete (green) | Jul 13 | Rosa Medina | 100 | 90-day review · Oct 25 | false |

The stage-to-chip mapping is consistent: Application gray, Background check amber, Road test blue, Orientation blue, Complete green.

### 7.3 Derived values

`THIS_WEEK` is the literal list `['Aug 31','Sep 1',…,'Sep 6']` (L9). It is the Monday-start week containing asOf.

| KPI | Formula | Result |
|---|---|---|
| "In progress" | value `count(stage!=='Complete')`. note `${count(stage==='Orientation')} in orientation` | **5** / "1 in orientation" |
| "Starting this week" | value `count(started ∈ THIS_WEEK)`, i.e. Kevin (Sep 1) and Maya (Sep 2). note is the literal "Opened since Mon Aug 31", derivable as `Opened since ${Dow} ${fmt(weekStart)}`. | **2** |
| "Awaiting documents" | value `count(docsPending)`. note is the literal "MVR consent · medical card". | **2** |
| "Completed this quarter" | value `count(stage==='Complete')`. **No date filter.** note is the literal "Since Jul 1", derivable from the quarter start. | **1** |

Progress bar width is `${progress}%`: 85, 60, 35, 30, 10, 100 (presentation). Progress itself is business data, stored or derived from checklist completion.

### 7.4 Backend contract

**`GET /api/v1/onboarding`** (`hr.onboarding.view`) returns:

```ts
{ id, candidateName, role, stage: 'application'|'background_check'|'road_test'|'orientation'|'complete',
  startedOn, owner: {id, fullName}, progressPct, nextStep, docsPending: boolean, completedOn: date|null }
```

Default order: seed order.

**`/onboarding/summary`** returns:

```ts
{ inProgressCount: 5, inOrientationCount: 1, startedThisWeekCount: 2, weekStart: '2026-08-31',
  awaitingDocsCount: 2, completedThisQuarterCount: 1, quarterStart: '2026-07-01' }
```

The seed must set Evan Brooks's `completedOn` to a date on or after 2026-07-01.

---

## 8. Safety › Maintenance (`/app/safety/maintenance`, `MaintenanceTab.tsx`)

### 8.1 Layout

```
Kpis (4)
Card title="Work orders" flush
  thead: Unit | Item | Due | Shop | Estimate (num) | Status (num)
  row (key=`${unit} ${item}`): td.strong unit | td item | td due | td.muted shop | td.num money(estimate) | td.num <Tag status>
  [ui-empty]
```

Search haystack: `unit, item, due, shop, estimate` (raw number: "4850" matches, "$4,850" does not), and `status`.

`money(n) = '$' + n.toLocaleString('en-US')` (`safety.ts:6-8`).

### 8.2 Data: `MAINTENANCE` (safety.ts:20-29)

| unit | item | due | shop | estimate | status (chip) |
|---|---|---|---|---|---|
| T-118 | Turbocharger replacement | Sep 5 | Sunridge shop · Modesto | $4,850 | In shop (amber) |
| FB-12 | DOT annual inspection | Sep 3 | Sunridge shop · Modesto | $150 | In shop (amber) |
| T-121 | Brake adjustment | Aug 28 | Sunridge shop · Modesto | $420 | Overdue (amber) |
| T-114 | PM service A | 529,800 mi | Sunridge shop · Modesto | $640 | Due (amber) |
| RF-27 | Reefer unit service | Sep 12 | Thermo King · Fresno | $710 | Scheduled (blue) |
| T-107 | DOT annual inspection | Sep 18 | Valley Truck Center · Stockton | $185 | Scheduled (blue) |
| T-103 | Tire rotation | 342,000 mi | Sunridge shop · Modesto | $160 | Scheduled (blue) |
| T-109 | DOT annual inspection | Aug 22 | Valley Truck Center · Stockton | $185 | Done (gray) |

`unit` refers to either a truck or a **trailer** (RF-27 and FB-12). `due` is either a date (`Mon D`) or an odometer reading (`${n.toLocaleString('en-US')} mi`).

### 8.3 Derived values

| KPI | Formula | Result |
|---|---|---|
| "Open work orders" | value `count(status!=='Done')`. note `${total−open} done · last 30 d`. **No date filter.** | **7** / "1 done · last 30 d" |
| "In shop" | value `count('In shop')`. note is the unique `shop` values of in-shop orders joined with ", ", or "None". | **2** / "Sunridge shop · Modesto" |
| "Overdue" | value `count('Overdue')`. note is `${unit} · ${item}` joined with ", ", or "None". | **1** / "T-121 · Brake adjustment" |
| "Est. cost open" | value `money(Σ estimate of open)` = 4850+150+420+640+710+185+160. note is the literal "Parts & labor, open orders". | **$7,115** |

"Est. cost open" is a **financial aggregate** and must be computed in the backend in integer cents.

### 8.4 Backend contract

**`GET /api/v1/maintenance/work-orders`** (`maintenance.view`) returns:

```ts
{ id, asset: {type:'truck'|'trailer', id, unitNumber}, item, dueOn: date|null, dueOdometerMiles: number|null,
  shop: {id, name /* 'Sunridge shop · Modesto' */}, estimateCents: number,
  status: 'scheduled'|'due'|'in_shop'|'overdue'|'done', completedOn: date|null }
```

Default order: seed order.

**`/maintenance/work-orders/summary`** returns:

```ts
{ openCount: 7, doneLast30dCount: 1, inShopCount: 2, inShopShops: ['Sunridge shop · Modesto'],
  overdue: [{unitNumber:'T-121', item:'Brake adjustment'}], openEstimateCents: 711500 }
```

Seed T-109's `completedOn` as 2026-08-22, which falls in the last 30 days.

"Overdue" could be derived as `dueOn < asOf` and not in shop/done. "Due" could be derived as odometer within threshold (T-114 is 900 mi away; T-103 is 23,560 mi away and is Scheduled). Either way the result depends on the frozen clock (§12.5).

---

## 9. Safety › Driver Documents (`/app/safety/driver-documents`, `DriverDocumentsTab.tsx`)

### 9.1 Layout

```
Kpis (4)
Card title="Driver qualification files" flush
  thead: Driver | Document | Expires | Status (num)
  row (key=`${driver} ${document}`): td.strong driver | td document | td expires | td.num <Tag status>
  [ui-empty]
```

Search haystack: `driver, document, expires, status`.

### 9.2 Data: `DRIVER_DOCUMENTS` (safety.ts:41-57), 15 rows in rendered order

| driver | document | expires | status (chip) | underlying date / precision |
|---|---|---|---|---|
| Marcus Hale | CDL | Apr 2028 | Valid (green) | 2028-04, month |
| Marcus Hale | Medical card | Mar 2027 | Valid (green) | 2027-03, month |
| Marcus Hale | Clearinghouse query | Sep 20 | Expiring (amber) | 2026-09-20, day |
| Dara Whitfield | CDL | Nov 2027 | Valid (green) | month |
| Dara Whitfield | Medical card | Jun 2027 | Valid (green) | month |
| Ellis Nakamura | CDL | Feb 2027 | Valid (green) | month |
| Ellis Nakamura | Medical card | Oct 12 | Expiring (amber) | 2026-10-12, day |
| Priya Raman | CDL | Jul 2026 | Expired (amber) | 2026-07, month |
| Priya Raman | Medical card | Jan 2028 | Valid (green) | month |
| Ana Cortez | CDL | Sep 2029 | Valid (green) | month |
| Ana Cortez | MVR | Sep 24 | Expiring (amber) | 2026-09-24, day |
| Ana Cortez | Annual review | Sep 24 | Expiring (amber) | 2026-09-24, day |
| Tobias Frey | CDL | Jan 2028 | Valid (green) | month |
| Tobias Frey | Medical card | Dec 2026 | Valid (green) | 2026-12, month |
| Tobias Frey | Drug test | — | Missing (amber) | null |

The expiry format is **not** derivable from the date alone. "Jul 2026" and "Dec 2026" are in the current year but are shown as month and year. Store `expires_precision: 'day'|'month'`:
- `month` → `Mon YYYY`
- `day` → `Mon D` (every seed row with day precision is in 2026)
- `null` → `—`

### 9.3 Derived values

| KPI | Formula | Result |
|---|---|---|
| "Documents" | value is the row count. note `${distinct drivers} drivers on file` | **15** / "6 drivers on file" |
| "Expiring (60 d)" | value `count('Expiring')`. note is the literal "Renew before Nov 2", derivable as `Renew before ${fmt(asOf + 60 d)}` = 2026-11-02. | **4** |
| "Expired" | value `count('Expired')`. note is `${driver} · ${document}` joined with ", ", or "None". | **1** / "Priya Raman · CDL" |
| "Missing" | value `count('Missing')`. note same format, or "None". | **1** / "Tobias Frey · Drug test" |

Document status can be derived deterministically, and applied to the seed at asOf 2026-09-03 it reproduces every stored status:
- `Missing` = no document on file.
- `Expired` = expiry (end of month for month precision) < asOf.
- `Expiring` = expiry < asOf + 60 d.
- `Valid` otherwise.

This is a compliance rule, so it belongs in the backend.

### 9.4 Backend contract

**`GET /api/v1/compliance/driver-documents`** (`compliance.view`) returns:

```ts
{ id, driver: {id, fullName}, documentType: 'cdl'|'medical_card'|'mvr'|'annual_review'|'drug_test'|'clearinghouse_query',
  expiresOn: date|null, expiresPrecision: 'day'|'month'|null, status: 'valid'|'expiring'|'expired'|'missing',
  documentId: uuid|null /* ARCH §21 documents table link */ }
```

Labels: CDL, Medical card, MVR, Annual review, Drug test, Clearinghouse query. Default order: roster order, then seed order within each driver.

**`/compliance/driver-documents/summary`** returns:

```ts
{ total: 15, driverCount: 6, expiringCount: 4, expiringWindowEnd: '2026-11-02',
  expired: [{fullName, documentType}], missing: [{fullName, documentType}] }
```

---

## 10. Safety › Violations (`/app/safety/violations`, `ViolationsTab.tsx`)

### 10.1 Layout

```
Kpis (4)
Card title="Roadside inspections & violations" flush
  thead: Date | Driver | Unit | Type | Points (num) | Location | Status (num)
  row (key=`${date} ${driver} ${type}`): td date (plain, NOT strong) | td.strong driver | td unit | td type |
       td.num severityPoints | td.muted location | td.num <Tag status>
  [ui-empty]
```

Search haystack: `date, driver, unit, type, severityPoints` (raw number), `location, status`.

### 10.2 Data: `VIOLATIONS` (safety.ts:71-79), newest first

| date | driver | unit | type | points | location | status (chip) |
|---|---|---|---|---|---|---|
| Aug 31 | Tobias Frey | T-118 | Log form & manner | 1 | I-70 POE · Loma, CO | Open (amber) |
| Aug 28 | Ellis Nakamura | T-121 | Brake adjustment | 4 | I-5 scale · Cottonwood, CA | Open (amber) |
| Aug 19 | Marcus Hale | T-114 | Hours-of-service | 7 | US-95 POE · Winnemucca, NV | Contested (blue) |
| Jul 30 | Dara Whitfield | T-107 | Lighting | 6 | I-80 scale · Donner Pass, CA | Closed (gray) |
| Jun 12 | Tobias Frey | T-118 | Speeding 6–10 over | 4 | I-70 · Grand Junction, CO | Closed (gray) |
| May 6 | Ellis Nakamura | T-121 | Log form & manner | 1 | I-84 POE · Ontario, OR | Closed (gray) |
| Mar 18 | Ana Cortez | T-109 | Lighting | 6 | I-5 scale · Ashland, OR | Closed (gray) |

"Speeding 6–10 over" uses an en dash. All dates are in 2026.

### 10.3 Derived values

| KPI | Formula | Result |
|---|---|---|
| "Open" | value `count('Open')`. note is the literal "Corrective action pending". | **2** |
| "Points (12 mo)" | value `Σ severityPoints` over **all** rows. There is no 12-month filter, and Contested and Closed rows are included. note `CSA severity · ${VIOLATIONS.length} violations` | **29** / "CSA severity · 7 violations" |
| "Contested" | value `count('Contested')`. note is the literal "DataQ challenge filed". | **1** |
| "Closed" | value `count('Closed')`. note is the literal "Resolved, on file". | **4** |

The points sum is a safety (CSA) business calculation. The backend should compute it over `violation_date > asOf − 12 months`. At asOf this returns 29.

### 10.4 Backend contract

**`GET /api/v1/safety/violations`** (`safety.view`) returns:

```ts
{ id, violationDate, driver:{id,fullName}, truck:{id,unitNumber}, violationType: string, severityPoints: int,
  location: string, status: 'open'|'contested'|'closed' }
```

Order: `violationDate desc`.

**`/safety/violations/summary`** returns:

```ts
{ openCount: 2, points12mo: 29, violations12moCount: 7, contestedCount: 1, closedCount: 4 }
```

---

## 11. Safety › Settlements = claims (`/app/safety/settlements`, `ClaimSettlementsTab.tsx`)

### 11.1 Layout

```
Kpis (4)
Card title="Claims" flush
  thead: Claim | Date | Driver | Unit | Type | Claimant | Reserved (num) | Paid (num) | Status (num)
  row (key=id): td.strong id | td date | td driver | td unit | td type | td claimant |
       td.num money(reserved) | td.num (paid > 0 ? money(paid) : '—') | td.num <Tag status>
  [ui-empty]
```

Search haystack: `id, date, driver, unit, type, claimant, reserved` (raw), `paid` (raw, so "0" matches every unpaid claim), and `status`.

### 11.2 Data: `CLAIMS` (safety.ts:95-102), newest first

| id | date | driver | unit | type | claimant | reserved | paid | status (chip) |
|---|---|---|---|---|---|---|---|---|
| CLM-1112 | Aug 26 | Ellis Nakamura | T-121 / FB-12 | Cargo damage | Cascade Building Supply | $6,800 | — | Open (amber) |
| CLM-1111 | Aug 14 | Marcus Hale | T-114 / RF-88 | Cargo damage | Northgate Foods | $4,200 | — | Under review (blue) |
| CLM-1110 | Jul 22 | Dara Whitfield | T-107 / DV-51 | Property damage | Wasatch Crossdock | $2,900 | $2,650 | Settled (green) |
| CLM-1109 | Jun 30 | Tobias Frey | T-118 / DV-14 | Cargo shortage | Sierra Ag Partners | $1,450 | — | Denied (gray) |
| CLM-1108 | May 9 | Ana Cortez | T-109 / FB-04 | Bodily injury | Third party · R. Delgado | $25,000 | $18,500 | Settled (green) |
| CLM-1107 | Mar 3 | Priya Raman | T-103 / RF-27 | Cargo damage | Northgate Foods | $3,100 | $2,875 | Settled (green) |

### 11.3 Derived values (all financial except the counts)

| KPI | Formula | Result |
|---|---|---|
| "Open claims" | value `count(status ∈ {Open, Under review})`. note `${count('Under review')} under review` | **2** / "1 under review" |
| "Reserved" | value `money(Σ reserved of open)` = 6,800 + 4,200. note is the literal "On open claims". | **$11,000** |
| "Paid YTD" | value `money(Σ paid where paid > 0)`. **There is no year filter.** note `${count(paid>0)} settlements` | **$24,025** / "3 settlements" |
| "Settled" | value `count('Settled')`. note `${count('Denied')} denied` | **3** / "1 denied" |

"Reserved" and "Paid YTD" are **authoritative financial calculations** and belong in the backend, in integer cents. Paid YTD should filter on `paid_on` within the asOf year, so the seed needs `paid_on` dates in 2026.

### 11.4 Backend contract

**`GET /api/v1/claims`** (`claims.view`) returns:

```ts
{ id, claimNumber:'CLM-1112', claimDate, driver:{id,fullName}, truck:{id,unitNumber}, trailer:{id,unitNumber}|null,
  claimType:'cargo_damage'|'property_damage'|'bodily_injury'|'cargo_shortage', claimant: string,
  reservedCents, paidCents, paidOn: date|null, status:'open'|'under_review'|'settled'|'denied' }
```

Display rules:
- unit: `${truck} / ${trailer}`.
- Types: Cargo damage / Property damage / Bodily injury / Cargo shortage.
- Statuses: Open / Under review / Settled / Denied.
- Order: `claimDate desc`.

**`/claims/summary`** returns:

```ts
{ openCount: 2, underReviewCount: 1, openReservedCents: 1100000, paidYtdCents: 2402500, paidYtdCount: 3,
  settledCount: 3, deniedCount: 1 }
```

This must be a **`claims`** module, separate from the architecture's `settlements/` module (driver pay). See B12.

---

## 12. Consolidated backend requirements

### 12.1 Proposed tables

Every table has `id uuid pk`, `organization_id uuid not null` (indexed and always filtered from the session), `created_at` and `updated_at` as `timestamptz` in UTC. Business dates such as due dates, expiries and claim dates are **`date`** columns, not timestamps.

`docs/03-database.md` does not exist yet (ARCH §7 and §48), so these tables are proposals that need approval.

| Table | Key columns |
|---|---|
| `drivers` | full_name, duty_status, hos_remaining_minutes (nullable; later from ELD), employee_id |
| `trucks` | unit_number, make, model, model_year, plate_state, plate_number, assigned_driver_id, odometer_miles, next_service_odometer_miles, status |
| `trailers` | unit_number, trailer_type, length_ft, status, location_kind, location_label |
| `locations` (shared with loads) | … plus `short_name` (for "SLC") |
| `driver_documents` | driver_id, document_type, expires_on, expires_precision, status (or derived), document_id → `documents` |
| `compliance_watchlist_items` (only if option B6-a is chosen) | driver_id, item_label, due_on, due_precision, position |
| `employees` | full_name, user_id?, driver_id? |
| `employee_contracts` | employee_id, role, contract_type, start_on, renews_on, pay_basis_type, pay_rate, status |
| `onboarding_cases` | candidate_name, role, stage, started_on, owner_employee_id, progress_pct, next_step, docs_pending, completed_on |
| `maintenance_shops` | name |
| `work_orders` | asset_type, truck_id / trailer_id, item, due_on, due_odometer_miles, shop_id, estimate_cents, status, completed_on |
| `violations` | violation_date, driver_id, truck_id, violation_type, severity_points, location, status |
| `claims` | claim_number (unique per org), claim_date, driver_id, truck_id, trailer_id, claim_type, claimant, reserved_cents, paid_cents, paid_on, status |
| Weekly miles and pay YTD | Sources to be decided (B15): ELD mileage entries, and settlement history. |

### 12.2 Endpoints

All endpoints are `GET` under `/api/v1`, return `{data, meta}`, and use the error envelope `{error:{code,message,requestId}}`.

| Screen | Endpoints | Permission |
|---|---|---|
| Drivers | `/drivers`, `/drivers/summary`, `/drivers/weekly-miles`, `/compliance/watchlist` | drivers.view (+ pay perm), compliance.view |
| Trucks | `/trucks`, `/trucks/summary` | trucks.view |
| Trailers | `/trailers`, `/trailers/summary` | trailers.view |
| Contracts | `/employee-contracts`, `/employee-contracts/summary` | hr.contracts.view |
| Onboarding | `/onboarding`, `/onboarding/summary` | hr.onboarding.view |
| Maintenance | `/maintenance/work-orders`, `/maintenance/work-orders/summary` | maintenance.view |
| Driver docs | `/compliance/driver-documents`, `…/summary` | compliance.view |
| Violations | `/safety/violations`, `…/summary` | safety.view |
| Claims | `/claims`, `/claims/summary` | claims.view |

The pickers (NewLoadDialog) and the Dashboard also use `/drivers`, `/trucks` and `/trailers`.

Query parameters are validated with Zod: `limit`, `cursor`, and optionally `status` and `q`. For parity the web requests all rows, which is fine at 6–15 rows. ARCH §37 requires pagination, so the default page size must be at least the seed size. A server-side `q` must reproduce §2.8 semantics before the client-side search can be removed (H11).

Every summary returns `meta.asOf` (e.g. `'2026-09-03'`). The web uses it for "same year" formatting and for any date text, so the web never reads the browser clock.

### 12.3 Where each calculation lives

| Belongs in the backend (authoritative) | Can stay in the web (presentation) |
|---|---|
| Every KPI count and sum | Chip colour from status |
| Pay YTD | Bar width and opacity |
| Weekly miles and total miles | Progress bar width |
| HOS at-risk (< 120 min) | Number, money, date and HOS string formatting |
| Average odometer | Joining KPI notes from backend-provided lists |
| Miles-until-service | Last-name extraction |
| Document expiry status (60 d window) | Filter pills |
| Contract renewal window (30 d) | Client-side text search |
| Overdue work orders | |
| Open-estimate sum | |
| CSA points (12 mo) | |
| Claim reserve sum and paid YTD | |
| "Current load" selection | |
| "This week" and "this quarter" windows | |

### 12.4 Sort orders the API must return (reproduce the prototype's row order)

- **Drivers:** Marcus, Dara, Ellis, Priya, Ana, Tobias. This happens to equal `weekMiles desc`, but seed-order is safer.
- **Trucks:** unit ascending.
- **Trailers:** RF-27, RF-09, RF-88, DV-51, DV-88, DV-14, FB-04, FB-12. This is not sortable, so use seed order.
- **Contracts, onboarding, work orders:** seed order.
- **Driver documents:** roster order, then seed order.
- **Watchlist:** Priya, Ellis, Ana, Marcus. This is not by due date.
- **Violations and claims:** date descending.

"Seed order" means seeding `created_at` strictly increasing in prototype order and sorting by `created_at asc, id asc`. An alternative is an explicit `position` column.

### 12.5 Clock

Every window ("this week", "this quarter", YTD, 12 mo, 30 d, 60 d, overdue) depends on "today". The real date is already past 2026-09-03 (the environment date is 2026-09-29). If a live clock were used, the seed would render **different** KPIs and statuses. For example, Marcus's Clearinghouse query (Sep 20) would become Expired, and the Raman renewal would be overdue.

The API therefore needs an injectable clock (for example `CLOCK_FROZEN_DATE=2026-09-03` in dev and demo) and an organization timezone (America/Los_Angeles for Sunridge/Modesto). The alternative for parity is to store the statuses exactly as in the seed and not derive them.

### 12.6 Future writes (the stub buttons)

These are not needed for parity. Each would need a permission, Zod DTO, audit log and event:
- "+ Add Driver": DriverCreated
- "+ Add Unit": TruckCreated
- "Log service" / "+ Log Service": WorkOrderCreated
- "+ Add Trailer": TrailerCreated
- "+ New Contract": EmployeeContractCreated
- "+ Start Onboarding": OnboardingStarted
- "Request document": DriverDocumentRequested, which triggers a notification job (ARCH §22)
- "+ Log Violation": ViolationRecorded
- "+ New Claim": ClaimOpened

Status changes such as onboarding stages, work orders and claims need state machines (ARCH §18).

---

## 13. State classification

| State | Where it lives now | Class | Port target |
|---|---|---|---|
| All row data (drivers … claims, watchlist) | module constants | **(a) business** | PostgreSQL via the API |
| All KPI values | module-level constants computed at import | **(a) business-derived** | API `/summary` |
| `driverTab` ('All' / 'On duty' / 'Available', default 'All') | AppShellContext `useState` | (b) presentation | Client context in the `/app` layout. It survives soft navigation and resets on reload. Do not put it in localStorage or the URL. |
| `query` (search text) | AppShellContext | (b) | Same. It is cleared by section-tab and sidebar clicks only. |
| Active section tab | URL | (b) | URL (App Router segments) |
| Theme | localStorage `runtruck-theme` + `html[data-theme]` | (b) | Same (allowed per ARCH §5) |

---

## 14. Porting hazards (Next.js App Router)

- **H1. react-router APIs.**
  - In this area: `Link` (`DriversTab.tsx:1,89`) becomes `next/link`.
  - Indirect:
    - `NavLink` + `useLocation` (`SectionTabs.tsx:1,9,18-25`) become `usePathname()` with a case-insensitive active check. **Add `aria-current="page"` manually**, because NavLink added it.
    - `Outlet` (`TabbedSection.tsx`, `AppLayout.tsx`) becomes `layout.tsx` `children`.
    - `Navigate` index redirects (`App.tsx:39,57,62`) become `redirect()` in `app/app/{fleet,hr,safety}/page.tsx`.
    - Legacy redirects (`App.tsx:72-73`) become `next.config` redirects with `permanent:false`.
    - The catch-all to `/` (`App.tsx:78`) becomes `not-found.tsx` redirecting to `/`, or middleware.
- **H2. Client components.**
  - `useAppShell()` throws outside its provider. Every tab needs `'use client'`, at least for the part that reads `query` and `driverTab`.
  - Recommended split: the server `page.tsx` fetches with the session cookie and passes rows and summary to a client table component. The first paint then already has the data. The prototype has **no loading or skeleton states**, and adding one changes the look.
  - Decide on an error UI; the prototype has none.
- **H3. Module-scope KPI constants.** All `const KPIS = [...]` are computed once at import. In the port they must be computed per request from API data. Never keep them at module scope.
- **H4. Locale-dependent formatting.**
  - These calls use the **browser default locale**: `totalMiles.toLocaleString()` (`DriversTab.tsx:75`), `d.miles.toLocaleString()` (`:83`) and `(…).toLocaleString()` (`TrucksTab.tsx:20`). A de-DE browser shows "9.120".
  - Under SSR these cause hydration mismatches. Use `'en-US'` explicitly everywhere, as `money()` already does. Use a fixed month-name array ("Sep", never "Sept", which `en-GB` Intl would produce).
- **H5. Date-only values.** Never do `new Date('2026-09-03')` and then format in local time, because it shifts to Sep 2 in US timezones. Keep `YYYY-MM-DD` strings and format them manually, or format in UTC.
- **H6. Global CSS.** `main.tsx` imports `industry.css`, `app.css`, `shell.css` and `calendar.css` in that order. Import them in the same order in the root `app/layout.tsx`. `.ui-table td.num` depends on overriding `app.css` `.num`. `body{line-height:1.55}` and `*{box-sizing:border-box}` come from `industry.css`.
- **H7. Fonts.**
  - `index.html` loads Google Fonts: Inter 400/500/600/700, Barlow 400/500/700, and Barlow Condensed 400/600, with `display=swap`.
  - `.ui-shell` uses the literal family name `"Inter"`. With `next/font` the generated family name differs. Either keep a `<link>` in the root layout `<head>`, or map `next/font`'s CSS variable into `.ui-shell`'s font-family.
- **H8. Theme bootstrap.** The inline `<script>` in `index.html:7` sets `data-theme="dark"` before paint. Reproduce it in the root layout `<head>` and put `suppressHydrationWarning` on `<html>`.
- **H9. Case-insensitive routes.** React Router renders `/app/Fleet/Drivers`, but Next.js returns 404 for it. Add middleware that lowercases the path, or accept and document the difference.
- **H10. No wrapper elements.** The section `layout.tsx` must render `<><SectionTabs/>{children}</>`, and pages must return fragments. `.ui-main`'s flex `gap:20px` and `nav.ui-tabs{align-self:center}` depend on these being direct children. Do not add `template.tsx`, which adds a remount but no DOM; it is still unnecessary.
- **H11. Search semantics.**
  - Search runs over each raw mock object's string and number fields. If the new DTOs are searched naively, UUIDs, enum values (`on_duty`) and cents (`485000`) will match, and hidden-but-searched fields (Driver.miles, Onboarding.progress) will be lost.
  - Build an explicit per-entity search view-model with exactly the fields and formats listed in §3.2–§11.1. Examples: status labels, not enums; raw dollars as integers, e.g. estimate `4850`; trucks `odo` comma-formatted; driver `pay` as "$61,400".
- **H12. Unicode.** Keep the literal characters `“ ” · — – →` in UTF-8 source.
- **H13. `Array.prototype.at`** (`DriversTab.tsx:27`) is fine in Node 18+ and modern browsers.
- **H14. Keys.** The prototype keys rows by name or by composite strings. Use UUIDs. Duplicate names would currently collide.
- **H15. No `window`, `document`, `localStorage` or `<dialog>`** in the area files themselves. The only ones are theme-related, in `main.tsx`, `index.html` and `lib/theme.ts`.
- **H16. Document title** stays "RunTruck" on every page. Per-page `metadata.title` would differ.

---

## 15. Bugs, inconsistencies and architecture conflicts

- **B1.** "Today" is labelled Wednesday, but **2026-09-03 is a Thursday**. See `hr.ts:2` ("today" is Wed Sep 3, 2026), `safety.ts:3`, `OnboardingTab.tsx:8` ("(Wed Sep 3)") and `accounting.ts:2`. The on-screen "Mon Aug 31" is correct (2026-08-31 is a Monday). A backend clock pinned at 2026-09-03 will say Thursday. Decide the pinned date and label deliberately.
- **B2.** Stale comment at `hr.ts:48`: "Jamal Reed is the '1 in orientation' on the Drivers tab". The Drivers tab shows no such text. It is the Onboarding KPI note.
- **B3.** KPI labels promise time windows that the code does not apply:
  - "Completed this quarter" (`OnboardingTab.tsx:14`) counts all Complete rows.
  - "Paid YTD" (`ClaimSettlementsTab.tsx:12`) sums every paid claim.
  - "Points (12 mo)" (`ViolationsTab.tsx:11`) sums everything.
  - "… done · last 30 d" (`MaintenanceTab.tsx:13`) counts all Done rows.
  - "Renewals due (30 d)" and "Expiring (60 d)" rely on the stored status.

  They match only because the seed fits. The backend must apply the real windows (§12.5).
- **B4.** Hardcoded notes that embed data and will go stale:
  - "Both reset today" (`DriversTab.tsx:26`), which also assumes exactly 2 drivers
  - " · turbo" (`TrucksTab.tsx:19`), which is applied to every in-shop unit
  - "at the Modesto yard" and " · annual DOT" (`TrailersTab.tsx:18-19`)
  - "Raman Sep 20 · Nakamura Oct 1", "Frey · lease-purchase ends Nov 15" and "Reed · starts Sep 8" (`EmployeeContractsTab.tsx:15-17`)
  - "Opened since Mon Aug 31", "MVR consent · medical card" and "Since Jul 1" (`OnboardingTab.tsx:19-21`)
  - "Renew before Nov 2" (`DriverDocumentsTab.tsx:15`)

  The derivable formulas are given in the relevant sections.
- **B5.** Latent NaN bug in `TrucksTab.tsx:9,20`: `miles('—')` is NaN. If T-118 (service "—") were ever "Service due", the note would read "T-118 in NaN mi".
- **B6.** **The watchlist disagrees with Driver Documents.**
  - `WATCHLIST` (`fleet.ts:12-15`, `mock.ts:318-322`) has 4 items. It merges Ana's MVR and Annual review into one "Annual MVR review". It omits Tobias Frey's missing drug test. It labels Priya's already-expired CDL as "CDL renewal" due "Jul 2026", presenting it as upcoming.
  - Driver Documents says 5 documents are Expiring or Expired, plus 1 Missing. So "Docs to renew = 4" conflicts with Safety.
  - Options:
    - (a) For parity, persist watchlist items (`compliance_watchlist_items`).
    - (b) Derive the list from `driver_documents` where status is expiring or expired. That gives 5 rows with different labels, so the value becomes 5 and **it is not pixel-identical**.
  - Per ARCH §49 this needs a product decision.
- **B7.** Compliance conflicts with dispatch. Priya Raman's CDL expired in 07/2026 (`mock.ts:162`, `safety.ts:49`), yet she is "Available" and selectable in NewLoadDialog's driver picker (`NewLoadDialog.tsx:570`). This violates ARCH §19 ("Relevant compliance constraints") and Rule 5. Tobias Frey has a Missing drug test. When dispatch is ported, the backend must block these assignments.
- **B8.** T-121 has an **Overdue** brake adjustment (`safety.ts:23`) and an Open brake violation (`safety.ts:73`). It is still "In service" (`mock.ts:184`) and running L-40220. The truck status does not reflect maintenance.
- **B9.** T-118's "turbo" and FB-12's "annual DOT" reasons are hardcoded rather than joined from `MAINTENANCE` (`safety.ts:21-22`).
- **B10.** "Loaded … at shippers" (`TrailersTab.tsx:17`) assumes every non-rolling loaded trailer is at a shipper. RF-27 is at Bakersfield although L-40214 was delivered to Phoenix.
- **B11.** Trailer and load contradictions in the seed:
  - FB-12 is in "Inspection" at "Yard · Modesto" (`mock.ts:203`) while L-40220 (`mock.ts:101`, status Delayed, en route to Boise) uses T-121 / FB-12.
  - DV-14 is in Las Vegas (`mock.ts:201`), but L-40210 took DV-14 to Denver.
  - DV-88 is in the Modesto yard (`mock.ts:200`), but L-40212 took DV-88 to Las Vegas.
  - FB-04 is "Loaded" in Redding (`mock.ts:202`) although L-40222's pickup is Sep 5.

  For parity these fields must be stored, not derived from loads.
- **B12.** Naming collision. The Safety tab key `settlements` (`mock.ts:314`, `App.tsx:66`, `Header.tsx:51`) holds cargo and liability **claims**. ARCH §6 and §47 define `settlements/` as driver pay, and legacy `/app/settlements` redirects to accounting payroll (`App.tsx:76`). Keep the URL `/app/safety/settlements` for parity, but name the backend module, table and permissions `claims`.
- **B13.** `money()` is duplicated: `safety.ts:6-8` and a separate `money` in `data/accounting.ts` (used by NewLoadDialog and Dashboard). Consolidate them into one presentation formatter, for example in `packages/ui`. Authoritative sums go in the backend or in `packages/calculations`.
- **B14.** The "Current load" strings are denormalised and cannot be fully derived:
  - The "SLC" abbreviation (`mock.ts:160`) needs a location short name.
  - Ana's row shows the pickup date instead of the route (`mock.ts:163`).
  - Driver `unit`, `cdl` and `miles` duplicate `TRUCKS.driver`, the CDL rows in `DRIVER_DOCUMENTS`, and `SETTLEMENTS.miles`. They are consistent today, but the port must store each fact once.
- **B15.** Some figures are not reproducible from any mock source.
  - Pay YTD ($61,400 …) and weekly miles are free-standing.
  - Tobias's 640 miles has no `SETTLEMENTS` row (`mock.ts:273-279`).
  - Decide the source tables (settlement history, ELD mileage) and seed them so the aggregates equal these values.
- **B16.** All cross-dataset joins in the prototype are by **name string**, for example `TRUCKS.driver` and `CLAIMS.driver`. They must become UUID foreign keys within the same `organization_id`.
- **B17.** Sensitive data has no authorization. The signed-in user "Rosa Medina · Dispatch" (`mock.ts:41-48`) sees drivers' Pay YTD and every employee's pay basis, including her own salary. ARCH §12–13 require permissions. For parity the seeded user needs all view permissions, but the permission model must exist.
- **B18.** `DriversTab.tsx:71` shows `Nothing matches “”.` when a filter pill yields no rows and the query is empty. This cannot happen with the seed, but it is a real bug if data changes. Keep it for parity or fix it knowingly.
- **B19.** The planner and HR disagree about Jamal Reed. Jamal is already at stage "Orientation" (85%, `hr.ts:51`), but the planner schedules "Orientation — Jamal Reed" for Sep 8 (`planner.ts:137`), his contract start date.
- **B20.** `hoursLeft()` parses display strings and `miles()` strips commas from them (`DriversTab.tsx:13-16`, `TrucksTab.tsx:9`). The port stores numbers (`hos_remaining_minutes`, `odometer_miles`) and formats them only in the web.

---

## 16. Parity checklist (expected render at asOf 2026-09-03)

| Screen | KPI 1 | KPI 2 | KPI 3 | KPI 4 | Rows |
|---|---|---|---|---|---|
| Drivers | On the roster **6** · "3 on duty · 1 home time" | Available now **2** · "Both reset today" | Hours at risk **1** · "Nakamura · 1h 45m" | Docs to renew **4** · "On the watchlist below" | 6 / 3 / 2 by pill; chart "9,120 mi total"; watchlist 4 |
| Trucks | Power units **6** · "Avg 380K mi" | In service **4** · "Of 6 units" | In shop **1** · "T-118 · turbo" | Service due **1** · "T-114 in 900 mi" | 6 |
| Trailers | Trailers **8** · "3 reefer · 3 dry van · 2 flatbed" | Loaded **4** · "1 rolling · 3 at shippers" | Empty **3** · "2 at the Modesto yard" | Inspection **1** · "FB-12 · annual DOT" | 8 |
| Contracts | Active contracts **6** · "10 on file" | Renewals due (30 d) **2** · "Raman Sep 20 · Nakamura Oct 1" | Owner-operators **1** · "Frey · lease-purchase ends Nov 15" | Drafts **1** · "Reed · starts Sep 8" | 10 |
| Onboarding | In progress **5** · "1 in orientation" | Starting this week **2** · "Opened since Mon Aug 31" | Awaiting documents **2** · "MVR consent · medical card" | Completed this quarter **1** · "Since Jul 1" | 6 |
| Maintenance | Open work orders **7** · "1 done · last 30 d" | In shop **2** · "Sunridge shop · Modesto" | Overdue **1** · "T-121 · Brake adjustment" | Est. cost open **$7,115** · "Parts & labor, open orders" | 8 |
| Driver docs | Documents **15** · "6 drivers on file" | Expiring (60 d) **4** · "Renew before Nov 2" | Expired **1** · "Priya Raman · CDL" | Missing **1** · "Tobias Frey · Drug test" | 15 |
| Violations | Open **2** · "Corrective action pending" | Points (12 mo) **29** · "CSA severity · 7 violations" | Contested **1** · "DataQ challenge filed" | Closed **4** · "Resolved, on file" | 7 |
| Claims | Open claims **2** · "1 under review" | Reserved **$11,000** · "On open claims" | Paid YTD **$24,025** · "3 settlements" | Settled **3** · "1 denied" | 6 |

Miles bars: Marcus 100% (opacity 1), Dara 93%, Ellis 82%, Priya 66%, Ana 55%, Tobias 30% (the rest at opacity 0.55). Labels: 2,140 / 1,980 / 1,760 / 1,420 / 1,180 / 640.
