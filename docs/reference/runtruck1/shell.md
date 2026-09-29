# Port spec — App Shell + Shared UI (Runtruck1 → Runtruck2)

Reference: `Runtruck1/app` (Vite 8 + React 19.2 + react-router-dom 7.18, mock data, "today" = 2026-09-03, a **Thursday** — the mock comments' "Wednesday" is wrong; see gaps.md).
Target: `Runtruck2` (pnpm + Turborepo, `apps/web` Next.js App Router, `apps/api` NestJS `/api/v1`, PostgreSQL + Drizzle), governed by `docs/02-development-architecture.md` (cited below as "ARCH §n").

All paths below are relative to `Runtruck1/app/` unless stated. "U+00B7" etc. name exact characters that must be reproduced.

---

## 1. Files covered

| File | Lines | Role |
|---|---|---|
| `index.html` | 17 | Document head: favicon, viewport, pre-paint theme script, Google Fonts, `<title>RunTruck</title>`, `#root` |
| `src/main.tsx` | 19 | Global CSS imports (order matters), `initTheme()`, `StrictMode` + `BrowserRouter` + `createRoot` |
| `src/App.tsx` | 81 | Full route table incl. index redirects, legacy redirects, catch-all |
| `src/components/AppLayout.tsx` | 20 | `/app` layout: provider + sidebar + column(topbar + main/outlet) |
| `src/components/Sidebar.tsx` | 55 | Brand, 9 nav links, user block, Settings button, Log out link, Settings dialog mount |
| `src/components/Header.tsx` | 87 | Top bar: search / back button, Filters, per-screen actions, New Load dialog mount |
| `src/components/SectionTabs.tsx` | 29 | Centred pill tab bar for tabbed sections |
| `src/components/TabbedSection.tsx` | 13 | Layout for tabbed sections: `<SectionTabs/>` + `<Outlet/>` (fragment) |
| `src/components/SettingsDialog.tsx` | 114 | Native `<dialog>` with Profile and Appearance pages |
| `src/components/Card.tsx` | 27 | White rounded panel with optional head |
| `src/components/Kpis.tsx` | 24 | KPI stat-card row |
| `src/components/Tag.tsx` | 12 | Status chip (maps legacy `tag-*` classes to `ui-chip-*`) |
| `src/components/Blueprint.tsx` | 23 | Marketing-only wireframe frame with 4 corner marks |
| `src/components/ComingSoon.tsx` | 28 | Placeholder screen (used by Facilities) |
| `src/context/AppShellContext.tsx` | 51 | Shared state for `/app`: search, loads filter, drivers filter, settlement approval, loads list + addLoad |
| `src/lib/theme.ts` | 31 | Light/dark: `data-theme` on `<html>` + `localStorage['runtruck-theme']` |
| `src/lib/search.ts` | 10 | `matchesQuery(row, query)` — the top-bar search predicate |
| `src/lib/persist.ts` | 24 | `usePersisted` — localStorage-backed `useState` (used only by Planner) |
| `src/styles/shell.css` | 332 | App (`/app/*`) design: tokens (light+dark) and every `ui-*` class |
| `src/styles/industry.css` | 285 | "Industry" design system (marketing) + GLOBAL resets that also hit the app |
| `public/favicon.svg` | 1 line, no trailing newline (9,522 B) | Vite default purple lightning-bolt logo (not a RunTruck mark) |
| `public/icons.svg` | 24 (5,055 B) | Vite template social-icon sprite; **unused** |
| `vite.config.ts` | 7 | `defineConfig({ plugins: [react()] })` only |
| `tsconfig.json` / `tsconfig.app.json` / `tsconfig.node.json` | 7 / 26 / 23 | Project refs; **no `strict`** |
| `.oxlintrc.json` | 8 | oxlint: react, typescript, oxc plugins |
| `vercel.json` | 8 | Vite SPA rewrite `/(.*)` → `/index.html` |
| `package.json` | 26 | deps: react/react-dom ^19.2.8, react-router-dom ^7.18.3 |

Read for context (other areas, not specified here): `src/styles/app.css` (88, global + marketing dark tokens — summarised in §5 because it is global), `src/styles/calendar.css` (165, Planner; touches `.ui-btn`/`.ui-dialog`/`.ui-setting` only under calendar-scoped selectors or new modifiers `is-form`, `is-stacked`), `src/data/mock.ts` (`NAV`, `USER`, `SECTION_TABS`, `LOADS`, `Load`, `ViewKey`), `src/data/accounting.ts` (`UNINVOICED`, `money`, `dollars`), `NewLoadDialog.tsx` props, `PayrollTab.tsx` (consumer of `approved`), `FacilitiesPage.tsx` (only `ComingSoon` consumer), `lib/dates.ts` (Planner-only).

---

## 2. Document boot (`index.html`, `main.tsx`)

### 2.1 `index.html` (exact)

```html
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <script>try{if(localStorage.getItem('runtruck-theme')==='dark')document.documentElement.dataset.theme='dark'}catch(e){}</script>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;700&family=Barlow+Condensed:wght@400;600&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <title>RunTruck</title>
</head>
<body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body>
```

- Title is **static "RunTruck" on every route** (no per-page titles anywhere). No meta description.
- Fonts: Barlow 400/500/700, Barlow Condensed 400/600, Inter 400/500/600/700, `display=swap`.
- The inline script only ever sets `dark` (pre-paint). `light` is set later by `initTheme()`.

### 2.2 `main.tsx`

1. Imports global CSS in this exact order: `industry.css` → `app.css` → `shell.css` → `calendar.css`. The cascade depends on this order (see §5.1).
2. `initTheme()` runs at module load, before first render: sets `document.documentElement.dataset.theme` to `'dark'` if `localStorage['runtruck-theme'] === 'dark'`, else `'light'` (storage errors → `'light'`). So after boot `<html>` **always** carries `data-theme="light"|"dark"`.
3. `createRoot(document.getElementById('root')!).render(<StrictMode><BrowserRouter><App/></BrowserRouter></StrictMode>)` — pure client render, no SSR.

---

## 3. Routes (`App.tsx`)

react-router v7 declarative `<Routes>`; **matching is case-insensitive** (RR default `caseSensitive=false`) — `/APP/Loads` renders LoadsPage and the shell lower-cases `pathname` before keying off sections.

| URL | Element | Notes |
|---|---|---|
| `/` | `LandingPage` (marketing) | outside the app shell |
| `/app` (index) | `<Navigate to="dashboard" replace />` | → `/app/dashboard` |
| `/app/dashboard` | `DashboardPage` | |
| `/app/loads` | `LoadsPage` | |
| `/app/loads/:id` | `LoadDetailPage` | unknown id falls back to `loads[0]` (LoadDetailPage.tsx:12), id match is case-sensitive |
| `/app/planner` | `PlannerPage` | |
| `/app/fleet` | `TabbedSection` layout; index → `<Navigate to="drivers" replace />` | |
| `/app/fleet/drivers` · `/trucks` · `/trailers` | `DriversTab` · `TrucksTab` · `TrailersTab` | |
| `/app/crm` | `CustomersPage` | |
| `/app/facilities` | `FacilitiesPage` (ComingSoon) | |
| `/app/accounting` | `TabbedSection`; index → `uninvoiced` | |
| `/app/accounting/uninvoiced` · `invoiced` · `batches` · `past-due` · `paid` · `payroll` · `bills` | `UninvoicedTab` · `InvoicedTab` · `BatchesTab` · `PastDueTab` · `PaidTab` · `PayrollTab` · `BillsTab` | |
| `/app/hr` | `TabbedSection`; index → `employee-contracts` | |
| `/app/hr/employee-contracts` · `onboarding` | `EmployeeContractsTab` · `OnboardingTab` | |
| `/app/safety` | `TabbedSection`; index → `maintenance` | |
| `/app/safety/maintenance` · `driver-documents` · `violations` · `settlements` | `MaintenanceTab` · `DriverDocumentsTab` · `ViolationsTab` · `ClaimSettlementsTab` | "settlements" here = insurance **claim** settlements |

Legacy redirects — declared **outside** the `/app` layout (App.tsx:72-77; catch-all App.tsx:78) so no shell renders; all `replace`:

| From | To |
|---|---|
| `/app/drivers` | `/app/fleet/drivers` |
| `/app/trucks` | `/app/fleet/trucks` |
| `/app/customers` | `/app/crm` |
| `/app/invoices` | `/app/accounting/invoiced` |
| `/app/settlements` | `/app/accounting/payroll` |
| `/app/accounting/settlements` | `/app/accounting/payroll` |

Catch-all `*` → `<Navigate to="/" replace />`. Consequences: `/foo`, `/app/foo`, `/app/fleet/foo`, `/app/loads/L-1/x`, `/app/dashboard/x` all land on the **marketing page** (no 404 page exists). `Navigate` targets are absolute strings, so query strings and hashes are dropped on redirect.

`<Navigate>` (declarative mode) fires in an effect, so for one frame the shell renders for the pre-redirect URL (e.g. `/app/fleet`: top bar keyed `fleet` = Search + Filters, no action buttons, tab bar visible, empty body). Cosmetic only.

### 3.1 Proposed Next.js App Router mapping (apps/web)

```
app/layout.tsx                    root: <html lang="en" suppressHydrationWarning>, head (theme script, fonts, favicon), global CSS in order, <body><div id="root">…</div></body>
app/page.tsx                      marketing "/"
app/[...rest]/page.tsx            redirect('/')   ← replicates RR "*" (Next matches full paths against a sorted list, so this also catches /app/foo, /app/fleet/foo)
app/app/layout.tsx                AppLayout (auth-guarded; client providers)
app/app/page.tsx                  redirect('/app/dashboard')
app/app/dashboard/page.tsx …      one page per leaf route above
app/app/loads/[id]/page.tsx
app/app/{fleet,accounting,hr,safety}/layout.tsx   TabbedSection = <><SectionTabs/>{children}</></>  (NO wrapper element — see §9)
app/app/{fleet,accounting,hr,safety}/page.tsx     redirect to first tab
next.config.ts redirects()        the 6 legacy redirects (permanent: false). Note Next passes query strings through by default; RR dropped them.
```

---

## 4. Components

### 4.1 `AppLayout` (the `/app` layout)

DOM (exact):
```html
<div class="ui-shell">
  <aside class="ui-sidebar">…</aside>          <!-- Sidebar -->
  <div class="ui-column">
    <header class="ui-topbar">…</header>       <!-- Header -->
    <main class="ui-main"><!-- route outlet --></main>
  </div>
</div>
```
Wrapped in `<AppShellProvider>` (no DOM). The whole shell is `100vh`, `overflow:hidden`; only `.ui-sidebar` and `.ui-main` scroll (window never scrolls). Because `<main>` persists across navigations, **its scrollTop is kept (clamped) when you change route** — nothing resets it.

### 4.2 `Sidebar`

```html
<aside class="ui-sidebar">
  <div class="ui-brand"><span class="ui-brand-mark"></span>RunTruck</div>
  <nav class="ui-nav">
    <a class="ui-nav-item is-active" href="/app/dashboard">Dashboard</a>
    <a class="ui-nav-item" href="/app/loads">Loads</a>
    … Planner, Fleet, CRM, Facilities, Accounting, HR, Safety
  </nav>
  <div class="ui-sidebar-foot">
    <div class="ui-user">
      <div class="ui-user-name">Rosa Medina</div>
      <div class="ui-user-meta">Dispatch · Sunridge Freight</div>
    </div>
    <button type="button" class="ui-nav-item">Settings</button>
    <a class="ui-nav-item" href="/">Log out</a>
  </div>
  <!-- <dialog class="ui-dialog"> when settingsOpen -->
</aside>
```

- Brand text node is "RunTruck"; CSS uppercases it → renders **RUNTRUCK**. All `.ui-nav-item` text is uppercased by CSS: DASHBOARD, LOADS, PLANNER, FLEET, CRM, FACILITIES, ACCOUNTING, HR, SAFETY, SETTINGS, LOG OUT.
- Nav source: `NAV` (mock.ts:28) — 9 `{key,label}` entries, in the order above. `NavEntry` also allows `{group}` headings rendered as `<div class="ui-nav-group">{group}</div>` (key `group-${i}`); **no group entries exist**, so this branch never renders — keep support.
- Link target: `/app/${key}` (so tabbed sections go to the section root and redirect to the **first** tab; the last-visited tab is not remembered).
- Active rule: `activeKey = pathname.toLowerCase().split('/')[2] || 'dashboard'`; item gets ` is-active` when `key === activeKey` (so `/app/loads/L-40218` highlights LOADS). Sidebar links are plain `Link` → **no `aria-current`** attribute.
- Every nav link `onClick` → `setQuery('')` (clears the top-bar search), then navigates (push; RR replaces instead of pushing when target equals current location).
- User meta is `{role} · {company}` with U+00B7 and single spaces.
- **Settings** button → `settingsOpen = true` → mounts `<SettingsDialog onClose={() => setSettingsOpen(false)} />` inside the `<aside>` (DOM-wise; it renders in the top layer).
- **Log out** is `<Link to="/">` — only navigates to the marketing page; no session handling (none exists). Leaving `/app` unmounts `AppLayout`, so all context state resets.

### 4.3 `Header` (top bar)

```html
<header class="ui-topbar">
  <input class="ui-search" value="{query}" placeholder="Search" aria-label="Search">   <!-- or, on load detail: -->
  <button class="ui-btn" type="button">← Loads</button>
  <div style="flex: 1;"></div>
  <button class="ui-btn" type="button">Filters</button>            <!-- when showFilters -->
  <button class="ui-btn[ ui-btn-primary]" type="button">{label}</button> …   <!-- head actions, keyed by label -->
  <!-- <dialog class="ui-dialog is-large"> NewLoadDialog when newLoadOpen -->
</header>
```

Keying logic (Header.tsx:24-54):
```
segments      = pathname.toLowerCase().split('/')
view          = segments[2] || 'dashboard'
tab           = SECTION_TABS[view] ? segments[3] : undefined
onLoadDetail  = view === 'loads' && Boolean(segments[3])
actionKey     = onLoadDetail ? 'loadDetail' : tab ? `${view}/${tab}` : view
showFilters   = !onLoadDetail && !['dashboard','planner','facilities'].includes(view)
```
Left control: on load detail a `ui-btn` "← Loads" (U+2190 + space) → `navigate('/app/loads')` (push, does **not** clear search); otherwise the search input (controlled by context `query`; every keystroke → `setQuery(e.target.value)`; no debounce, no submit).

**Filters** button: no `onClick` anywhere (stub).

Complete per-route matrix (order = DOM order after the spacer; P = `ui-btn ui-btn-primary`, S = `ui-btn`):

| Route | Left | Filters | Actions | Behaviour |
|---|---|---|---|---|
| `/app/dashboard` | Search | – | P "+ New Load" | opens NewLoadDialog |
| `/app/loads` | Search | ✓ | P "+ New Load" | opens NewLoadDialog |
| `/app/loads/:id` | S "← Loads" | – | S "Message driver", P "Update status" | both stubs (no onClick) |
| `/app/planner` | Search | – | (none) | |
| `/app/fleet/drivers` | Search | ✓ | P "+ Add Driver" | stub |
| `/app/fleet/trucks` | Search | ✓ | S "Log service", P "+ Add Unit" | stubs |
| `/app/fleet/trailers` | Search | ✓ | P "+ Add Trailer" | stub |
| `/app/crm` | Search | ✓ | P "+ Add Customer" | stub |
| `/app/facilities` | Search | – | (none) | |
| `/app/accounting/uninvoiced` | Search | ✓ | P "Invoice 11 loads" | `navigate('/app/accounting/invoiced')` only — **creates nothing** |
| `/app/accounting/invoiced` | Search | ✓ | S "Export batch", P "+ New Batch" | Export stub; New Batch → `navigate('/app/accounting/batches')` only |
| `/app/accounting/batches` | Search | ✓ | P "+ New Batch" | stub |
| `/app/accounting/past-due` | Search | ✓ | P "Send reminders" | stub |
| `/app/accounting/paid` | Search | ✓ | S "Export" | stub (only non-primary) |
| `/app/accounting/payroll` | Search | ✓ | P "Run settlements" | `approveAll()` → context `approved = true` |
| `/app/accounting/bills` | Search | ✓ | P "+ Add Bill" | stub |
| `/app/hr/employee-contracts` | Search | ✓ | P "+ New Contract" | stub |
| `/app/hr/onboarding` | Search | ✓ | P "+ Start Onboarding" | stub |
| `/app/safety/maintenance` | Search | ✓ | P "+ Log Service" | stub |
| `/app/safety/driver-documents` | Search | ✓ | P "Request document" | stub |
| `/app/safety/violations` | Search | ✓ | P "+ Log Violation" | stub |
| `/app/safety/settlements` | Search | ✓ | P "+ New Claim" | stub |
| transient `/app` | Search | – | P "+ New Load" | (pre-redirect frame, key `dashboard`) |
| transient `/app/fleet` etc. | Search | ✓ | (none) | (pre-redirect frame) |

Note capitalisation differences are real: "Log service" (fleet/trucks, secondary) vs "+ Log Service" (safety/maintenance). "+ " prefix is a literal plus and space.

`Invoice ${UNINVOICED.length} loads` → **"Invoice 11 loads"** (no pluralisation logic: 1 → "Invoice 1 loads").

NewLoadDialog mount: `<NewLoadDialog onClose={() => setNewLoadOpen(false)} onCreated={(id) => navigate(`/app/loads/${id}`)} />` — after create the app **pushes** `/app/loads/<new id>` (first new id against mock data = `L-40223`, see §6). Dialog internals are in the New Load spec.

### 4.4 `SectionTabs` / `TabbedSection`

`TabbedSection` returns a **fragment** `<><SectionTabs/><Outlet/></>` so `nav.ui-tabs` is a direct flex child of `.ui-main` (gap 20px, `align-self:center`).

```html
<nav class="ui-tabs">
  <a class="ui-tab is-active" href="/app/fleet/drivers" aria-current="page">Drivers</a>
  <a class="ui-tab" href="/app/fleet/trucks">Trucks</a>
  <a class="ui-tab" href="/app/fleet/trailers">Trailers</a>
</nav>
```
- `view` = lower-cased `segments[2]`; renders `null` if `SECTION_TABS[view]` is undefined.
- Tabs (`SECTION_TABS`, mock.ts:291), exact labels:
  - fleet: Drivers (`drivers`), Trucks (`trucks`), Trailers (`trailers`)
  - accounting: Uninvoiced, Invoiced, Batches, Past Due (`past-due`), Paid, Payroll, Bills
  - hr: Employee Contracts (`employee-contracts`), Onboarding (`onboarding`)
  - safety: Maintenance, Driver Documents (`driver-documents`), Violations, Settlements (`settlements`)
- `NavLink` (not `end`, case-insensitive) → active class ` is-active` **and** `aria-current="page"` on the active tab.
- Each tab `onClick` → `setQuery('')`.

### 4.5 `SettingsDialog`

Mounted only while open; on mount `useEffect` calls `el.showModal()` if `!el.open` (guard makes StrictMode double-effects safe). Local state: `page` ('Profile' default — resets every open), `theme` (lazy-initialised from `document.documentElement.dataset.theme`).

```html
<dialog class="ui-dialog" aria-label="Settings">
  <aside class="ui-dialog-nav">
    <div class="ui-dialog-title">Settings</div>
    <button type="button" class="ui-dialog-nav-item is-active">Profile</button>
    <button type="button" class="ui-dialog-nav-item">Appearance</button>
  </aside>
  <section class="ui-dialog-body">
    <button type="button" class="ui-dialog-close" aria-label="Close">×</button>   <!-- U+00D7 -->
    …page…
  </section>
</dialog>
```

Close paths (all funnel into the native `close` event → React `onClose` → parent unmounts): "×" button → `dialog.close()`; Escape (native cancel); **pointerdown** (not click) whose `target === dialog` (the backdrop; the two children fill the whole box so this only happens outside). Focus trap and focus return to the Settings button are native.

**Profile page**
```html
<h2 class="ui-h2" style="margin: 0px;">Profile</h2>
<div class="ui-profile">
  <div class="ui-avatar">RM</div>
  <div><div class="ui-profile-name">Rosa Medina</div><div class="ui-profile-meta">Dispatch · Sunridge Freight</div></div>
</div>
<dl class="ui-ids">
  <div><dt class="ui-label">Member ID</dt><dd>100482731</dd></div>
  <div><dt class="ui-label">Company ID</dt><dd>30017</dd></div>
  <div class="is-wide"><dt class="ui-label">Email</dt><dd>rosa.medina@sunridgefreight.com</dd></div>
</dl>
```
Initials = `name.split(' ').map(p => p[0]).join('')` → "RM" (no upper-casing; 3-word names → 3 letters). At default size the grid resolves to 2 columns (Member ID | Company ID) and Email spans the full row.

**Appearance page**
```html
<h2 class="ui-h2" style="margin: 0px;">Appearance</h2>
<div class="ui-setting">
  <div>
    <div id="dark-mode-label" class="ui-setting-name">Dark mode</div>
    <div class="ui-setting-help">Darkens the whole site, including the marketing page. Remembered on this device.</div>
  </div>
  <button type="button" role="switch" aria-checked="false" aria-labelledby="dark-mode-label" class="ui-switch"><span class="ui-switch-knob"></span></button>
</div>
```
Click switch → `next = theme==='dark' ? 'light' : 'dark'`; `applyTheme(next)` (sets `<html data-theme>`, writes `localStorage['runtruck-theme']`, swallowing storage errors) then local `setTheme(next)`; class gains ` is-on`, `aria-checked="true"`. Applies instantly, no save button.

### 4.6 `Card`

Props `{ title?, action?: ReactNode, flush=false, className='', style?, children }`.
```html
<section class="ui-card {className}" style="{style}">          <!-- note: trailing space when className is '' -->
  <div class="ui-card-head">                                   <!-- only if title || action -->
    <div class="ui-card-title">{title}</div>                   <!-- rendered even if title is undefined -->
    <div style="flex: 1;"></div>
    {action}
  </div>
  <div class="ui-card-flush | ui-card-body">{children}</div>    <!-- flush → edge-to-edge tables -->
</section>
```

### 4.7 `Kpis`

`Kpi = { label: string; value: string /* pre-formatted */; note?: string; onClick?: () => void }`.
```html
<div class="ui-kpis">
  <div class="ui-kpi[ is-clickable]">            <!-- onClick on the div; key = label -->
    <div><div class="ui-kpi-label">{label}</div><div class="ui-kpi-note">{note}</div></div>   <!-- note only if truthy -->
    <div class="ui-kpi-value">{value}</div>
  </div>
</div>
```
Clickable KPIs are `div`s with no role/tabIndex/keyboard handler (see §10).

### 4.8 `Tag`

`<span class="ui-chip {tone}">{label}</span>` where tone = `{ 'tag-accent':'ui-chip-blue', 'tag-neutral':'ui-chip-gray', 'tag-outline':'ui-chip-amber', 'tag-green':'ui-chip-green' }[tagClass] ?? 'ui-chip-gray'` (so `tag-accent-2`, `undefined`, unknown → gray).

Observed label → tagClass pairs in mock data (for building per-domain enum→tone maps; tone is **not** a pure function of the label):
- Loads: In transit→accent; At pickup, Dispatched, Delivered→neutral; Delayed, Needs driver, Needs POD→outline.
- Invoices: Draft→outline; Sent→accent; Paid→green; Overdue→outline. Settlements (SETTLE_TAG): Ready, Approved→accent; Paid→green; "Hold · fuel"→outline.
- Accounting extras: Due→outline, Scheduled→accent, Settled→green, Ready→accent; Uninvoiced POD: Attached→green, Missing→outline (via row tagClass).
- Drivers: On duty→accent; Available, Home time→neutral. Trucks: In service→accent; In shop, Service due, Inspection→outline. Trailers: Loaded→accent; Empty→neutral. Customers tier: Key account→accent; Growing→neutral; At risk→outline.
- HR contracts: Active→green; Renewal due, Expiring→outline; **Draft→neutral** (vs invoice Draft→outline). Onboarding stage tone depends on `docsPending`/progress (Orientation, Road test→accent; Background check→outline; Application→neutral; Complete→green).
- Safety: Valid→green; Expiring, Expired, Missing, Due, Overdue, Open, In shop→outline; Scheduled, Under review, Contested→accent; Closed, Denied, Done→neutral; Settled→green.
- Computed in pages: PaidTab `via==='Factoring' ? accent : neutral`; LoadDetail doc `state==='Attached' ? green : outline`; NewLoadDialog new load `covered ? neutral : outline`.

### 4.9 `Blueprint` (marketing only; used by `LandingPage`)

Props `{ as: ElementType = 'div', className='', style?, children, onClick? }` → `<{as} class="blueprint {className}" style onClick>{children}<i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i></{as}>` (trailing space in class when empty).

### 4.10 `ComingSoon` (+ `FacilitiesPage` content)

Returns a fragment (both are direct children of `.ui-main`):
```html
<section class="ui-card "><div class="ui-card-body">
  <div class="ui-label" style="color: var(--ui-primary);">Coming soon</div>
  <h2 class="ui-h2">{title}</h2>
  <p class="ui-p">{body}</p>
  <ul class="ui-bullets"><li>{item}</li>…</ul>          <!-- key = item text -->
</div></section>
<div class="ui-placeholder">{figure}</div>
```
Facilities values: title "Every yard, shop and dock in one register"; body "Where equipment is parked, where loads pick up and deliver, and what each site needs from the driver when they arrive."; items "Yards and terminals: what is parked where, and for how long" / "Shop bays with service scheduling and parts on order" / "Customer pickup and delivery sites with hours, dock notes and contacts" / "Fuel, scale and parking stops on frequent lanes"; figure "Yard map" (CSS-uppercased → YARD MAP). "Coming soon" renders COMING SOON.

### 4.11 `AppShellContext`

Provider lives in `AppLayout` → state survives navigation within `/app`, resets on reload or on leaving `/app` (Log out, marketing, legacy redirect entry mounts fresh).

| Member | Type / default | Written by | Read by |
|---|---|---|---|
| `query` / `setQuery` | `''` | Header input; cleared by Sidebar links, SectionTabs links, LoadsPage filter options | 17 table pages via `matchesQuery` (CRM, 3 Fleet, 7 Accounting, 2 HR, 4 Safety) plus Dashboard, Loads and Planner = 20 files |
| `loadTab` / `setLoadTab` | `'Active'` of `'Active' \| 'Needs POD' \| 'Delivered' \| 'All'` | LoadsPage | LoadsPage |
| `driverTab` / `setDriverTab` | `'All'` of `'All' \| 'On duty' \| 'Available'` | DriversTab | DriversTab |
| `approved` / `approveAll()` | `false`; one-way to `true` | Header "Run settlements", PayrollTab "Approve all" | PayrollTab |
| `loads` | `[...created, ...LOADS]` (new loads newest-first, then 8 mock loads in array order) | — | Dashboard, Loads, LoadDetail, Planner, EventDialog, NewLoadDialog (`nextId`) |
| `addLoad(l)` | prepends to `created` | NewLoadDialog | — |

`useAppShell()` throws `'useAppShell must be used within AppShellProvider'` outside the provider.

### 4.12 `lib/*`

- **theme.ts** — `type Theme = 'light'|'dark'`; key `'runtruck-theme'`; `getTheme()` reads the DOM attribute (not storage); `applyTheme(t)` sets attribute + storage (try/catch); `initTheme()` see §2.2.
- **search.ts** — `matchesQuery(row, query)`: `q = query.trim().toLowerCase()`; empty → `true`; else true if **any own enumerable field** except key `tagClass` whose value is a string or number has `String(v).toLowerCase().includes(q)`. Arrays/objects/booleans/undefined are skipped. The comment says "visible" fields but it searches **all** fields of the row object, including ones never shown (e.g. Load `ref`, `fromAddr`, `carrierMc`). Example: query "sunridge" on loads → 7 of 8 mock loads (all except L-40221 whose carrier is "Not yet covered"); "PO 88" → L-40218 and L-40214 via `ref`. Empty-state text used by pages: `Nothing matches “{query}”.` (U+201C/U+201D, raw untrimmed query).
- **persist.ts** — `usePersisted<T>(key, fallback, revive = raw => raw as T)`: lazy init reads `localStorage[key]`, `JSON.parse`, `revive(...) ?? fallback`, any error → fallback; an effect writes `JSON.stringify(value)` on mount and on every change (so defaults are written to storage on first visit). Only consumer: PlannerPage keys `runtruck-planner-prefs`, `runtruck-planner-events`, `runtruck-planner-categories`.

---

## 5. Styles

### 5.1 Global cascade that affects the app (order: industry → app → shell → calendar)

From `industry.css` (global): `*,*::before,*::after{box-sizing:border-box}`; `body{margin:0;font-size:15px;line-height:1.55;font-weight:400;background:var(--color-bg);color:var(--color-text);font-family:var(--font-body)}`; `h1–h6{font-family:var(--font-heading);font-weight:600;line-height:1.12;letter-spacing:-0.015em;margin:0 0 var(--space-2)}` with sizes h1 42, h2 32, h3 25, h4 20, h5 16, h6 13 (h6 uppercase .08em); `p{margin:0 0 var(--space-3)}`; `a{color:var(--color-accent);text-underline-offset:3px}`; `img{display:block;max-width:100%}`; `figure{margin:0}`; `:focus{outline:none}`; `:focus-visible{outline:2px solid var(--color-accent);outline-offset:2px}`; `::selection{background:color-mix(in srgb,var(--color-accent) 30%,transparent)}`.

From `app.css` (global): `html,body,#root{height:100%;margin:0;padding:0}`; `body{background:var(--color-bg)}`; `h1–h6{margin:0}` (overrides industry); `.num{font-family:"Barlow Condensed";font-weight:600;tabular-nums;letter-spacing:-0.01em}`; `.lbl`; `a{color:var(--color-accent-700)}`, `a:hover{color:var(--color-accent-900)}`; `::-webkit-scrollbar{width:10px;height:10px}`, thumb `var(--color-neutral-300)` (#d4d4d7 light / #2f3a4b dark); `html{scroll-behavior:smooth}`; `body{text-wrap:pretty}`; marketing dark tokens under `:root[data-theme="dark"]`.

Shell overrides: `.ui-shell` sets Inter 14px but **not** line-height → everything in the app inherits `line-height:1.55` from body (e.g. nav item = 12px×1.55 + 20px padding = 38.6px tall). `.ui-shell h1…h6{font-family:inherit;letter-spacing:-0.01em}`; `.ui-shell a{color:var(--ui-primary)}` (wins over app.css `a:hover` because shell.css loads later, equal specificity); `.ui-shell :focus-visible{outline-color:var(--ui-primary)}` (keeps industry's 2px solid + 2px offset).

### 5.2 `shell.css` tokens (`:root` = light; `:root[data-theme="dark"]` = dark, which also sets `color-scheme: dark`)

| Token | Light | Dark |
|---|---|---|
| `--ui-bg` | #edf0f5 | #0f141c |
| `--ui-card` | #ffffff | #171e2a |
| `--ui-border` | #e3e7ee | #273142 |
| `--ui-row` | #eceff5 | #222c3a |
| `--ui-thead` | #dde2eb | #1d2634 |
| `--ui-expand` | #f4f6fa | #1b2330 |
| `--ui-hover` | #f5f7fb | #1f2836 |
| `--ui-tab-hover` | #f0f4ff | #1c2740 |
| `--ui-row-hover` | #f7f9fc | #1c2431 |
| `--ui-filter-bg` | #f1f3f8 | #111823 |
| `--ui-track` | #e9edf3 | #273142 |
| `--ui-dash` | #c9d2e3 | #34405a |
| `--ui-text` | #111827 | #e6e9ef |
| `--ui-text-2` | #4b5563 | #b8c0cc |
| `--ui-muted` | #6b7280 | #8b95a6 |
| `--ui-primary` | #1e5eff | #5b8bff |
| `--ui-primary-hover` | #164bd6 | #7aa2ff |
| `--ui-primary-soft` | #dce6ff | #1f2f52 |
| `--ui-on-primary` | #ffffff | #0f141c |
| `--ui-amber` / `-soft` | #a05a00 / #fff1d6 | #f2b45c / #3a2b12 |
| `--ui-green` / `-soft` | #167a3b / #dff5e6 | #5ccb86 / #12301d |
| `--ui-gray-soft` | #eef0f4 | #273142 |
| `--ui-nav-pill` | #ffffff | #2b3648 |
| `--ui-red` / `-soft` | #b42318 / #fdecea | #ff8a80 / #3a1c1a |
| `--ui-purple` / `-soft` | #6d3fd1 / #efe8fd | #b79bff / #2a2145 |
| `--ui-teal` / `-soft` | #0f766e / #dcf5f1 | #5fd4c4 / #12302d |
| `--ui-shadow` | rgba(17,24,39,.1) | rgba(0,0,0,.5) |
| `--ui-overlay` | rgba(17,24,39,.45) | rgba(0,0,0,.6) |

No `prefers-color-scheme` handling: the default is always light.

### 5.3 `shell.css` class reference (all 93 `ui-*` classes plus modifiers `is-active`, `is-clickable`, `is-open`, `is-wide`, `is-invalid`, `is-on`, `is-large`, `is-3`, `num`, `strong`, `muted`, `pickup`, `delivery`; every class is used)

Layout: `.ui-shell` flex, 100vh, overflow hidden, bg `--ui-bg`, color `--ui-text`, Inter 14px · `.ui-column` flex:1, min-width 0, column, overflow hidden · `.ui-main` flex:1, overflow-y auto, padding 20px 24px 32px, column, gap 20px.

Sidebar: `.ui-sidebar` 232px, flex none, column, overflow-y auto, padding 22px 12px 16px, bg `--ui-thead`, color `--ui-text-2`; scrollbar thumb `--ui-dash` radius 999 · `.ui-brand` flex, center, gap 10, padding 0 12px 26px, 15px/700, .08em, uppercase, `--ui-text` · `.ui-brand-mark` 16×16, radius 4, bg `--ui-primary` · `.ui-nav` column gap 2 · `.ui-nav-group` padding 18px 12px 6px, 10px, .12em, uppercase, `--ui-text-2` · `.ui-sidebar .ui-nav-item` block, 100%, padding 10px 12px, left, no underline, `font:inherit` then 12px/700 .04em uppercase `--ui-text-2`, transparent, no border, radius 10, pointer; `:hover` bg `--ui-nav-pill` color `--ui-text`; `.is-active` bg `--ui-nav-pill` color `--ui-primary-hover` · `.ui-sidebar-foot` margin-top auto, padding-top 14, border-top 1px `--ui-dash`, column gap 2 · `.ui-user` padding 0 12px 10px · `.ui-user-name` 13/600 `--ui-text` · `.ui-user-meta` mt 2, 12px `--ui-text-2`.

Top bar: `.ui-topbar` flex, center, gap 12, flex none, padding 12px 24px, bg `--ui-card`, border-bottom 1px `--ui-border` (total 61px tall) · `.ui-search` 300px (max 100%), h36, padding 0 14, 14px `--ui-text`, bg `--ui-card`, 1px `--ui-border`, radius 10; placeholder `--ui-muted`; focus-visible outline 2px `--ui-primary` offset -1 · `.ui-btn` inline-flex, gap 6, h36, padding 0 18, 14px/600 `--ui-text-2`, nowrap, bg `--ui-card`, 1px `--ui-border`, radius 999, pointer; hover bg `--ui-hover` · `.ui-btn-primary` color `--ui-on-primary`, bg/border `--ui-primary`; hover `--ui-primary-hover` · `.ui-btn-sm` h30, padding 0 14, 13px · `label.ui-btn` relative; `:focus-within` outline 2px `--ui-primary` offset 2.

Tabs: `.ui-tabs` align-self center, max-width 100%, inline-flex wrap, center, gap 4, padding 6, bg `--ui-card`, radius 999 · `.ui-tab` padding 8px 18px, 14px/500, nowrap, `--ui-primary`, no underline, radius 999; hover bg `--ui-tab-hover`; `.is-active` bg `--ui-primary-soft`, color `--ui-primary-hover`, 600.

KPIs: `.ui-kpis` grid `repeat(auto-fit,minmax(180px,1fr))` gap 14 · `.ui-kpi` flex wrap, align flex-end, space-between, gap 8px 12px, min-h 96, padding 20px 24px, bg `--ui-card`, radius 16; `.is-clickable` pointer, hover `box-shadow:0 0 0 2px var(--ui-primary-soft)` · `.ui-kpi-label` 16/600 · `.ui-kpi-note` mt 4, 12px `--ui-muted` · `.ui-kpi-value` margin-left auto, `clamp(30px,3.2vw,44px)`/700, lh 1, -.02em, tabular-nums.

Cards/grids: `.ui-card` bg `--ui-card`, radius 16, overflow hidden · `.ui-card-head` flex center gap 12, padding 14px 24px, border-bottom `--ui-border` · `.ui-card-title` 15/600 · `.ui-card-body` padding 20px 24px · `.ui-card-flush` overflow-x auto · `.ui-grid-2` grid `repeat(auto-fit,minmax(min(100%,420px),1fr))` gap 20 align start · `.ui-grid-3` `minmax(min(100%,260px),1fr)` gap 14.

Tables: `.ui-table` 100%, collapse, 14px; `th` padding 12px 16px, left, nowrap, 12/700 .04em uppercase `--ui-text-2`, bg `--ui-thead`; `td` padding 13px 16px, border-bottom `--ui-row`, middle; first cell pl 24, last pr 24; last row no border; `th.num,td.num` right, tabular-nums, `font-family:inherit; letter-spacing:inherit` (neutralises app.css `.num`); `td.num` weight inherit, nowrap; `td.strong` 600 nowrap; `td.muted` `--ui-muted`; `tr.is-clickable` pointer, hover td bg `--ui-row-hover`; `tr.is-open td` bg `--ui-expand`, border transparent; `td.ui-expand-cell` padding 0.

Row detail (Loads): `.ui-expand` grid 4 cols (2 cols ≤1100px), gap 24px 32px, padding 16px 24px 28px, bg `--ui-expand` · `.ui-label` 11/600 .06em uppercase `--ui-muted` · `.ui-kv` column gap 10 mt 10 · `.ui-kv-value` mt 2, 13/600 · `.ui-stop` mt 10, pl 10, border-left 3px `--ui-primary`; `:has(> .pickup)` amber; `:has(> .delivery)` green · `.ui-stop-kind` 11/700 .04em uppercase; `.pickup` amber; `.delivery` green · `.ui-stop-name` mt 2, 13/700 · `.ui-stop-meta` mt 2, 12px muted.

Chips/filters: `.ui-chip` inline-flex, padding 3px 10px, 12/600, radius 999, nowrap · `.ui-chip-blue` `--ui-primary-soft`/`--ui-primary-hover` · `-gray` `--ui-gray-soft`/`--ui-text-2` · `-amber` `--ui-amber-soft`/`--ui-amber` · `-green` `--ui-green-soft`/`--ui-green` · `.ui-filter` inline-flex gap 2 padding 3 bg `--ui-filter-bg` radius 999 · `.ui-filter-opt` padding 5px 12px, 13/600 muted, transparent, radius 999; `.is-active` `--ui-text` on `--ui-card` + `0 1px 2px var(--ui-shadow)`.

Text/misc: `.ui-link` button-reset link 13/600 `--ui-primary`; hover `--ui-primary-hover` underline · `.ui-h2` margin 8px 0 0, 22/700, lh 1.2, -.01em · `.ui-p` mt 8, max 60ch, 14px lh 22px `--ui-text-2` · `.ui-bullets` mt 16, no list style; `li` padding 8px 0, border-top `--ui-border`, 14px · `.ui-placeholder` flex center, min-h 220, 12/600 .06em uppercase muted, bg `--ui-expand`, 2px dashed `--ui-dash`, radius 16 · `.ui-empty` padding 40, center, 14px muted · `.ui-total` flex end baseline gap 12, padding 14px 24px, border-top, 14px muted; `strong` 20px `--ui-text` tabular · `.ui-bar-track` h10 `--ui-track` radius 999 overflow hidden · `.ui-bar-fill` 100% h, `--ui-primary`, radius 999.

Dialogs: `.ui-dialog` width `min(720px, calc(100% - 48px))`, min-h 420, max-h 90vh, margin auto, padding 0, overflow hidden, `--ui-text` on `--ui-card`, no border, radius 16, `box-shadow:0 24px 64px var(--ui-shadow), 0 0 0 1px var(--ui-border)`; `[open]` display flex; `::backdrop` `var(--ui-overlay, rgba(17,24,39,.45))` (fallback because older engines don't inherit custom props into ::backdrop) · `.ui-dialog-nav` 200px, column gap 2, padding 20px 12px, bg `--ui-thead` · `.ui-dialog-title` padding 0 12px 14px, 15/700 · `.ui-dialog-nav-item` flex space-between gap 8, padding 9px 12px, 13/600 `--ui-text-2`, transparent, radius 10; hover/`.is-active` bg `--ui-nav-pill`, active color `--ui-primary-hover` · `.ui-dialog-body` relative, flex 1, column, gap 20, padding 28px 32px, overflow-y auto · `.ui-dialog-close` abs top/right 14, 32×32, 20px lh 1 muted, radius 999; hover `--ui-hover`/`--ui-text` · `.ui-profile` flex center gap 14 · `.ui-avatar` 48×48 circle, 16/700 `--ui-on-primary` on `--ui-primary` · `.ui-profile-name` 16/600 · `.ui-profile-meta` mt 2, 13px muted · `.ui-ids` grid `repeat(auto-fit,minmax(180px,1fr))` gap 16, pt 18, border-top; `dd` mt 4, 16/600, tabular, .02em, break-word; `.is-wide` full row · `.ui-setting` flex space-between center gap 20, padding 16px 0, border-top · `.ui-setting-name` 14/600 · `.ui-setting-help` mt 3, max 40ch, 13px muted · `.ui-switch` 44×26, padding 0, bg `--ui-gray-soft`, 1px `--ui-border`, radius 999 · `.ui-switch-knob` abs top/left 2, 20×20, `--ui-card`, radius 999, shadow `0 1px 2px var(--ui-shadow)`, `transition:left 120ms` · `.ui-switch.is-on` bg/border `--ui-primary`, knob left 20.

Large form dialog (New Load / Event, specified elsewhere): `.ui-dialog.is-large` (1080×820 max) · `.ui-dialog-main` · `.ui-dialog-foot` · `.ui-badge` (red count) · `.ui-nav-note` · `.ui-form-grid` (2 cols; `.is-3`; 1 col ≤760px) · `.ui-field` (`.is-wide`, `.is-invalid`) · `.ui-field-label` · `.ui-req` · `.ui-input` (h38, radius 10; textarea min-h 96) · `.ui-field-error` · `.ui-check` · `.ui-checks` · `.ui-panel` · `.ui-panel-head` · `.ui-note` · `.ui-errors` · `.ui-summary` · `.ui-file-row` · `.ui-file-input` (visually hidden). calendar.css adds `.ui-dialog.is-form` (640px) and `.ui-setting.is-stacked`.

### 5.4 `industry.css` (marketing design system)

Tokens (light; dark overrides live in app.css): `--color-bg #f2f2f3`→dark `#0f141c`; `--color-surface #e9e9ea`→`#171e2a`; `--color-text #1d1f20`→`#e6e9ef`; `--color-accent #5980a6`→`#7aa2ff`; `--color-accent-2 #728fab`→`#8fb0d8`; `--color-divider color-mix(#1d1f20 16%)`→`color-mix(#e6e9ef 16%)`; ramps `--color-neutral-100…900` (#f5f5f8, #e7e7ea, #d4d4d7, #b7b7ba, #98989b, #7a7a7d, #5d5d60, #424244, #2b2b2d; dark inverted #1a2130 … #e6e9ef), `--color-accent-100…900` (#eef6ff … #1d2d3d; dark #1c2740 … #eef6ff), `--color-accent-2-100…900` (#eef6ff … #1f2d3a; dark #1c2740 … #eef6ff); `--font-heading "Barlow Condensed"`, `--font-heading-weight 600`, `--font-body "Barlow"`; `--space-1..8` 3.4/6.8/10.2/13.6/20.4/27.2px; `--radius-sm/md/lg` 2/4/7px; `--shadow-sm/md/lg` (ink-tinted; dark rgba black).
Classes: `.blueprint` (relative, 1px divider border, radius 0) + `.corner.tl/.tr/.bl/.br` (11×11 "+" marks at -6px, 55% text colour); `.duotone`; `.hr`; `.btn`, `.btn-primary`, `.btn-secondary`, `.btn-ghost`, `.btn-icon`, `.btn-block`; `.field > label`, `.input`, `.radio`/`.dot`, `.seg`/`.seg-opt`; `.card`, `.card-kicker`, `.card-title`, `.card-body`, `.card-meta`, `.elev-sm/md/lg`; `.tag`, `.tag-accent`, `.tag-accent-2`, `.tag-neutral`, `.tag-outline`; `.nav`, `.nav-brand`; `.table`; `.dialog-backdrop`, `.dialog`, `.dialog-title`, `.dialog-body`, `.dialog-actions`; final block squares everything (`border-radius:0`, transparent cards/dialogs with divider borders). None of these classes are used inside `/app` (the `tag-*` names survive only as data values mapped by `Tag`).

---

## 6. Data contract (shell)

| Displayed value | Source (mock) | Format / where | Class |
|---|---|---|---|
| "Rosa Medina" | `USER.name` | Sidebar `.ui-user-name`; Profile `.ui-profile-name` | from session |
| "Dispatch" | `USER.role` | `{role} · {company}` (Sidebar meta, Profile meta) | role display name |
| "Sunridge Freight" | `USER.company` | as above | organization name |
| "rosa.medina@sunridgefreight.com" | `USER.email` | Profile Email | user |
| "100482731" | `USER.memberId` | Profile Member ID | user display number |
| "30017" | `USER.companyId` | Profile Company ID | org display number |
| "RM" | derived: first char of each space-separated name part | `.ui-avatar` | presentation |
| 9 nav entries | `NAV` | Sidebar | static UI config (keep in web app; optionally permission-filtered) |
| tab lists | `SECTION_TABS` | SectionTabs, Header keying | static UI config |
| **11** | `UNINVOICED.length` (accounting.ts:44-56) | "Invoice 11 loads" | **authoritative count → backend** (same set Dashboard shows as "11" / "$34,900 waiting"; sum = 2450+3180+2910+3540+2880+1980+4120+3620+2760+3050+4410 = 34,900) |
| theme | `localStorage['runtruck-theme']` → `html[data-theme]` | switch state | device-local presentation |
| `loads` | `[...created, ...LOADS]` | consumers elsewhere | **business data → `GET /api/v1/loads`** |
| next load id "L-40223" | `nextId(loads)` = `L-${max(numeric part)+1}`; max of mock ids = 40222 | NewLoadDialog | **authoritative → backend per-org sequence** |
| `approved` | context boolean | Payroll: Ready→Approved for Marcus Hale, Dara Whitfield, Priya Raman (3 rows; "Hold · fuel" and "Paid" untouched) | **business data → backend** |

Load list order the backend must reproduce: created loads newest-first, then mock seed in array order **L-40218, L-40219, L-40220, L-40221, L-40214, L-40212, L-40210, L-40222** (not sorted by id, pickup date or anything visible) — seed `created_at` descending in that order (or an explicit sort key) so `ORDER BY created_at DESC` matches.

Search contract: for every list endpoint that backs a searchable table, `?q=` must match case-insensitively (substring) against **every string/number field of that row's DTO except `tagClass`**, after trimming, to be result-identical to `matchesQuery`. Each area spec must enumerate its row fields; the query text itself stays client state.

Money formatting helper used by shell consumers: `money(n) = '$' + n.toLocaleString('en-US')` (whole dollars, e.g. `$34,900`); API should return integer cents (or integer dollars) and the web formats — sums must be computed server-side (ARCH §5 "Financial calculations that require authoritative results").

### 6.1 Endpoints the shell needs (proposal, `{data,meta}` envelopes)

| Need | Endpoint | Permission | Notes |
|---|---|---|---|
| Current user/org for sidebar + Profile | `GET /api/v1/me` → `{ user:{id(uuid), name, email, memberNumber:"100482731"}, organization:{id(uuid), name:"Sunridge Freight", companyNumber:"30017"}, role:{name:"Dispatch"}, permissions:[…] }` | authenticated | derive org from session (ARCH §4, §10). Numeric display numbers ≠ UUID ids (ARCH §8). |
| Log out | `POST /api/v1/auth/logout` then client navigates to `/` | authenticated | keep `<a class="ui-nav-item" href="/">Log out</a>` DOM; intercept click. |
| Header "Invoice N loads" | `GET /api/v1/accounting/uninvoiced-loads` → `meta.total` (share cache with Uninvoiced tab) or a summary endpoint `{ uninvoicedCount, uninvoicedAmountCents }` | `billing.view` | |
| "Run settlements" / "Approve all" | `POST /api/v1/settlements/approve` `{ payPeriodStart: "2026-09-01", scope: "ready" }` | `settlements.approve` | idempotent; audit log per settlement (Ready→Approved); emit `SettlementApproved`; state machine Ready→Approved only. ARCH §26 lists "Approve settlement" as sensitive. |
| New Load create (Header-mounted dialog) | `POST /api/v1/loads` | `loads.create` | returns load with server-assigned number (e.g. `L-40223`) → `router.push('/app/loads/<number or id>')`; audit + `LoadCreated` (ARCH §46). |
| Loads list (was context `loads`) | `GET /api/v1/loads` | `loads.view` | ordering above. |

Suggested permission gating for header actions (new; prototype shows everything): + New Load `loads.create`; + Add Driver `drivers.create`; + Add Unit / Log service `trucks.create`/`maintenance.create`; + Add Trailer `trailers.create`; + Add Customer `customers.create`; Invoice N loads `billing.create`; + New Batch / Export batch `billing.create`/`billing.view`; Send reminders `billing.create`; Export `billing.view`; Run settlements `settlements.approve`; + Add Bill, HR and Safety actions need permissions defined in the (not yet written) `07-roles-permissions.md`. A user with all permissions must see exactly the prototype.

---

## 7. Interactions and state classification

| Interaction | Effect | State | Class |
|---|---|---|---|
| Type in `.ui-search` | `setQuery(value)`; all list screens filter live | context `query` | (b) client presentation |
| Click sidebar nav link | `setQuery('')` + navigate `/app/<key>` | query | (b) |
| Click section tab | `setQuery('')` + navigate `/app/<section>/<tab>` | query | (b) |
| Header "← Loads" | navigate `/app/loads` (query kept) | — | (b) |
| Header "+ New Load" (dashboard, loads) | open NewLoadDialog (`newLoadOpen`) | Header local | (b) open-state; the created load is (a) |
| NewLoadDialog created | `addLoad` + push `/app/loads/:id` | context `created` | **(a) → POST /loads** |
| "Invoice 11 loads" | navigate to invoiced only | — | label implies (a); see §10 |
| "+ New Batch" on Invoiced | navigate to batches only | — | label implies (a) |
| "Run settlements" | `approveAll()` | context `approved` | **(a) → POST /settlements/approve** |
| All other header buttons + Filters | nothing | — | stubs |
| Sidebar "Settings" | open SettingsDialog | Sidebar local `settingsOpen` | (b) |
| Settings nav Profile/Appearance | switch page | dialog local `page` | (b) |
| Settings "×" / Esc / backdrop pointerdown | close dialog | — | (b) |
| Dark mode switch | toggle theme, persist to localStorage | `html[data-theme]`, `runtruck-theme` | (b) device preference ("Remembered on this device.") |
| Sidebar "Log out" | navigate `/` (context reset by unmount) | — | must become a real session logout |
| Clickable KPI (consumers) | `onClick` handler (navigation) | — | (b) |
| Loads filter / Drivers filter (consumers) | `setLoadTab`/`setDriverTab` persist across navigation in `/app` | context | (b) keep in `/app` layout client context |
| Planner prefs/events/categories via `usePersisted` | localStorage | — | prefs (b); **planner events and org color codes are (a)** → Planner spec |

---

## 8. Port design notes (Next.js)

- Client components (`'use client'`): `ShellUiProvider` (query, loadTab, driverTab only), `Sidebar`, `Header`, `SectionTabs`, `SettingsDialog`, `Kpis` (function props), `NewLoadDialog`. `Card`, `Tag`, `ComingSoon` can be server components; `Blueprint` only needs client when `onClick` is passed. Server components cannot pass `onClick` functions into `Kpis`; make KPI rows client components or give `Kpi` an `href` (rendering must remain a `div.ui-kpi.is-clickable` with the same look).
- Router mapping: `useLocation().pathname` → `usePathname()`; `useNavigate()` → `useRouter().push`; `Link` → `next/link` (same `href`s); `NavLink` → `Link` + computed `className` and `aria-current="page"` when `pathname.toLowerCase()` is/starts-with `/app/${view}/${tab}`; `Outlet` → layout `children`; `Navigate replace` → `redirect()` in page / `next.config` redirects; `useParams` → `next/navigation` `useParams`.
- Remove business state from context: `loads/addLoad/approved/approveAll` become API calls + cache invalidation (e.g. TanStack Query or `router.refresh()`), per ARCH §2 Rules 1/5.
- Auth: `/app/*` must be protected server-side (middleware/layout checks session → redirect). The prototype has **no login screen** (marketing "Log in" links straight to `/app/dashboard`); a login page is new UI with no reference design — conflict to resolve with the product owner.

---

## 9. Porting hazards (Next.js App Router)

1. **react-router APIs used**: `BrowserRouter`, `Routes`, `Route` (nested + index), `Navigate` (5 index redirects, 6 legacy, catch-all), `Outlet` (AppLayout, TabbedSection), `Link` (Sidebar ×10, Landing "Log in"), `NavLink` with function `className` (SectionTabs), `useLocation` (Sidebar, Header, SectionTabs), `useNavigate` (Header; pages), `useParams` (LoadDetailPage).
2. **Case-insensitive routes**: Next routes are case-sensitive; `/app/Loads` would hit the catch-all → `/`. To match, add middleware that rewrites the static segments to lower case (keep the `:id` segment as-is) — or document the deviation.
3. **Catch-all → "/"**: Next's default is a 404; add `app/[...rest]/page.tsx` → `redirect('/')` (or `not-found.tsx` redirect).
4. **Legacy redirects** outside the shell: use `next.config` `redirects()` (non-permanent). Next forwards query strings; RR dropped them.
5. **Theme without SSR flash**: `initTheme()` touches `document` at module scope — illegal in SSR. Put one inline script first in `<head>` of the root layout: `try{document.documentElement.dataset.theme=localStorage.getItem('runtruck-theme')==='dark'?'dark':'light'}catch(e){document.documentElement.dataset.theme='light'}` and add `suppressHydrationWarning` to `<html>` (the attribute differs from server HTML). `getTheme()` in SettingsDialog is safe (runs only after a click mounts it).
6. **`usePersisted` hydration mismatch**: its `useState` initializer runs on the server (the `localStorage` ReferenceError is swallowed → fallback) and again on the client during hydration (stored value) → mismatch. Read storage in `useEffect`, or render the Planner client-only.
7. **Native `<dialog>` + `showModal()`** only in `useEffect` (never render `open` from the server). Keep the `!el.open` guard (React StrictMode double effects; Next app router runs StrictMode in dev). React `onClose` on `<dialog>` works in React 19.
8. **Global CSS order**: import `industry.css`, `app.css`, `shell.css`, `calendar.css` once, in that order, in the root layout (importing them in different route layouts lets Next reorder chunks). `app.css` targets `#root` → wrap body content in `<div id="root">` (or rewrite the selector) so `height:100%` still applies to the marketing page.
9. **`html { scroll-behavior: smooth }`** (app.css): Next ≥15.4/16 warns / changes how it handles smooth scrolling during navigation; add `data-scroll-behavior="smooth"` on `<html>` if keeping the rule.
10. **Scroll on navigation**: in the prototype `.ui-main` keeps its scrollTop across route changes. Next's layout router calls `scrollIntoView` on the new segment's first node when it is off-screen — inside `.ui-main` that would scroll so the tab bar/first KPI row sits at the top (hiding the 20px top padding). Use `scroll={false}` on shell `Link`s / `router.push(url, { scroll: false })` to match the prototype.
11. **Fonts**: CSS names the literal families "Inter", "Barlow", "Barlow Condensed". `next/font` renames families and adds size-adjusted fallbacks (visible metric differences during swap). For identical output keep the same Google Fonts `<link>` (+ preconnects) in the root layout `<head>`, or use `next/font` with `variable` and change the CSS to the variables.
12. **Tabbed-section layouts must not add a wrapper element**: `.ui-tabs` relies on being a direct flex child of `.ui-main` (`align-self:center`, `gap:20px`). Return a fragment from `layout.tsx`.
13. **Head/meta**: `metadata = { title: 'RunTruck', icons: { icon: { url: '/favicon.svg', type: 'image/svg+xml' } } }` and no per-page titles. Delete the `app/favicon.ico` that create-next-app generates (it would override). Next emits the viewport meta (`width=device-width, initial-scale=1`) automatically.
14. **URL segment named `app`** lives at `apps/web/app/app/…` (or `src/app/app/…`) — legal but confusing; a route group isn't needed.
15. **Link same-URL behaviour**: RR replaces the history entry when a link targets the current URL; Next pushes. Minor.
16. **Navigate flash**: RR shows one pre-redirect frame for section roots; server `redirect()` doesn't. Improvement, not a regression.
17. **Config**: drop `vercel.json` (SPA rewrite `/(.*)`→`/index.html` breaks Next); drop `allowImportingTsExtensions` imports like `'./App.tsx'` (main.tsx:9); the prototype has **no `"strict": true`** — ARCH §39 needs strict, so ported code may need null checks (e.g. `getElementById('root')!` disappears anyway). oxlint → ARCH wants `packages/eslint-config`; rule `react/only-export-components` is a Vite fast-refresh rule, not needed in Next.
18. **Search input must be a controlled client input**; with SSR the initial value is `''` (same as prototype).

---

## 10. Bugs, inconsistencies, architecture conflicts

1. **Business data in React state** — `AppShellContext.tsx:16-19,29,40-41`: created loads live in memory ("a reload drops them"); `approved` (settlement approval) is a boolean in React state (`:28,39`). Violates ARCH §2 Rules 1 & 5, §30 (no audit), §23 (no events).
2. **Client-side ID generation** — `NewLoadDialog.tsx:196-198` `nextId` = max+1 over in-memory loads: race-prone, not tenant-scoped; must be a backend sequence.
3. **"Invoice 11 loads" doesn't invoice** — `Header.tsx:39` only navigates; count comes from a static constant, ignores created/delivered loads and search; no pluralisation (1 → "Invoice 1 loads").
4. **"+ New Batch" inconsistency** — on Invoiced it navigates to Batches (`Header.tsx:40`); on Batches the same label is a no-op (`:41`); neither creates a batch.
5. **"Run settlements" = approve-all without confirmation, undo, audit or scoping** — `Header.tsx:44`, `PayrollTab.tsx:12-16,37`. The flag is global, not per pay period/driver; label "Run settlements" vs link "Approve all" for the same action; still clickable after approval. ARCH §26 treats settlement approval as sensitive.
6. **No authentication** — `/app/*` is open; "Log out" (`Sidebar.tsx:47-49`) is a link to `/`; `USER` is hard-coded (`mock.ts:41-48`). Conflicts with ARCH §11-12.
7. **Numeric member/company IDs shown to users** — "100482731"/"30017" (`mock.ts:46-47`) look sequential; ARCH §8 → keep UUID PKs and add separate display numbers.
8. **Role name** — UI shows "Dispatch"; ARCH §13 example role is "Dispatcher". Needs a decision in the roles doc.
9. **Search semantics** — `search.ts:1-3` says "visible" fields but matches every string/number field (hidden `ref`, addresses, MC/DOT…); and it is client-side over full arrays, contrary to ARCH §37 (server-side search/pagination for large datasets).
10. **Stub controls** — Filters (shown on 18 screens, `Header.tsx:72-76`) and 18 action buttons have no handler (list in §4.3). Must stay visually identical; decide whether they stay inert.
11. **Accessibility** — clickable KPI `div`s (`Kpis.tsx:14`) are not focusable/keyboard operable; nav landmarks have no `aria-label`; `SectionTabs` sets `aria-current` but Sidebar does not.
12. **Tone inconsistencies** — "Draft" is amber for invoices (`mock.ts:254`) but gray for contracts (`hr.ts:31`); tone is stored per row (`tagClass`) rather than derived from status. The backend should serve status enums; the web maps enum→tone per domain (`tagClass` is presentation and must not be stored as business data).
13. **Naming collision "settlements"** — Safety tab `settlements` = claim settlements; legacy `/app/settlements` and `/app/accounting/settlements` redirect to driver **payroll** (`App.tsx:76-77`). Use distinct API resources (`/claims` vs `/settlements`).
14. **Unknown load id shows the first load** instead of not-found (`LoadDetailPage.tsx:12`); id match is case-sensitive while routing is not.
15. **Seed data integrity** — `UNINVOICED`/`INVOICES` reference loads L-40168…L-40209 that don't exist in `LOADS`; lanes/amounts duplicate LOADS rows under other ids. A relational seed needs those loads (or the invoice must store the load number as text).
16. **Leftover/branding** — `favicon.svg` is the Vite logo; `public/icons.svg` is unused Vite template content; README says Member/Company ID show in the sidebar foot (they only show in Settings › Profile).
17. **Minor** — `Card`/`Blueprint` emit trailing-space class strings (`"ui-card "`); `usePersisted` writes defaults to storage on first mount (`persist.ts:15-21`); `NAV` group branch is dead code; `ARCH §7` requires `docs/database.md`, which doesn't exist yet in Runtruck2 (only `02-development-architecture.md` is present), so shell tables (users, organizations, roles) have no approved schema to follow.

---

## 11. Config & assets summary

- `package.json`: scripts `dev: vite`, `build: tsc -b && vite build`, `lint: oxlint`, `preview`; deps react ^19.2.8, react-dom ^19.2.8, react-router-dom ^7.18.3; dev: @vitejs/plugin-react ^6.1.1, oxlint ^1.81.0, typescript ~6.0.2, vite ^8.3.0, @types/*.
- `vite.config.ts`: only the React plugin (no aliases, no base path, default port 5173).
- `tsconfig.app.json`: target/lib ES2023 + DOM, `moduleResolution: bundler`, `allowImportingTsExtensions`, `verbatimModuleSyntax`, `moduleDetection: force`, `noEmit`, `jsx: react-jsx`, `noUnusedLocals`, `noUnusedParameters`, `erasableSyntaxOnly`, `noFallthroughCasesInSwitch`, `types: ["vite/client"]` — **no `strict`**.
- `.oxlintrc.json`: plugins react/typescript/oxc; `react/rules-of-hooks: error`; `react/only-export-components: [warn, {allowConstantExport:true}]`.
- `vercel.json`: `framework: vite`, `buildCommand: npm run build`, `outputDirectory: dist`, rewrite `/(.*)` → `/index.html`.
- `public/`: `favicon.svg` (copy as-is to `apps/web/public/favicon.svg` for identical tab icon); `icons.svg` (unused; skip or copy).

---

## 12. Acceptance checklist (shell)

- [ ] Every URL in §3 renders/redirects as listed (incl. 6 legacy redirects, section-root redirects, catch-all to `/`).
- [ ] Sidebar DOM/text/active state per §4.2; nav + tab clicks clear search; search persists otherwise.
- [ ] Top bar matrix of §4.3 exact (labels, order, primary/secondary, Filters visibility).
- [ ] Settings dialog: Profile values from `GET /me`, Appearance switch toggles `html[data-theme]` + `localStorage['runtruck-theme']` with no flash on reload; closes via ×, Esc, backdrop.
- [ ] Global CSS copied verbatim, same import order; fonts identical; title "RunTruck"; favicon identical.
- [ ] `.ui-main` scroll position behaviour decided (§9.10).
- [ ] Settlement approval, load creation, uninvoiced count served/persisted by the API with auth, org scoping, permissions, Zod validation, audit logs and domain events.
