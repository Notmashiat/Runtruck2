# Port spec: New Load form (and how created loads render)

Reference: Runtruck1 `app/` (Vite + React 19 + react-router-dom v7, mock data, "today" pinned to 2026-09-03, which is a **Thursday**, not the Wednesday the mock comments claim).
Target: Runtruck2 (Next.js App Router web app + NestJS `/api/v1` + PostgreSQL/Drizzle), governed by `docs/02-development-architecture.md`.
All paths below are relative to `Runtruck1/app/`. Quoted UI strings are exact, and non-ASCII characters are named where they matter:
`→` U+2192, `—` U+2014 em dash, `–` U+2013 en dash, `·` U+00B7 middle dot, `°` U+00B0, `’` U+2019, `…` U+2026, `×` U+00D7.

---

## 1. Files covered

| File | Lines | Role for this area |
|---|---|---|
| `src/components/NewLoadDialog.tsx` | 763 | The whole New Load dialog: draft model, option lists, validation, 10 section pages, the `toLoad` mapper, `nextId`, and helpers (`Field`, `Choice`, `Head`, `Stat`) |
| `src/data/mock.ts` | 332 | `Load`/`LoadStop` interfaces, `LOADS` (8), `stopsOf`, `CARRIERS` (5), `DRIVERS` (6), `TRUCKS` (6), `TRAILERS` (8), `CUSTOMERS` (6), `USER`, `ACTIVE_STATUSES` |
| `src/pages/app/LoadDetailPage.tsx` | 124 | Load detail. It has one branch for created loads and one for mock loads |
| `src/context/AppShellContext.tsx` | 51 | `loads = [...created, ...LOADS]` and `addLoad` (in memory only) |
| `src/components/Header.tsx` | 87 | "+ New Load" button, mounts the dialog, navigates after create |
| `src/data/accounting.ts` | 127 | `money()` formatter (line 28–30) |
| `src/styles/shell.css` | 332 | Every `.ui-*` class used (dialog/form rules are at lines 244–332) |
| `src/styles/industry.css` | 285 | Global resets the dialog inherits (box-sizing, body line-height, h2/p margins, focus rings) |
| `src/styles/app.css` | 88 | Global `html, body, #root` sizing, `h1–h6 {margin:0}` |
| `src/components/Tag.tsx` / `Card.tsx` / `Kpis.tsx` | 12 / 27 / 24 | Used by LoadDetailPage |
| `src/components/AppLayout.tsx` | 20 | Puts Header (and therefore the dialog) inside `.ui-shell` |
| `src/pages/app/LoadsPage.tsx` | 171 | Where created loads show up (list, KPIs, expanded row using `stopsOf`) |
| `src/pages/app/DashboardPage.tsx` | 97 | Active-loads KPI and table include created loads |
| `src/data/planner.ts` | 180 | `loadEvents()` turns created-load stops into calendar events (lines 146–180) |
| `src/lib/dates.ts` / `src/lib/search.ts` | 58 / 10 | `shortToIso` (planner) and `matchesQuery` (search over created loads) |
| `src/components/EventDialog.tsx` | 132 | Its "Related load" select lists created loads (line 108) |
| `index.html` / `src/main.tsx` / `src/App.tsx` | 17 / 19 / 81 | Fonts, CSS import order, route `loads/:id` |

---

## 2. Entry point and mounting

- `Header.tsx:21` has `const [newLoadOpen, setNewLoadOpen] = useState(false)`.
- The button label is **"+ New Load"** (class `ui-btn ui-btn-primary`). It appears only when the top-bar view is `dashboard` (`/app/dashboard`) or `loads` (`/app/loads` list, not a detail page). Source: `Header.tsx:32-33`. No other screen can open the dialog.
- The dialog is mounted conditionally at `Header.tsx:82-84`:
  `{newLoadOpen && <NewLoadDialog onClose={() => setNewLoadOpen(false)} onCreated={(id) => navigate(`/app/loads/${id}`)} />}`
- **DOM placement matters.** The `<dialog>` is a DOM child of `<header class="ui-topbar">`, which is inside `<div class="ui-shell">` (`AppLayout.tsx:9-12`). `showModal()` renders it in the top layer, but CSS inheritance still follows the DOM. That is how it gets `font-family: "Inter", system-ui, sans-serif; font-size: 14px` (`.ui-shell`, shell.css:81), `color`, `.ui-shell h2 {font-family: inherit; letter-spacing:-0.01em}` (shell.css:85) and `.ui-shell :focus-visible {outline-color: var(--ui-primary)}` (shell.css:87). Line-height 1.55 comes from `body` (industry.css:107).
- Every open starts from a fresh `INITIAL` draft, because unmounting (`onClose`) drops all state.

---

## 3. Dialog shell (layout, classes, CSS)

```
<dialog class="ui-dialog is-large" aria-label="New load" onClose={onClose} onCancel={…}>
  <aside class="ui-dialog-nav">
    <div class="ui-dialog-title">New load</div>
    ×10 <button type="button" class="ui-dialog-nav-item[ is-active]">
          <span>{Section}</span>
          [<span class="ui-badge" aria-label="{n} missing">{n}</span>]   // n>0, only after showErrors
          [<span class="ui-nav-note">N/A</span>]                          // n===0 && section==='LTL' && mode!=='LTL'
        </button>
  </aside>
  <div class="ui-dialog-main">
    <section class="ui-dialog-body" ref=bodyRef>
      <button type="button" class="ui-dialog-close" aria-label="Close">×</button>   // U+00D7
      {page for current section}
    </section>
    <footer class="ui-dialog-foot">
      <button class="ui-btn">Cancel</button>
      <div style="flex:1"/>
      [<button class="ui-btn">Back</button>]     // hidden on 'Load info'
      [<button class="ui-btn">Next</button>]     // hidden on 'Review'
      <button class="ui-btn ui-btn-primary">Create load</button>   // always visible
    </footer>
  </div>
</dialog>
```

- The nav order is exactly: `Load info`, `Stops`, `Freight`, `LTL`, `Carrier`, `Driver & equipment`, `Rates`, `Documents`, `Notes`, `Review` (`NewLoadDialog.tsx:7`).
- The close `×` is `position:absolute` inside the scrolling body, so it scrolls away with the content.
- There is no backdrop-click handler (Settings has one; New Load does not). Clicking the backdrop does nothing.
- Opening: `useEffect(() => { if (el && !el.open) el.showModal(); }, [])` (lines 250–253). The guard keeps the StrictMode double effect from calling it twice. No element has `autofocus`, so initial focus follows the browser's dialog focusing steps. In Chromium that is the first focusable descendant, the "Load info" nav button, because it comes first in DOM order. The port behaves the same if it keeps the same DOM order and the native dialog.

### CSS the dialog uses (copy verbatim from shell.css, with light/dark tokens from shell.css:5-76)

```css
.ui-dialog { width:min(720px, calc(100% - 48px)); min-height:420px; max-height:90vh; margin:auto; padding:0; overflow:hidden;
  color:var(--ui-text); background:var(--ui-card); border:0; border-radius:16px;
  box-shadow:0 24px 64px var(--ui-shadow), 0 0 0 1px var(--ui-border); }
.ui-dialog[open] { display:flex; }
.ui-dialog::backdrop { background:var(--ui-overlay, rgba(17,24,39,0.45)); }
.ui-dialog-nav { width:200px; flex:none; display:flex; flex-direction:column; gap:2px; padding:20px 12px; background:var(--ui-thead); }
.ui-dialog-title { padding:0 12px 14px; font-size:15px; font-weight:700; }
.ui-dialog-nav-item { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:9px 12px; text-align:left;
  font:inherit; font-size:13px; font-weight:600; color:var(--ui-text-2); background:transparent; border:0; border-radius:10px; cursor:pointer; }
.ui-dialog-nav-item:hover { background:var(--ui-nav-pill); }
.ui-dialog-nav-item.is-active { background:var(--ui-nav-pill); color:var(--ui-primary-hover); }
.ui-dialog-body { position:relative; flex:1; min-width:0; display:flex; flex-direction:column; gap:20px; padding:28px 32px; overflow-y:auto; }
.ui-dialog-close { position:absolute; top:14px; right:14px; width:32px; height:32px; font:inherit; font-size:20px; line-height:1;
  color:var(--ui-muted); background:transparent; border:0; border-radius:999px; cursor:pointer; }
.ui-dialog-close:hover { background:var(--ui-hover); color:var(--ui-text); }
.ui-dialog.is-large { width:min(1080px, calc(100% - 48px)); height:min(820px, calc(100vh - 48px)); max-height:none; }
.ui-dialog-main { flex:1; min-width:0; display:flex; flex-direction:column; }
.ui-dialog-main > .ui-dialog-body { flex:1; }
.ui-dialog-foot { flex:none; display:flex; align-items:center; gap:10px; padding:14px 32px; border-top:1px solid var(--ui-border); }
.ui-badge { min-width:20px; height:20px; padding:0 6px; display:inline-flex; align-items:center; justify-content:center;
  font-size:11px; font-weight:700; color:var(--ui-card); background:var(--ui-red); border-radius:999px; }
.ui-nav-note { font-size:10px; font-weight:600; letter-spacing:0.06em; text-transform:uppercase; color:var(--ui-muted); }
.ui-form-grid { display:grid; grid-template-columns:repeat(2, minmax(0,1fr)); gap:16px 18px; }
.ui-form-grid.is-3 { grid-template-columns:repeat(3, minmax(0,1fr)); }
@media (max-width:760px) { .ui-form-grid, .ui-form-grid.is-3 { grid-template-columns:minmax(0,1fr); } }
.ui-field { display:flex; flex-direction:column; gap:6px; min-width:0; }
.ui-field.is-wide { grid-column:1 / -1; }
.ui-field-label { font-size:12px; font-weight:600; color:var(--ui-text-2); }
.ui-req { color:var(--ui-red); }
.ui-input { width:100%; height:38px; padding:0 12px; box-sizing:border-box; font:inherit; font-size:14px; color:var(--ui-text);
  background:var(--ui-card); border:1px solid var(--ui-border); border-radius:10px; }
textarea.ui-input { height:auto; min-height:96px; padding:10px 12px; line-height:20px; resize:vertical; }
.ui-input::placeholder { color:var(--ui-muted); }
.ui-input:focus-visible { outline:2px solid var(--ui-primary); outline-offset:-1px; }
.ui-field.is-invalid .ui-input { border-color:var(--ui-red); }
.ui-field-error { font-size:12px; color:var(--ui-red); }
.ui-check { display:inline-flex; align-items:center; gap:8px; font-size:14px; cursor:pointer; }
.ui-check input { width:16px; height:16px; margin:0; accent-color:var(--ui-primary); }
.ui-checks { display:grid; grid-template-columns:repeat(2, minmax(0,1fr)); gap:10px 18px; }
.ui-panel { padding:16px 18px; border:1px solid var(--ui-border); border-radius:14px; }
.ui-panel-head { display:flex; align-items:center; gap:12px; margin-bottom:14px; }
.ui-note { padding:12px 14px; font-size:13px; line-height:20px; color:var(--ui-text-2); background:var(--ui-expand); border-radius:12px; }
.ui-errors { padding:12px 14px; font-size:13px; line-height:20px; color:var(--ui-red); background:var(--ui-red-soft); border-radius:12px; }
.ui-summary { display:grid; grid-template-columns:repeat(auto-fit, minmax(200px,1fr)); gap:16px; padding-top:16px; border-top:1px solid var(--ui-border); }
.ui-file-row { display:flex; align-items:center; gap:12px; padding:12px 0; }
.ui-file-row + .ui-file-row { border-top:1px solid var(--ui-border); }
.ui-btn-sm { height:30px; padding:0 14px; font-size:13px; }
label.ui-btn { position:relative; }
label.ui-btn:focus-within { outline:2px solid var(--ui-primary); outline-offset:2px; }
.ui-file-input { position:absolute; width:1px; height:1px; opacity:0; pointer-events:none; }
```

Other classes used, from elsewhere in shell.css:
- `.ui-btn` (128–135): 36px tall pill, 600 weight, `--ui-text-2` on `--ui-card`, 1px border, radius 999. `.ui-btn-primary` is `--ui-primary` with `--ui-on-primary` text.
- `.ui-filter` / `.ui-filter-opt` (219–224): the segmented control. `is-active` gets a card background with a shadow.
- `.ui-link` (227–228): 13px, 600, primary colour, underline on hover.
- `.ui-h2` (229): 22px/700/1.2.
- `.ui-p` (230): 14px, line-height 22px, `--ui-text-2`, max-width 60ch.
- `.ui-label` (201): 11px, 600, letter-spacing .06em, **uppercase**, muted.
- `.ui-kv-value` (203): 13px, 600, margin-top 2px.
- `.ui-stop-kind` (207–209): 11px, 700, **uppercase**. `.pickup` is amber and `.delivery` is green.
- `.ui-setting-help` (280): 13px, muted, max-width 40ch, margin-top 3px.

Because of `text-transform: uppercase`, stat labels render as "TOTAL TO CUSTOMER" and the stop panel heading as "STOP 1". The source text is mixed case.

---

## 4. Shared sub-components (in NewLoadDialog.tsx)

- **Field** (lines 211–225) `{label, required?, invalid?, wide?, group?, children}`:
  - Class: `ui-field` plus ` is-wide` when wide, plus ` is-invalid` when invalid.
  - The head is `<span class="ui-field-label">{label}{required && <span class="ui-req"> *</span>}</span>`. The asterisk span text is a space followed by `*`.
  - When invalid, `<span class="ui-field-error">Required</span>` follows the control.
  - `group` renders `<div class=… role="group" aria-label={label}>` so segmented buttons stay clickable. Otherwise the element is a `<label class=…>` wrapping the control.
- **Choice** (227–237) renders `<div class="ui-filter" style="align-self:flex-start">` containing one `<button type="button" class="ui-filter-opt[ is-active]">{o}</button>` per option.
- **Head** (747–754) renders `<div><h2 class="ui-h2" style="margin:0">{title}</h2><p class="ui-p" style="margin-top:4px">{help}</p></div>`.
- **Stat** (756–763) renders `<div><div class="ui-label">{label}</div><div class="ui-kv-value" style="font-size:15px">{value}</div></div>`.

---

## 5. Draft model, defaults and option lists

### Draft (`INITIAL`, lines 81–90)

| Field | Default | Control / section |
|---|---|---|
| customer | `''` | select, Load info |
| billTo | `''` | select, Load info |
| ref | `''` | text, Load info |
| po | `''` | text, Load info |
| mode | `'FTL'` | Choice FTL/LTL/Partial, Load info |
| equipment | `''` | select, Load info |
| dispatcher | `USER.name` = `'Rosa Medina'` | text, Load info |
| stops | `[emptyStop('Pickup'), emptyStop('Delivery')]` | Stops |
| commodity, weight, pieces | `''` | Freight |
| packaging | `'Pallets'` | select, Freight |
| value, temp | `''` | Freight |
| hazmat | `false` | checkbox, Freight |
| unNumber | `''` | Freight |
| freightClass, nmfc, handlingUnits, length, width, height | `''` | LTL |
| stackable | `false` | LTL |
| services | `[]` | LTL |
| brokered | `false` | Carrier (Own fleet) |
| carrier, carrierContact, carrierPhone, carrierRate | `''` | Carrier |
| driver, truck, trailer | `''` | Driver & equipment |
| lineHaul, fuel, accessorials, miles, driverPay | `''` | Rates |
| terms | `'Net 30'` | select, Rates |
| docs | `{}` (a `Record<docName, fileName>`) | Documents |
| instructions, internal | `''` | Notes |

`emptyStop(kind)` returns `{kind, facility:'', address:'', city:'', state:'', zip:'', date:'', from:'', to:'', number:'', contact:''}`.

Numeric fields are stored as **strings**, exactly as the inputs return them. `num(s) = Number(s) || 0` and `positive(s) = Number(s) > 0` (lines 94–95).

### Option lists (exact, in order)

- MODES: `FTL`, `LTL`, `Partial`
- EQUIPMENT: `Dry van, 53 ft`, `Reefer, 53 ft`, `Flatbed, 48 ft`, `Flatbed, tarped`, `Step deck, 48 ft`, `Power only`, `Box truck, 26 ft`
- PACKAGING: `Pallets`, `Skids`, `Crates`, `Boxes`, `Drums`, `Totes`, `Loose`
- FREIGHT_CLASSES: `50`, `55`, `60`, `65`, `70`, `77.5`, `85`, `92.5`, `100`, `110`, `125`, `150`, `175`, `200`, `250`, `300`, `400`, `500`
- LTL_SERVICES: `Liftgate at pickup`, `Liftgate at delivery`, `Residential delivery`, `Inside delivery`, `Delivery appointment`, `Limited access`
- TERMS: `Net 15`, `Net 30`, `Net 45`, `Net 60`, `Quick pay`
- DOCUMENTS: `Rate confirmation`, `Customer load tender`, `Bill of lading`, `Proof of delivery`, `Lumper receipt`

### Reference data read from mock.ts (these must come from the API in Runtruck2)

| Constant | Fields used | Where | Values (in order) |
|---|---|---|---|
| `CUSTOMERS` | `name`, `terms` | Customer and Bill to options, default terms | Northgate Foods (Net 30), Bayline Distribution (Net 30), Cascade Building Supply (Net 45), Harbor Point Retail (Net 30), Sierra Ag Partners (Net 60), Vantage Home Goods (Net 30) |
| `CARRIERS[0]` | `name`, `mc`, `dot` | Own-fleet note, Review "Carrier", toLoad carrier for own fleet | Sunridge Freight (own fleet) · MC 812044 · DOT 2291176 |
| `CARRIERS.slice(1)` | `name`, `mc` (+ `dot` in toLoad) | Partner carrier select | Valley Line Transport MC 604117 / DOT 1780342; Cascade Reefer Express MC 733905 / DOT 2014588; High Desert Hauling MC 581230 / DOT 1655901; Golden State Flatbed MC 690452 / DOT 1893027 |
| `DRIVERS` | `name`, `status`, `unit` | Driver select, auto-fills truck | Marcus Hale · On duty (T-114); Dara Whitfield · On duty (T-107); Ellis Nakamura · On duty (T-121); Priya Raman · Available (T-103); Ana Cortez · Available (T-109); Tobias Frey · Home time (T-118) |
| `TRUCKS` | `unit`, `status` | Truck select | T-103 · In service; T-107 · In service; T-109 · In service; T-114 · Service due; T-118 · In shop; T-121 · In service |
| `TRAILERS` | `unit`, `kind` | Trailer select | RF-27 · Reefer · 53 ft; RF-09 · Reefer · 53 ft; RF-88 · Reefer · 53 ft; DV-51 · Dry van · 53 ft; DV-88 · Dry van · 53 ft; DV-14 · Dry van · 53 ft; FB-04 · Flatbed · 48 ft; FB-12 · Flatbed · 48 ft |
| `USER.name` | | Dispatcher default; the detail page's "Load created by …" | Rosa Medina |
| (hard-coded) | | Carrier help text | "Sunridge" (the tenant name is hard-coded in the copy) |

---

## 6. The ten section pages

Every page renders inside `.ui-dialog-body`, a flex column with **20px gaps between top-level children**. "Row" below means the CSS-grid auto-placement result at desktop width. Below 760px every grid collapses to one column.

### 6.1 Load info (lines 296–339)

Head: **"Load information"** / "Who the load is for and how it moves."

`.ui-form-grid` (2 columns):

| Row | Col 1 | Col 2 |
|---|---|---|
| 1 | **Customer** * (select `ui-input`). First option `value=""` "Select a customer", then one per customer (the option has no `value` attribute, so the value is the name). Invalid when `missing('Load info','Customer')` | **Bill to** (select). First option `""` "Same as customer", then the customers |
| 2 | **Tender / reference #** (text, placeholder `e.g. PO 88-41230`) | **Customer PO #** (text, no placeholder) |
| 3 | **Mode** (group) → Choice `FTL / LTL / Partial` | **Equipment** * (select). First option `""` "Select equipment", then EQUIPMENT |
| 4 | **Dispatcher** (text, value defaults to "Rosa Medina") | (empty) |

Customer `onChange` (lines 304–307) does one `setD` with:
- `customer = value`
- `billTo = prev.billTo || value`. This fills Bill to only while it is still empty, so it never follows later customer changes.
- `terms = CUSTOMERS.find(name===value)?.terms ?? prev.terms`. This overwrites any manual terms whenever a real customer is picked.

### 6.2 Stops (lines 341–402)

Head: **"Stops"** / "In the order the truck runs them. Add more for multi-stop loads."

If `showErrors && errors.Stops`, a `<div class="ui-errors">` appears with `errors.Stops.join(' · ')`.

Each stop renders as `<div class="ui-panel">` (key = index):
- **Panel head** (`.ui-panel-head`):
  - `<span class="ui-stop-kind pickup|delivery">Stop {i+1}</span>` (amber for Pickup, green for Delivery; renders uppercase)
  - Choice `Pickup / Delivery` bound to `kind`
  - a `<div style="flex:1">` spacer
  - when `stops.length > 2`: `<button class="ui-link">Remove</button>`, which removes stop i. It shows on every stop, including the first and last.
- `.ui-form-grid` (2 columns): **Facility** * (wide, placeholder `e.g. Northgate Cold Storage`), then **Street address** * (wide).
- `.ui-form-grid is-3` with `style="margin-top:16px"`:

| Row | Col 1 | Col 2 | Col 3 |
|---|---|---|---|
| 1 | **City** * | **State** * (`maxLength=2`, placeholder `CA`; the form does not uppercase it) | **ZIP** (`inputMode="numeric"`) |
| 2 | **Date** * (`type="date"`) | **Window opens** (`type="time"`) | **Window closes** (`type="time"`) |
| 3 | **`{kind} #`**, i.e. "Pickup #" / "Delivery #" | (empty) | (empty) |
| 4 | **Site contact** (wide, placeholder `Name and phone`) spans all 3 | | |

  Row 3 has only one filled cell because the wide "Site contact" cannot fit and wraps to row 4.
- Invalid flags on stop fields are computed directly, not via `missing()`: facility `showErrors && !facility.trim()`, and the same for address, city and state; date is `showErrors && !date`.

After the panels comes `<div style="display:flex; gap:10px">` with two buttons:
- **"+ Add pickup"** (`ui-btn`) inserts a new empty Pickup **before the last stop**: `[...stops.slice(0,-1), emptyStop('Pickup'), last]`.
- **"+ Add delivery"** (`ui-btn`) appends an empty Delivery at the end.

### 6.3 Freight (lines 404–443)

Head: **"Freight"** / "What is on the trailer."

`.ui-form-grid` (2 columns):
1. **Commodity** * (wide, placeholder `e.g. Frozen produce`)
2. **Weight (lb)** * (`type=number min=0`) | **Declared value ($)** (`number min=0`)
3. **Pieces** (`number min=0`) | **Packaging** (select PACKAGING, no blank option, default Pallets)
4. When equipment starts with `"Reefer"`: **Temperature (°F)** (`type=number`, no min, placeholder `e.g. -10`) in col 1
5. `<div class="ui-field is-wide"><label class="ui-check"><input type=checkbox/>Hazardous materials</label></div>`
6. When `hazmat`: **UN number** * (placeholder `e.g. UN1203`) in col 1

### 6.4 LTL (lines 445–502)

**When `mode === 'LTL'`:** Head **"LTL details"** / "Needed to rate and class a less-than-truckload shipment."

- `.ui-form-grid` (2 columns):
  - Row 1: **Freight class** * (select: `""` "Select a class" + FREIGHT_CLASSES) | **NMFC #** (text)
  - Row 2: **Handling units** * (`number min=0`) | `<div class="ui-field" style="justify-content:flex-end"><label class="ui-check"><input type=checkbox/>Stackable</label></div>`
- `.ui-form-grid is-3`: **Length (in)** | **Width (in)** | **Height (in)**, each `number min=0`.
- **Services** Field (group, outside any grid) contains `<div class="ui-checks">` (2-column grid) with the 6 LTL_SERVICES checkboxes. Toggling **appends** to or removes from `services`, so the stored order is the click order.

**Otherwise:** Head **"LTL details"** / "Only needed for less-than-truckload shipments.", then:

`<div class="ui-note">This load is {FTL ? 'a full truckload' : 'a partial'}, so there is nothing to fill in here. <button class="ui-link">Make it an LTL load</button></div>`

The button runs `set('mode','LTL')`.

### 6.5 Carrier (lines 504–538)

Head: **"Carrier"** / "Haul it with the Sunridge fleet, or broker it to a partner carrier."

- **Hauled by** (group) holds a Choice `Own fleet / Partner carrier`. The value is `brokered ? 'Partner carrier' : 'Own fleet'`. Changing it sets `brokered` **and clears `driver`, `truck` and `trailer`**. It does not clear carrier, carrierRate or driverPay.
- When brokered, a `.ui-form-grid`:
  - Row 1: **Carrier** * (select: `""` "Select a carrier" + partners as `value=name` with text `"{name} · {mc}"`) | **Carrier rate ($)** * (`number min=0`)
  - Row 2: **Carrier dispatcher** (text) | **Carrier phone** (`type=tel`)
- When own fleet: `<div class="ui-note">Sunridge Freight (own fleet) · MC 812044 · DOT 2291176. Assign the driver, truck and trailer in Driver & equipment.</div>`

### 6.6 Driver & equipment (lines 540–588)

Head: **"Driver & equipment"**. The help text depends on the carrier choice:
- brokered: "The partner carrier’s driver and units, if you have them yet." (with U+2019)
- own fleet: "Leave the driver empty to put the load on the board as Needs driver."

Both variants use `.ui-form-grid is-3`:
- **Brokered:** **Driver name** | **Truck #** | **Trailer #**, all free-text inputs.
- **Own fleet:**
  - **Driver** select: `""` "Unassigned", then `value=name` with text `"{name} · {status}"`. `onChange` sets `driver`, and `truck = prev.truck || driver.unit || ''` (it auto-fills the truck only if no truck is set; choosing Unassigned leaves the truck alone).
  - **Truck** select: `""` "None", then `value=unit` with text `"{unit} · {status}"`.
  - **Trailer** select: `""` "None", then `value=unit` with text `"{unit} · {kind}"`.
  - None of the lists are filtered by availability. Tobias Frey (Home time), T-118 (In shop) and on-load drivers are all selectable.

### 6.7 Rates (lines 590–624)

Head: **"Rates"** / "What the customer pays and what the load costs."

`.ui-form-grid` (all numeric inputs are `min=0`):
- Row 1: **Line haul ($)** * | **Fuel surcharge ($)**
- Row 2: **Accessorial charges ($)** | **Loaded miles**
- Row 3 (own fleet): **Driver pay ($)** | **Payment terms** (select TERMS, no blank option)
- Row 3 (brokered): **Payment terms** in col 1. Driver pay is hidden, but its value stays in state and is ignored.

`.ui-summary` holds 4 Stats (formulas in §8):
- "Total to customer"
- "Rate / mile"
- "Driver pay" (own fleet) or "Carrier cost" (brokered)
- "Margin"

### 6.8 Documents (lines 626–657)

Head: **"Documents"** / "Attach what you have now; the rest can be added from the load later."

`<div class="ui-panel" style="padding:4px 18px">` holds one `.ui-file-row` per DOCUMENTS entry:
- `<div style="flex:1; min-width:0">`:
  - `<div style="font-weight:600">{name}</div>`
  - `<div class="ui-setting-help" style="overflow-wrap:anywhere">{fileName || 'Not attached'}</div>`
- When a file is attached: `<button class="ui-link">Remove</button>`, which sets `docs[name] = ''`.
- `<label class="ui-btn ui-btn-sm">{file ? 'Replace' : 'Attach'}<input class="ui-file-input" type="file" accept=".pdf,image/*"/></label>`. `onChange` stores **only `files[0].name`** (or `''`). The File object is thrown away.

### 6.9 Notes (lines 659–671)

Head: **"Notes"** / "Instructions go to the driver with the load; internal notes stay in the office."

`.ui-form-grid` with two wide textareas:
- **Driver instructions**, placeholder `Check in at gate 3, 2-hour free time, no touch freight…` (U+2026)
- **Internal notes**, no placeholder

### 6.10 Review (lines 673–700)

Head: **"Review"** / "Check the load before it goes on the board."

When `errorCount > 0` (live, whether or not `showErrors` is set):

```
<div class="ui-errors">
  <strong>{n} {n===1 ? 'thing' : 'things'} left to fill in</strong>
  for each section with errors, in SECTIONS order:
    <div style="margin-top:6px"><button class="ui-link">{Section}</button>{' — '}{errors.join(', ')}</div>
</div>
```

Clicking a section button runs `setShowErrors(true)` and then `go(section)`.

Otherwise it shows: `<div class="ui-note">Everything required is filled in. It goes on the board as {brokered || driver ? 'Dispatched' : 'Needs driver'}.</div>`

A `.ui-summary` with 8 Stats follows:

| Label | Value |
|---|---|
| Customer | `customer \|\| '—'` |
| Mode · equipment | `` `${mode} · ${equipment \|\| '—'}` `` e.g. `FTL · —` |
| Stops | `` `${#Pickup} pickup · ${#Delivery} delivery` `` (never pluralized: "2 pickup · 1 delivery") |
| Route | `stops[0].city && stops[last].city ? `${stops[0].city} → ${stops[last].city}` : '—'`, using the raw untrimmed city and **first/last stop by position** |
| Freight | `commodity ? commodity + (weight ? ` · ${num(weight).toLocaleString('en-US')} lb` : '') : '—'` |
| Carrier | `brokered ? (carrier \|\| '—') : 'Sunridge Freight (own fleet)'` |
| Driver | `driver \|\| 'Unassigned'` |
| Total to customer | `money(total)` |

---

## 7. Validation (lines 97–127): exact rules and messages

`validate(d)` returns `Partial<Record<Section, string[]>>`. It runs on every render.

| Section | Condition | Message (exact) |
|---|---|---|
| Load info | `!customer` | `Customer` |
| Load info | `!equipment` | `Equipment` |
| Stops | no stop with kind Pickup | `At least one pickup` |
| Stops | no stop with kind Delivery | `At least one delivery` |
| Stops (per stop, n = i+1) | `!facility.trim()` | `Stop {n}: facility` |
| | `!address.trim() \|\| !city.trim() \|\| !state.trim()` | `Stop {n}: street, city and state` |
| | `!date` | `Stop {n}: date` |
| | `date && prev.date && date < prev.date` (ISO string compare, **only against the immediately previous stop**) | `Stop {n}: date is before stop {i}` (i is the previous stop's 1-based number) |
| Freight | `!commodity.trim()` | `Commodity` |
| Freight | `!(Number(weight) > 0)` | `Weight` |
| Freight | `hazmat && !unNumber.trim()` | `UN number for hazmat` |
| LTL (only if mode LTL) | `!freightClass` | `Freight class` |
| LTL (only if mode LTL) | `!(Number(handlingUnits) > 0)` | `Handling units` |
| Carrier (only if brokered) | `!carrier` | `Carrier` |
| Carrier (only if brokered) | `!(Number(carrierRate) > 0)` | `Carrier rate` |
| Rates | `!(Number(lineHaul) > 0)` | `Line haul rate` |

What is **not** validated:
- ZIP, state format (beyond maxLength 2), phone
- window opens vs. closes
- fuel/accessorials/driverPay/miles/value/pieces/dims being negative (`min=0` is not enforced because there is no `<form>`)
- UN number format
- driver/truck/trailer availability
- stop dates in the past

**How errors surface:**
- `missing(section, msg)` is `showErrors && errors[section]?.includes(msg)`. It drives the Field `is-invalid` styling and the "Required" text for non-stop fields.
- `showErrors` starts false. It becomes true on a failed **Create load**, or on clicking a section link in Review. **It never resets.** After that, badges and invalid styles update live as fields are fixed.
- Nav badge count is `showErrors ? errors[s]?.length ?? 0 : 0`.
- "date is before stop" has no field highlight. It shows only in the Stops banner, the badge count and Review.

**Initial state (fresh dialog):**
- `errorCount = 11`: Load info 2 (Customer, Equipment), Stops 6 (`Stop 1: facility`, `Stop 1: street, city and state`, `Stop 1: date`, the same three for Stop 2), Freight 2 (Commodity, Weight), Rates 1 (Line haul rate).
- Review reads "11 things left to fill in", followed by
  - "Load info — Customer, Equipment"
  - "Stops — Stop 1: facility, Stop 1: street, city and state, Stop 1: date, Stop 2: facility, Stop 2: street, city and state, Stop 2: date"
  - "Freight — Commodity, Weight"
  - "Rates — Line haul rate"
- Pressing Create load on an empty form jumps to Load info. Badges read Load info 2, Stops 6, Freight 2, Rates 1. LTL shows "N/A".

---

## 8. Computed values

| Value | Formula | Where shown | Authoritative? |
|---|---|---|---|
| total | `num(lineHaul) + num(fuel) + num(accessorials)` | Rates "Total to customer", Review, and margin | **Financial: backend** (packages/calculations). The client may show a live preview using the same shared function |
| cost | `brokered ? num(carrierRate) : num(driverPay)` | Rates stat 3, toLoad `pay` | **Financial: backend** |
| margin | `cost > 0 ? signedMoney(total - cost) : '—'`, where `signedMoney(n) = n<0 ? '-'+money(-n) : money(n)` | Rates stat 4, toLoad `margin`, detail KPI | **Financial: backend** |
| rate per mile | `num(miles) > 0 ? '$' + (num(lineHaul)/num(miles)).toFixed(2) : '—'` (line haul only; no thousands separator) | Rates stat 2, toLoad `rpm`, detail KPI note `"{rpm} / mi"` | **Financial: backend** |
| money(n) | `'$' + n.toLocaleString('en-US')`: no fixed decimals, up to 3 fraction digits (`2450.5` shows as `$2,450.5`) | everywhere | presentation |
| errorCount | sum of all error-list lengths | Review | presentation (mirrors shared Zod validation) |
| dirty | `JSON.stringify(d) !== JSON.stringify(INITIAL)` | close confirm | presentation |
| Status on create | `covered = brokered \|\| Boolean(driver)` gives `'Dispatched'`/`tag-neutral` (gray chip), otherwise `'Needs driver'`/`tag-outline` (amber chip) | Review note, toLoad | **Business rule: backend** (state machine) |
| Load id | `nextId(loads) = 'L-' + (max(0, ...loads.map(l => Number(l.id.slice(2)) \|\| 0)) + 1)` | URL, headings | **Backend** (per-org sequence). Against the mock data: **`L-40223`**, then `L-40224`, … |

Mock-data results: the Loads "Active" tab goes from **"5 loads"** to **"6 loads"** after one create. "All" goes 8 to 9. The Dashboard "Active loads" KPI goes 5 to 6. The Loads KPI "Undispatched" goes 1 to 2 only if the new load is "Needs driver".

---

## 9. `toLoad(d, id)` mapping (lines 138–194): the created `Load`

Helpers:
- `place(s) = `${city.trim()}, ${state.trim().toUpperCase()}``
- `street(s) = `${address.trim()}, ${place(s)}``
- `first` = the first stop with kind Pickup (falls back to `stops[0]`)
- `last` = the **last** stop with kind Delivery (falls back to the final stop)

| Load field | Value |
|---|---|
| id | `nextId(loads)` |
| customer | `d.customer` |
| route | `` `${place(first)} → ${place(last)}` `` |
| pickup / delivery | `shortDate(first.date)` / `shortDate(last.date)`, where `shortDate('2026-09-05') = 'Sep 5'` (the year is dropped) |
| driver | `driver.trim() \|\| 'Unassigned'` |
| unit | `[truck.trim(), trailer.trim()].filter(Boolean).join(' / ') \|\| '—'` |
| rate | `money(num(lineHaul))` (line haul only, not the total) |
| status / tagClass | `Dispatched`/`tag-neutral` or `Needs driver`/`tag-outline` |
| miles | `miles>0 ? miles.toLocaleString('en-US') : '—'` |
| rpm / pay / margin | see §8 (`pay = cost>0 ? money(cost) : '—'`) |
| commodity | `commodity.trim()` |
| weight | `` `${num(weight).toLocaleString('en-US')} lb` `` |
| equip | `equipment` |
| temp | Reefer*: `temp ? `${temp} °F` : 'Set at pickup'`; otherwise `'Ambient'` |
| ref | `ref.trim() \|\| po.trim() \|\| '—'` |
| from / fromAddr | `first.facility.trim()` / `street(first)` (no ZIP) |
| to / toAddr | `last.facility.trim()` / `street(last)` |
| carrier / carrierMc / carrierDot | brokered: the matching partner (falls back to `CARRIERS[0]`); own fleet: `CARRIERS[0]` |
| mode | `FTL` gives "Full truckload", `LTL` gives "Less than truckload", `Partial` gives "Partial" |
| ltl | LTL only: `` [`Class ${freightClass}`, `${handlingUnits} ${packaging.toLowerCase()}`, ...services].join(' · ') ``; otherwise `undefined` |
| stops[] | every stop in order: `{kind, name: facility.trim(), address: `${street(s)} ${zip.trim()}`.trim(), when: `${shortDate(date)} · ${from&&to ? from+'–'+to : from \|\| to \|\| 'Any time'}`}` |
| documents[] | `DOCUMENTS.map(name => ({name, file: docs[name] ?? ''}))`, always 5 entries |
| carrierRate | brokered ? `money(num(carrierRate))` : `undefined` |
| notes | `instructions.trim() \|\| undefined` |
| createdAt | `` `Today ${HH}:${MM}` `` from the browser's **local** clock at creation (a frozen string) |

**Collected but never saved:**
- billTo, po (except as the ref fallback), dispatcher, terms
- fuel and accessorials as separate amounts (they only feed margin)
- pieces, packaging (except inside the LTL string), declared value, hazmat, unNumber
- nmfc, length/width/height, stackable
- carrierContact, carrierPhone
- per-stop `number` and `contact`
- internal notes
- the actual document files

In Runtruck2 **all of these must be persisted** (Rule 1). The UI simply does not display them.

### Worked example A: own fleet, FTL, reefer

**Input:**
- Customer Northgate Foods (so Bill to becomes Northgate Foods and terms Net 30). No ref or PO. Mode FTL, equipment `Reefer, 53 ft`.
- Stop 1 Pickup: Northgate Cold Storage, `4120 S Golden State Blvd`, Fresno, `ca`, 93725, 2026-09-05, 08:00–12:00.
- Stop 2 Delivery: Reno Grocers DC, `1855 E Greg St`, Sparks, NV, 89431, 2026-09-06, opens 06:00 only.
- Commodity Frozen produce, weight 41200, temp -10.
- Own fleet, driver Priya Raman (truck auto-fills to T-103), trailer RF-09.
- Line haul 2450, fuel 180, accessorials 75, miles 478, driver pay 612.
- Rate confirmation attached as `ratecon.pdf`. Instructions "Check in at gate 3".

**Rates preview:** $2,705 · $5.13 · Driver pay $612 · Margin $2,093.

**Review:**
- Customer: Northgate Foods
- Mode · equipment: FTL · Reefer, 53 ft
- Stops: 1 pickup · 1 delivery
- Route: Fresno → Sparks
- Freight: Frozen produce · 41,200 lb
- Carrier: Sunridge Freight (own fleet)
- Driver: Priya Raman
- Total to customer: $2,705
- Note: "…It goes on the board as Dispatched."

**Created Load:**
- id `L-40223`, route `Fresno, CA → Sparks, NV`, pickup `Sep 5`, delivery `Sep 6`
- driver `Priya Raman`, unit `T-103 / RF-09`, rate `$2,450`, status `Dispatched`/`tag-neutral`
- miles `478`, rpm `$5.13`, pay `$612`, margin `$2,093`
- weight `41,200 lb`, temp `-10 °F`, ref `—`
- fromAddr `4120 S Golden State Blvd, Fresno, CA`, toAddr `1855 E Greg St, Sparks, NV`
- carrier `Sunridge Freight (own fleet)` / `MC 812044` / `DOT 2291176`, mode `Full truckload`
- stops:
  - `{Pickup, Northgate Cold Storage, "4120 S Golden State Blvd, Fresno, CA 93725", "Sep 5 · 08:00–12:00"}`
  - `{Delivery, Reno Grocers DC, "1855 E Greg St, Sparks, NV 89431", "Sep 6 · 06:00"}`
- documents: Rate confirmation = `ratecon.pdf`, the other 4 = `''`
- notes `Check in at gate 3`, createdAt e.g. `Today 14:05`

### Worked example B: brokered, LTL, negative margin

**Input:**
- Customer Bayline Distribution, ref `PO 55-90200`, mode LTL, equipment Dry van, 53 ft.
- Stop 1 Pickup: Bayline DC 4, 2900 Navy Dr, Stockton, CA, no ZIP, 2026-09-04, no window.
- Stop 2 Delivery: Wasatch Crossdock, 1740 S 4130 W, Salt Lake City, UT, 84104, 2026-09-06, closes 14:00 only.
- Commodity Palletized dry goods, weight 6200.
- LTL: class 70, 4 handling units, Pallets; services clicked in the order Liftgate at delivery, then Delivery appointment.
- Partner carrier Valley Line Transport, carrier rate 1500, no driver.
- Line haul 1200, fuel 100, miles blank.

**Created Load:**
- rate `$1,200`, miles `—`, rpm `—`, pay `$1,500`, margin `-$200`
- status `Dispatched` (because brokered, even with no driver), driver `Unassigned`, unit `—`, temp `Ambient`, ref `PO 55-90200`
- carrier `Valley Line Transport` / `MC 604117` / `DOT 1780342`, carrierRate `$1,500`
- mode `Less than truckload`, ltl `Class 70 · 4 pallets · Liftgate at delivery · Delivery appointment`
- stops[0]: address `2900 Navy Dr, Stockton, CA`, when `Sep 4 · Any time`
- stops[1]: address `1740 S 4130 W, Salt Lake City, UT 84104`, when `Sep 6 · 14:00`

---

## 10. Interactions and state

| Interaction | Behaviour | State touched | Class |
|---|---|---|---|
| Nav item click | `go(s)`: `setSection(s)` and `bodyRef.scrollTo({top:0})`. Any section is reachable; nothing is validated | `section` | (b) client |
| Next / Back | `step(±1)`: index ±1. **Skips LTL when mode ≠ LTL** (Freight→Carrier, Carrier→Freight). Next is hidden on Review, Back on Load info | `section` | (b) |
| Every input change | immutable `setD` update (`set`, `setStop`) | draft `d` | (b) until submitted; then (a) |
| Mode, stop kind, Hauled by | segmented buttons; Hauled by also clears driver, truck and trailer | `d` | (b) |
| Add pickup / Add delivery / Remove | see §6.2 | `d.stops` | (b) |
| Attach / Replace / Remove doc | stores the file name or `''` | `d.docs` | (b), but the files themselves are (a) business data once created |
| "Make it an LTL load" | `mode = 'LTL'` | `d.mode` | (b) |
| Review section link | `showErrors = true`, then go | `showErrors`, `section` | (b) |
| **Create load** | If any section has errors: `showErrors = true` and go to the first bad section in SECTIONS order. Otherwise: `load = toLoad(d, nextId(loads))`, `addLoad(load)` (prepends to the in-memory list), `dialog.close()`, `onCreated(load.id)` → `navigate('/app/loads/' + id)`. The `close` event then fires `onClose` → `setNewLoadOpen(false)` → unmount | `created` loads in context | **(a) business: must become `POST /api/v1/loads`** |
| Cancel button / × | `requestClose()`: if not dirty, close; if dirty, `window.confirm('Discard this new load? What you entered will be lost.')` and close only on OK | dialog open | (b) |
| Escape | `onCancel` → `preventDefault()` → `requestClose()` (same confirm) | | (b) |
| Enter key in inputs | nothing (no `<form>`, every button is `type="button"`) | | |
| Backdrop click | nothing | | |

Notes on dirty tracking:
- Toggling LTL then back to FTL is **not** dirty.
- Picking a customer and then "Select a customer" **is** dirty, because billTo and terms keep the earlier values.
- Attaching and then removing a doc **is** dirty (`docs = {name: ''}`).

---

## 11. Where created loads show up after create

- **Context** (`AppShellContext.tsx:29,40-41`): `loads = [...created, ...LOADS]`, newest first. In memory only; **a reload loses them**.
- **LoadDetailPage** at `/app/loads/:id`: see §12.
- **LoadsPage**:
  - The load is at the top of the Active tab (both statuses are in `ACTIVE_STATUSES`) and **expanded by default** on first mount, because `openId = firstId(rows)`.
  - The Truck column shows `Unassigned` (muted) when unit is `—`.
  - The expanded row uses `stopsOf(l)`, which returns the created `stops` verbatim. Labels read `"{kind} · Stop {i+1}"` and times are `s.when`.
- **DashboardPage**: counted in "Active loads" and shown first in the Active loads table (`slice(0,6)`).
- **Planner** (`planner.ts:153-165`): one event per stop.
  - date = `shortToIso(day, 2026)`. The year is **forced to 2026**.
  - time: a window containing `–` splits into start/end. Anything else (`'Any time'`, or a single `'06:00'`) becomes **08:00–09:00**.
  - place = `cityState(address)`, which strips only a 5-digit ZIP.
- **EventDialog** "Related load" options: `"L-40223 · Fresno, CA → Sparks, NV"`.
- **Search** (`matchesQuery`, over every string field): created loads are also matched on `mode`, `ltl`, `notes`, `carrierRate` and `createdAt`. Searching "Today" or "truckload" hits only created loads. Array fields such as `stops` and `documents` are not searched.

---

## 12. LoadDetailPage: created loads vs. mock loads (LoadDetailPage.tsx)

- **Selection:** `sel = loads.find(l => l.id === id) ?? loads[0]`. An unknown id silently shows `loads[0]`, which is the newest created load if one exists, otherwise L-40218.
- **Branching:** the page checks for the optional fields `stops`, `documents`, `createdAt`, `carrierRate`, `mode`, `ltl` and `notes`.

### Layout (identical for both branches)

1. `Card` (no title): `<h2 class="ui-h2" style="margin:0">{route}</h2>` followed by `<div style="margin-top:6px; font-size:14px; color:var(--ui-muted)">Load {id} · {customer} · {status}</div>`.
2. `Kpis` with 4 tiles:
   - `Miles` = miles
   - `Line haul` = rate, with note `"{rpm} / mi"` unless rpm is `—`
   - `Carrier cost` if `carrierRate` is set, otherwise `Driver pay` = pay
   - `Margin` = margin
3. `.ui-grid-2`:
   - Left: Card "Stops". Each stop is a `.ui-stop` holding `.ui-stop-kind[ pickup|delivery]`, `.ui-stop-name`, and two `.ui-stop-meta` lines (address, window). Below the stops: `<div class="ui-placeholder" style="margin-top:20px">Live map / ELD trace</div>`.
   - Right: a column (gap 20) of four cards:
     - "Freight & pay" key-values
     - "Carrier" key-values
     - "Documents": rows `display:flex; gap:14px; padding:10px 0`, with a top border on every row except the first. Each row has the name (flex 1) and a Tag. `Attached` uses `tag-green` (green chip); anything else uses `tag-outline` (amber chip).
     - "Activity": rows with a `width:96px; font-size:13px; muted; tabular-nums` time column and the text.

### Differences

| Part | Created load (from New Load) | Mock load |
|---|---|---|
| Stops | each `sel.stops[i]`: kind `Pickup`/`Delivery` (class pickup/delivery), name, address (with ZIP), window = `s.when` (e.g. `Sep 5 · 08:00–12:00`) | 3 synthetic stops: (1) `Pickup · at shipper` if status At pickup, otherwise `Pickup · complete`; from/fromAddr; window `Pickup {pickup} · 08:00–14:00`. (2) `Fuel stop` (no colour class, so the border is primary blue); `Planned · 92 gal, DEF top-off`; `Routed automatically on the lane`; `{pickup} · 16:40`. (3) `Delivery · complete` if Delivered, otherwise `Delivery`; to/toAddr; `Deliver {delivery} · 06:00–12:00` |
| Freight & pay | `Mode` row first, then Commodity, Weight, Equipment, Temperature, Reference, then `LTL` row if ltl | Commodity, Weight, Equipment, Temperature, Reference |
| Carrier | Carrier, MC #, DOT #, plus `Carrier rate` if brokered | Carrier, MC #, DOT # |
| KPI 3 label | `Carrier cost` if brokered, otherwise `Driver pay` | `Driver pay` |
| Documents | all 5 DOCUMENTS, `Attached` if a file name is set, otherwise `Pending` | Rate confirmation `Attached`; Bill of lading `Attached` if Delivered or Needs POD, otherwise `Pending`; Proof of delivery `Attached` if Delivered, otherwise `Pending` |
| Activity | `{createdAt}` "Load created by Rosa Medina" (this is `USER.name`, the **viewer**, not the creator), plus `{createdAt}` "Driver instructions: {notes}" if notes | `Today 07:12` Driver accepted the load in the app; `Today 08:41` Arrived at {from}; `Today 10:05` Bill of lading uploaded from the cab; `Today 10:06` "Invoice queued for billing" if delivered, otherwise "Dispatch notified the consignee" |

**Example A on the detail page:**
- Header: "Fresno, CA → Sparks, NV" / "Load L-40223 · Northgate Foods · Dispatched"
- KPIs: 478 · $2,450 ("$5.13 / mi") · Driver pay $612 · Margin $2,093
- Documents: Rate confirmation Attached; the other 4 Pending
- Activity: 2 rows

The top bar on any detail page shows `← Loads` plus the stub buttons "Message driver" (`ui-btn`) and "Update status" (`ui-btn ui-btn-primary`); neither has a click handler (`Header.tsx:34,58-61`).

**Porting recommendation.** In Runtruck2 every load is a DB row, so the "mock" branch is really seed-data presentation. To keep the eight seeded loads pixel-identical:
- Seed their stops, including the fuel stop, with the exact kind labels and window strings.
- Seed their documents and activity rows.
- Or keep an explicit `legacy_presentation` flag. This is a decision to escalate; do not guess (see §15).
- Created loads must render the "created" branch.

---

## 13. Data contract for the backend

### Reads needed by the form

All reads are tenant-scoped, and each response is `{data, meta}`. Each list must be ordered as in §5, so the seed order or an explicit sort key must reproduce the mock order.

| Endpoint (suggested) | Fields | Permission |
|---|---|---|
| `GET /api/v1/customers` | `id` (uuid), `name`, `defaultPaymentTerms` | `customers.view` |
| `GET /api/v1/carriers` | `id`, `name`, `mcNumber` ("MC 604117"), `dotNumber` ("DOT 1780342"), `isOwnFleet`. The own authority must be available too: name "Sunridge Freight (own fleet)", MC 812044, DOT 2291176. It belongs to the organization record, not the partner list | `carriers.view` |
| `GET /api/v1/drivers` | `id`, `name`, `status` label, `defaultTruck {id, unitNumber}` | `drivers.view` |
| `GET /api/v1/trucks` | `id`, `unitNumber`, `status` label | `trucks.view` |
| `GET /api/v1/trailers` | `id`, `unitNumber`, `kind` label ("Reefer · 53 ft") | `trailers.view` |
| `GET /api/v1/me` (or session) | `user.name` (dispatcher default), `organization.shortName` ("Sunridge", for the Carrier help text) | authenticated |
| Static enums | modes, equipment, packaging, freight classes, LTL services, terms, document types | shared constants in `packages/types`/`packages/validation`, or a lookup endpoint |

### Write: `POST /api/v1/loads` (permission `loads.create`; plus `loads.assign` when a driver/truck/trailer is set)

- **Body:** the whole Draft, validated by one **shared Zod schema** (`packages/validation`) on both client and API.
  - Use ids for customer, billTo customer, partner carrier, driver, truck and trailer (own fleet).
  - Use free-text `carrierDriverName` / `carrierTruckNumber` / `carrierTrailerNumber` for brokered loads.
  - Money as decimal strings or integer cents.
  - Stops as an ordered array with `kind`, facility, address parts, `date` (YYYY-MM-DD), `windowOpen`/`windowClose` (HH:MM), `number`, `contact`.
- **The server computes and stores:**
  - `id` (UUID) and the org-scoped **load number** (`L-40223` for the seed)
  - `status` (Dispatched vs. Needs driver; map to the lifecycle, §15)
  - `totalCharges`, `cost`, `margin`, `ratePerMile`
  - origin = first Pickup, destination = last Delivery
  - `created_at` (UTC), `created_by`, `organization_id` (taken from the session, never from the body)
- **Side effects:**
  - inserts into `loads` and `load_stops` (plus a rates/charges table if designed)
  - document metadata rows plus object-storage keys for attached files (§21 of the architecture)
  - `audit_logs` entries `LOAD_CREATED`, plus `LOAD_ASSIGNED` if a driver is set
  - domain events `LoadCreated`, plus `LoadAssigned`/`LoadDispatched` when covered
- **Response:** `{data: LoadDetail, meta: {}}`. The client then routes to `/app/loads/{loadNumber}` (or the UUID; see §15).
- **Errors:**
  - `VALIDATION_ERROR` with issue paths that the client maps back to the same Section and message strings in §7, so badges and Review render identically.
  - `FORBIDDEN`, and `NOT_FOUND` for foreign or unknown reference ids.
  - `CONFLICT` for load-number races.

### Read: `GET /api/v1/loads/:id` (`loads.view`)

It must supply every field the detail, list, dashboard and planner render:
- the display strings in §9, or the raw values for the client to format identically
- `mode`, `ltl` pieces, ordered `stops[]` (name, address with ZIP, date, window)
- `documents[]` (type, fileName, attached?)
- `carrierRate`
- `notes` (driver instructions)
- `createdAt` (UTC ISO)
- `createdBy.name`
- `activity[]` (from the audit/event log)

`GET /api/v1/loads` (list, dashboard, planner) must return created loads **newest first, ahead of the older ones**, so ordering matches `[...created, ...LOADS]`.

---

## 14. Porting hazards (Next.js App Router)

1. **Client component.** NewLoadDialog uses `useState`, `useRef`, `useEffect`, `window.confirm` and `HTMLDialogElement.showModal`, so it needs `'use client'`. It mounts only after a click, so there is no SSR issue. Keep the `if (!el.open)` guard: the App Router dev build runs StrictMode double effects.
2. **Dialog placement.** Render the `<dialog>` **inside the `.ui-shell` subtree** (inside the top bar), not portaled to `document.body`. Otherwise it loses Inter/14px and the `.ui-shell` h2 and focus-ring overrides, and falls back to Barlow 15px.
3. **Native `<dialog>` events.** React 19 supports `onClose`/`onCancel`. Recent Chrome close-watcher rules may make a **second Escape uncancelable** (no user activation between presses), so the dialog could close without the confirm. This behaves the same as the prototype, but test it.
4. **Router APIs.**
   - Header: `useLocation` becomes `usePathname`, and `useNavigate()(…)` becomes `useRouter().push(…)`.
   - The route `loads/:id` becomes `app/app/loads/[id]/page.tsx`, reading `params.id`. In Next 15 `params` is a Promise in server components; client pages use `useParams()`.
   - Header matching lowercases the pathname, but ids do not match case-insensitively (`/app/loads/l-40223` falls back to `loads[0]`).
5. **Shell-level state.** `useAppShell` (the context holding `loads`, `addLoad`) must become server data (fetch plus cache invalidation after POST, e.g. `router.refresh()` or a query-cache invalidate) so the Loads page, Dashboard, Planner and EventDialog see the new load. `nextId` must not run on the client.
6. **Clock.** `new Date()` for `createdAt` and the `Today HH:MM` string must move to the server as a UTC timestamp, formatted client-side in the user's timezone after hydration. Otherwise SSR and client output differ (hydration mismatch). The prototype's "today" is pinned to 2026-09-03 elsewhere, but createdAt uses the real clock.
7. **Number formatting.** `toLocaleString('en-US')` is deterministic in Node with full ICU (the default), so SSR and client match.
8. **CSS.** Import `industry.css`, `app.css`, `shell.css`, `calendar.css` **in this order** in the root `layout.tsx`, because the cascade depends on it (for example `.ui-shell h2` overrides industry `h2 {font-size:32px; margin…}`; `.ui-p` overrides `p {margin}`). `:has()` is used by `.ui-stop` (detail page) and must be supported by target browsers.
9. **Fonts.** `index.html` loads Google Fonts via `<link>`: Barlow 400/500/700, Barlow Condensed 400/600, Inter 400/500/600/700, `display=swap`. CSS refers to them by literal family name (`"Inter"`). `next/font` would rename the family and add size-adjusted fallbacks, which changes metrics. Either keep the `<link>` in the root layout `<head>`, or use `next/font` with a CSS variable and update shell.css, accepting tiny metric differences.
10. **Theme.** The theme is read from localStorage by an inline script in `index.html` before paint. The dialog colours depend on `data-theme`. Reproduce it with an inline `<script>` in the root layout `<head>` plus `suppressHydrationWarning` on `<html>`.
11. **File inputs.** File objects cannot travel in the JSON body. Use multipart or presigned uploads after the load is created (or a staged upload), then link. The prototype has one click and no progress state, so decide the UX for upload failure.
12. **Async create.** The prototype's create is synchronous. With a network round trip, guard double-clicks on "Create load" (disable while pending plus an idempotency key), and add somewhere to show non-validation API errors (the prototype has none). Both are unavoidable small UI additions; flag them.
13. **Draft initial value.** `INITIAL.dispatcher` depends on the session user. Build the initial draft once per mount and compare `dirty` against that same object.

---

## 15. Bugs, inconsistencies and architecture conflicts

**Data loss**
1. **Many entered fields are silently dropped** by `toLoad` (NewLoadDialog.tsx:138-194): billTo, terms, PO (except as fallback), dispatcher, fuel, accessorials, pieces, declared value, **hazmat and UN number**, NMFC, dimensions, stackable, carrier contact and phone, stop `number` and `contact`, internal notes, and the document files. This conflicts with Rule 1. Runtruck2 must persist them.
2. **Documents store only a file name** (line 649). Nothing is uploaded, yet the detail page shows "Attached". This conflicts with §21 (object storage plus metadata plus permission checks).

**Business logic**

3. **Margin mixes bases.** Margin = (line haul + fuel + accessorials) − cost (lines 145, 166, 290, 621), but the detail page shows only "Line haul" next to it. Example A shows $2,450 and $612 next to Margin $2,093, which does not visibly add up. The mock loads' margins are also inconsistent (L-40218 has rate $2,450, pay $612 and margin $1,214; mock.ts:95-96). The backend must own the definitions (§5: authoritative financial calculations are not frontend).
4. **Status rule is client-side.** Brokered loads become "Dispatched" even with no driver or truck (line 148). The status strings do not map to the architecture lifecycle (DRAFT → BOOKED → DISPATCHED…, §17/§18), and `docs/08-load-lifecycle.md` does not exist yet. Needs a decision: probably "Needs driver" = BOOKED and "Dispatched" = DISPATCHED, via the state machine with audit.
5. **No availability checks** on driver, truck or trailer (lines 569-583). Home-time drivers, in-shop trucks and busy drivers are all assignable. This conflicts with Rule 5 and §19. Enforcing it changes behaviour for those options, so decide whether to reject or warn.
6. **Load id generated client-side** as max+1 (line 196-198). This is racy and not tenant-scoped. The architecture wants UUID ids (§8) and warns against exposing sequential ids. **Conflict to escalate:** a human "load number" (`L-40223`) is needed for identical UI and URLs (`/app/loads/L-40223`). Recommend a UUID PK plus an org-scoped unique `load_number`; the URL uses the load number (identical) or the UUID (URL differs).

**Validation gaps**

7. Negative amounts are possible. `min=0` is not enforced (no `<form>`), so `-50` fuel reduces the total. Weight and line haul are only checked `> 0`, and money allows 3-decimal values (`money(2450.555)` shows `$2,450.555`). The server should validate ≥0 and store integer cents.
8. The stop date-order check compares only adjacent stops and ignores times. Windows allow closes-before-opens. Past dates are allowed.

**Presentation inconsistencies**

9. Review "Route" uses **positional** first and last stops and raw city (line 693). The saved route uses the first *Pickup* and last *Delivery* (lines 141-142). They differ when stop kinds are reordered, and they differ in the state suffix.
10. Bill to is auto-filled with the first customer picked and **not updated** when the customer changes (line 306). This can silently bill the wrong customer. Terms are overwritten on every customer change, even after a manual edit.

**Time and date**

11. `createdAt` is a frozen `"Today HH:MM"` string from browser local time (line 192). It stays "Today" forever and has no timezone. This conflicts with §9 (store UTC). There is no defined format for other days, so decide one (e.g. `Sep 4 14:05`).
12. Stop dates lose the year (`shortDate`, lines 129-132). The planner then assumes 2026 (planner.ts:156), so a 2027 pickup lands in 2026. Stop windows are facility-local times with no timezone, which §9 forbids "when timezone matters". Decide: store date plus local time plus the facility IANA timezone, or UTC instants.
13. Planner ignores single-sided windows: `'06:00'` and `'Any time'` both become 08:00–09:00 (planner.ts:158). `cityState` strips only 5-digit ZIPs.

**Detail page**

14. **Wrong creator.** "Load created by {USER.name}" uses the **current viewer** (LoadDetailPage.tsx:47), not the creator. Use `created_by` from the load or audit log.
15. **Unknown ids fall back silently.** An unknown or mis-cased load id shows `loads[0]` instead of Not found (LoadDetailPage.tsx:12). Runtruck2 should return `NOT_FOUND` and show a not-found state; this is a small behaviour change to flag.

**Other issues**

16. **Tenant name hard-coded** in UI copy: "Haul it with the Sunridge fleet…" (line 506). The own carrier is `CARRIERS[0]` by array position (lines 147, 519, 534, 695). In Runtruck2 it must come from the organization.
17. **Document re-attach quirk.** Removing a document does not reset the `<input type=file>`, so re-choosing the same file fires no `change` and the row stays "Not attached". In Chrome, cancelling the picker on an input that already holds a file clears it (fires `change` with no file), which sets the name to `''`.
18. **LTL services order** is click order, not list order (line 486), and it shows in the saved `ltl` string.
19. **Index keys** (`key={i}`) on removable stop panels (line 346). Harmless for controlled inputs, but focus can jump when a middle stop is removed.
20. **No permission gating.** "+ New Load" is always shown. In Runtruck2 hide or disable it without `loads.create`, and require `loads.assign` for create-with-driver. That is a visible difference only for users without the permission.
21. **Missing documentation.** `docs/03-database.md`, `04-api.md`, `07-roles-permissions.md` and `08-load-lifecycle.md` are referenced by the architecture (§7, §48) but **do not exist** in Runtruck2. Table and column names and the status enum for this feature must not be invented silently (§7: "Claude must not invent database structures that contradict that document"). Escalate them to the user.
