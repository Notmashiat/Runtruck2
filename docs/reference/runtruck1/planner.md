# Planner — port specification (Runtruck1 → Runtruck2)

Area: the `/app/planner` screen (day / week / month calendar), its event popover, the Add/Edit event dialog, the Customize dialog, the planner data module, the calendar date helpers, the localStorage persistence hook and `calendar.css`.

Reference root: `Runtruck1/app/` (Vite + React 19 + react-router-dom v7, mock data, "today" pinned to `2026-09-03`).

> **Weekday warning.** `2026-09-03` is a **Thursday** in the real Gregorian calendar, and the planner computes weekdays with real `Date` objects. It therefore renders "Thursday, September 3, 2026" and marks the **Thu** column as today. The orchestrator brief says "Wed 2026-09-03". The Wednesday assumption only exists elsewhere in the mock data (`mock.ts:332` `REVENUE_DAYS` ends in `'Wed'`). The port must render **Thursday** to match the prototype. See §15, item B1.

---

## 1. Files covered

| File | Lines | Role |
|---|---|---|
| `app/src/pages/app/PlannerPage.tsx` | 568 | Page, `TimeGrid` (day/week), `MonthGrid`, `EventPopover`, `useDismiss`, occurrence expansion, overlap layout, colour logic, revive functions |
| `app/src/components/EventDialog.tsx` | 132 | Add / Edit event modal (native `<dialog>`) |
| `app/src/components/CalendarSettings.tsx` | 221 | "Customize" modal (Layout / Color codes / Event cards pages) |
| `app/src/data/planner.ts` | 180 | Types, constants, default prefs/categories, seed events, `loadEvents()` (load-derived stops), `cityState()` |
| `app/src/lib/dates.ts` | 58 | Local-time date helpers, `formatTime`, `shortLabel` |
| `app/src/lib/persist.ts` | 24 | `usePersisted` (useState + localStorage) |
| `app/src/styles/calendar.css` | 165 | All `cal-*` styles, tone classes `t-*`, dialog form tweaks |

Context files I read completely for dependencies (owned by other areas): `src/main.tsx` (19), `src/App.tsx` (81), `src/context/AppShellContext.tsx` (51), `src/lib/search.ts` (10), `src/data/mock.ts` (332), `src/styles/shell.css` (332), `src/styles/app.css` (88), `src/components/AppLayout.tsx` (20), `src/components/Header.tsx` (87), `src/components/Sidebar.tsx` (55), `src/lib/theme.ts` (31), `index.html`. I also read `src/components/NewLoadDialog.tsx` lines 120–200 (the `toLoad` stop format that feeds `loadEvents`) and `src/styles/industry.css` global element rules (lines 60–135).

---

## 2. Route, shell, and global dependencies

- The route is `/app/planner` (`App.tsx:37`), rendered inside `AppLayout`: `<div.ui-shell> <Sidebar/> <div.ui-column> <Header/> <main.ui-main> <Outlet/>`.
- `main.ui-main` is `flex:1; overflow-y:auto; padding:20px 24px 32px; display:flex; flex-direction:column; gap:20px`. `PlannerPage` returns a **fragment**, so its three blocks (`.cal-toolbar`, `.cal-legend`, `.cal`) are direct flex children, 20px apart. `.cal-legend` has `margin-top:-6px`, which makes the toolbar-to-legend gap 14px. The popover (`position:fixed`) and the `<dialog>`s are also children of `main` but take no layout space.
- Header on this route (`Header.tsx`): search input only (`placeholder="Search"`, `aria-label="Search"`). There is **no Filters button** (`NO_FILTERS` includes `'planner'`) and **no header actions** (`actionsFor` has no `planner` key). The search text is `useAppShell().query`, and the planner filters its events with it. Clicking any sidebar link resets the query to `''`.
- `useAppShell()` supplies `loads` (`[...createdInMemory, ...LOADS]`, with New-Load loads newest first) and `query`.
- CSS load order (`main.tsx`): `industry.css`, `app.css`, `shell.css`, `calendar.css`, all global. Global rules that matter here:
  - `industry.css`: `*{box-sizing:border-box}`; `body{font-size:15px;line-height:1.55}`; `h1..h6{font-family:var(--font-heading);line-height:1.12;letter-spacing:-0.015em;margin:0 0 var(--space-2)}`; `h2{font-size:32px}`; `h3{font-size:25px}`; `p{margin:0 0 var(--space-3)}`; `:focus{outline:none}`; `:focus-visible{outline:2px solid var(--color-accent);outline-offset:2px}`.
  - `app.css`: `h1..h6{margin:0}`.
  - `shell.css`: `.ui-shell{font-family:"Inter",system-ui,sans-serif;font-size:14px}`; `.ui-shell h1..h6{font-family:inherit;letter-spacing:-0.01em}`; `.ui-shell a{color:var(--ui-primary)}`; `.ui-shell :focus-visible{outline-color:var(--ui-primary)}`.
  - Line-height is inherited as `1.55` everywhere unless overridden.
- Fonts come from Google Fonts (`index.html`): Inter 400/500/600/700, plus Barlow and Barlow Condensed for marketing.
- Theme: `<html data-theme="light|dark">`, set by an inline script in `index.html` from `localStorage['runtruck-theme']` before first paint. The tone classes `t-pink`, `t-orange`, `t-indigo` and `t-slate` have explicit dark overrides keyed on `:root[data-theme="dark"]`. The other tones follow the `--ui-*` tokens.

---

## 3. Domain model and mock data (`data/planner.ts`)

### 3.1 Constants

- `TODAY = '2026-09-03'` (`planner.ts:7`). `YEAR = 2026` (private, `planner.ts:8`, used for parsing load dates).
- `TONES = ['amber','green','red','purple','blue','teal','pink','orange','indigo','slate']` (order matters: default value colours, the palette order, and the first free tone for new codes).
- `ROW_H = { Compact: 40, Comfortable: 56, Spacious: 76 }` gives px per hour.
- `CARD_FIELDS` (order = `<option>` order): `['place','City, state']`, `['category','Color code name']`, `['time','Time']`, `['load','Load #']`, `['driver','Driver']`, `['truck','Truck / trailer']`, `['customer','Customer']`, `['facility','Facility']`, `['commodity','Commodity']`, `['title','Event title']`, `['none','Nothing']`.
- `DEFAULT_PREFS = { view:'Week', weekStart:1, showWeekends:true, dayStart:6, dayEnd:20, density:'Comfortable', hour24:false, hidden:[], colorBy:'type', valueTones:{}, cardLines:['place','time','load'] }`.

### 3.2 Types

```ts
interface Category { key: string; label: string; tone: string; locked?: boolean }
interface PlannerEvent {
  id: string; title: string; category: string /* Category.key */; date: string /* YYYY-MM-DD */;
  endDate?: string /* all-day span end, inclusive */; start?: string /* 'HH:MM' */; end?: string /* 'HH:MM' */;
  place?: string /* 'City, ST' */; notes?: string; people?: string[]; loadId?: string /* 'L-40218' */;
  facility?: string; customer?: string; driver?: string; truck?: string; commodity?: string;
  readOnly?: boolean /* true = derived from a load */;
}
type CalView = 'Day'|'Week'|'Month'; type Density = 'Compact'|'Comfortable'|'Spacious';
type ColorBy = 'type'|'driver'|'customer'|'truck';
type CardField = 'place'|'title'|'category'|'time'|'load'|'driver'|'truck'|'customer'|'facility'|'commodity'|'none';
interface Prefs { view; weekStart: number /*0 Sun|1 Mon*/; showWeekends: boolean; dayStart: number /*0-23*/; dayEnd: number /*1-24*/;
  density; hour24: boolean; hidden: string[]; colorBy; valueTones: Record<string,string>; cardLines: CardField[] /* always 3 */ }
```

An event is **all-day** when `start` is falsy. The `end` field is ignored for all-day events, and `endDate` is ignored for timed events.

### 3.3 `DEFAULT_CATEGORIES` ("color codes"), in order

| # | key | label | tone | locked |
|---|---|---|---|---|
| 1 | `pickup` | `Loaded (pickup)` | amber | true |
| 2 | `delivery` | `Empty (delivery)` | green | true |
| 3 | `maintenance` | `Maintenance` | red | – |
| 4 | `driver` | `Driver schedule` | purple | – |
| 5 | `meeting` | `Meetings` | blue | – |
| 6 | `admin` | `Billing & admin` | teal | – |

Locked codes are fed by the load board. They cannot be deleted and cannot be chosen for user events, but they can be renamed and recoloured.

### 3.4 Seed user events `PLANNER_EVENTS` (42 events = 27 standups + 15)

**STANDUPS** (`planner.ts:116-125`): one per weekday from `2026-08-24` to `2026-09-30`, skipping `2026-09-07`. That gives 27 dates: Aug 24–28, Aug 31–Sep 4, Sep 8–11, Sep 14–18, Sep 21–25, Sep 28–30. Each standup is `{ id:'standup-<date>', title:'Dispatch standup', category:'meeting', date, start:'08:00', end:'08:30', notes:'Board review: uncovered loads, HOS, delays.', people:['Rosa Medina','Luis Ortega','Evan Brooks'] }`.

The 15 named events:

| id | title | cat | date | endDate | start–end | notes | people |
|---|---|---|---|---|---|---|---|
| ev-1 | `Tobias Frey — home time` | driver | 2026-09-01 | 2026-09-06 | all-day | `Back on duty Mon Sep 7.` | Tobias Frey |
| ev-2 | `T-118 in shop — turbo` | maintenance | 2026-09-02 | 2026-09-05 | all-day | `Sunridge shop · Modesto. Parts from Valley Diesel & Turbo.` | – |
| ev-3 | `Payroll review — week of Sep 1` | admin | 2026-09-01 | – | 10:00–11:00 | `Approve driver settlements before Friday.` | Rosa Medina |
| ev-4 | `Invoice batch B-2034 review` | admin | 2026-09-02 | – | 14:00–15:00 | – | Rosa Medina |
| ev-5 | `FB-12 DOT annual inspection` | maintenance | 2026-09-03 | – | 13:00–15:00 | `Sunridge shop · Modesto.` | Luis Ortega |
| ev-6 | `Road test — Sofia Nguyen` | driver | 2026-09-04 | – | 10:00–11:30 | `In T-103. Luis Ortega evaluates.` | Sofia Nguyen, Luis Ortega |
| ev-7 | `T-114 PM service A` | maintenance | 2026-09-05 | – | 07:00–09:00 | `Due at 529,800 mi.` | Luis Ortega |
| ev-8 | `Labor Day — office closed` | admin | 2026-09-07 | – | all-day | – | – |
| ev-9 | `Orientation — Jamal Reed` | driver | 2026-09-08 | – | 09:00–12:00 | `Paperwork, ELD training, yard walk.` | Jamal Reed, Rosa Medina |
| ev-10 | `Safety meeting — HOS refresher` | meeting | 2026-09-08 | – | 13:00–14:00 | – | Rosa Medina, Marcus Hale, Dara Whitfield, Ellis Nakamura, Priya Raman, Ana Cortez |
| ev-11 | `Northgate Foods quarterly review` | meeting | 2026-09-09 | – | 11:00–12:00 | `With Dana Ruiz. On-time 96%, lane pricing for Q4.` | Rosa Medina, Dana Ruiz |
| ev-12 | `IFTA Q3 prep` | admin | 2026-09-10 | – | 15:00–16:00 | – | – |
| ev-13 | `Sierra Ag collections call` | admin | 2026-09-11 | – | 09:30–10:30 | `INV-8836, 41 days past due.` | Rosa Medina, Ben Okafor |
| ev-14 | `Marcus Hale — Clearinghouse query due` | driver | 2026-09-20 | – | all-day | – | Marcus Hale |
| ev-15 | `Ana Cortez — MVR & annual review due` | driver | 2026-09-24 | – | all-day | – | Ana Cortez |

None of the seed events has `place`, `loadId`, `facility`, `customer`, `truck` or `commodity`.

User events per category (used in delete-confirm messages): meeting **29** (27 standups + ev-10 + ev-11), driver **5**, admin **5**, maintenance **3**.

### 3.5 Load-derived events: `loadEvents(loads)` (`planner.ts:147-180`)

The function runs on every render over **all** loads. Every event it returns carries this shared block:

```
loadId: l.id, customer: l.customer, driver: l.driver, truck: l.unit === '—' ? '' : l.unit,
commodity: l.commodity, people: [l.driver], readOnly: true
```

**Branch A: the load has `stops`** (only loads created with New Load, which live in memory). For each stop `s` at index `i`:
- Split `s.when` on `' · '` into `[day, window='']`, then `date = shortToIso(day, 2026)`. If `date` is null, the stop is skipped.
- If `window` contains `'–'` (en dash), split it into `[start, end]`. Otherwise use `['08:00','09:00']`. The end is `end || start`.
- `place = cityState(s.address)`.
- The event is `{ id:'load:<id>:<i>', title:'<id> · <place>', category: s.kind==='Pickup' ? 'pickup' : 'delivery', date, start, end, place, facility: s.name, notes: '<s.name> · <l.customer>' }`.
- New Load writes `when` as `'<Mon> <d> · <from>–<to>'`, `'<Mon> <d> · <from|to>'` or `'<Mon> <d> · Any time'`, and `address` as `'<street>, <City>, <ST> <zip>'` (`NewLoadDialog.tsx:183-188`).

**Branch B: mock loads without `stops`.** Times are synthesized from the load number:

```
n = Number(l.id.slice(2)) || 0            // 'L-40218' → 40218
pHour = 6 + (n % 7) * 1.5                 // pickup start hour (fractional .5 → ':30')
dHour = 7 + ((n * 3) % 8) * 1.5           // delivery start hour
hhmm(h) = pad2(floor(h)) + ':' + (h % 1 ? '30' : '00')
[fromPlace, toPlace] = l.route.split(' → ')
pickup  (if shortToIso(l.pickup,2026)):  { id:'load:<id>:p', title:'<id> · <fromPlace>', category:'pickup',   date, start:hhmm(pHour), end:hhmm(pHour+2), place:fromPlace, facility:l.from, notes:'<l.from> · <l.customer>' }
delivery(if shortToIso(l.delivery,2026)):{ id:'load:<id>:d', title:'<id> · <toPlace>',   category:'delivery', date, start:hhmm(dHour), end:hhmm(dHour+2), place:toPlace,   facility:l.to,   notes:'<l.to> · <l.customer>' }
```

The 16 derived events for the 8 mock loads, in `all` order (loads order, pickup before delivery):

| id | date | start–end | title | place | facility | customer | driver | truck | commodity |
|---|---|---|---|---|---|---|---|---|---|
| load:L-40218:p | 2026-09-03 | 10:30–12:30 | L-40218 · Fresno, CA | Fresno, CA | Northgate Cold Storage | Northgate Foods | Marcus Hale | T-114 / RF-88 | Frozen produce |
| load:L-40218:d | 2026-09-04 | 16:00–18:00 | L-40218 · Reno, NV | Reno, NV | Reno Grocers DC | Northgate Foods | Marcus Hale | T-114 / RF-88 | Frozen produce |
| load:L-40219:p | 2026-09-03 | 12:00–14:00 | L-40219 · Stockton, CA | Stockton, CA | Bayline DC 4 | Bayline Distribution | Dara Whitfield | T-107 / DV-51 | Palletized dry goods |
| load:L-40219:d | 2026-09-05 | 08:30–10:30 | L-40219 · Salt Lake City, UT | Salt Lake City, UT | Wasatch Crossdock | Bayline Distribution | Dara Whitfield | T-107 / DV-51 | Palletized dry goods |
| load:L-40220:p | 2026-09-02 | 13:30–15:30 | L-40220 · Sacramento, CA | Sacramento, CA | Cascade Yard 2 | Cascade Building Supply | Ellis Nakamura | T-121 / FB-12 | Lumber |
| load:L-40220:d | 2026-09-04 | 13:00–15:00 | L-40220 · Boise, ID | Boise, ID | Boise Builders Depot | Cascade Building Supply | Ellis Nakamura | T-121 / FB-12 | Lumber |
| load:L-40221:p | 2026-09-04 | 15:00–17:00 | L-40221 · Oakland, CA | Oakland, CA | Port of Oakland, Berth 22 | Harbor Point Retail | Unassigned | `''` | Consumer goods |
| load:L-40221:d | 2026-09-06 | 17:30–19:30 | L-40221 · Portland, OR | Portland, OR | Harbor Point DC | Harbor Point Retail | Unassigned | `''` | Consumer goods |
| load:L-40214:p | 2026-09-01 | 15:00–17:00 | L-40214 · Bakersfield, CA | Bakersfield, CA | Northgate Creamery | Northgate Foods | Priya Raman | T-103 / RF-27 | Dairy |
| load:L-40214:d | 2026-09-02 | 10:00–12:00 | L-40214 · Phoenix, AZ | Phoenix, AZ | Valley Foods DC | Northgate Foods | Priya Raman | T-103 / RF-27 | Dairy |
| load:L-40212:p | 2026-08-31 | 12:00–14:00 | L-40212 · Los Angeles, CA | Los Angeles, CA | Bayline LA Annex | Bayline Distribution | Marcus Hale | T-114 / DV-88 | Beverages |
| load:L-40212:d | 2026-09-01 | 13:00–15:00 | L-40212 · Las Vegas, NV | Las Vegas, NV | Sunset Beverage DC | Bayline Distribution | Marcus Hale | T-114 / DV-88 | Beverages |
| load:L-40210:p | 2026-08-29 | 09:00–11:00 | L-40210 · Modesto, CA | Modesto, CA | Sierra Ag Huller 3 | Sierra Ag Partners | Tobias Frey | T-118 / DV-14 | Almonds |
| load:L-40210:d | 2026-09-01 | 16:00–18:00 | L-40210 · Denver, CO | Denver, CO | Front Range Foods | Sierra Ag Partners | Tobias Frey | T-118 / DV-14 | Almonds |
| load:L-40222:p | 2026-09-05 | 06:00–08:00 | L-40222 · Redding, CA | Redding, CA | Cascade Mill | Cascade Building Supply | Ana Cortez | T-109 / FB-04 | Steel coil |
| load:L-40222:d | 2026-09-06 | 10:00–12:00 | L-40222 · Seattle, WA | Seattle, WA | Duwamish Steel Yard | Cascade Building Supply | Ana Cortez | T-109 / FB-04 | Steel coil |

`notes` is `'<facility> · <customer>'` for every row. `people` is `[driver]`. Every row has `readOnly: true`.

`cityState(address)` (`planner.ts:102-105`): strip a trailing ` 12345` or ` 12345-6789` zip, split on `,`, trim, drop empties, and join the last two parts with `', '`. For example, `'1855 E Greg St, Sparks, NV 89431'` becomes `'Sparks, NV'`.

**Combined list:** `all = [...events (user, persisted), ...loadEvents(loads)]`, which is 42 + 16 = 58 with defaults.

---

## 4. Date helpers (`lib/dates.ts`): exact semantics

All dates are `'YYYY-MM-DD'` strings. `Date` objects are always built in **local** time, so there are no timezone shifts.
- `MONTHS` holds the full English month names. `WEEKDAYS` runs `Sunday`…`Saturday` (index = `getDay()`).
- `iso(d)` returns `YYYY-MM-DD` from local getters. `fromIso(s)` returns `new Date(y, m-1, d)`.
- `addDays(d,n)` returns `new Date(y, m, d+n)`, which is DST-safe.
- `addMonths(d,n)` returns `new Date(y, m+n, **1**)` and **always lands on the 1st**.
- `startOfWeek(d, ws)` returns `addDays(d, -((d.getDay() - ws + 7) % 7))`.
- `shortToIso('Sep 3', 2026)` returns `'2026-09-03'`. The month is matched by **prefix** (`MONTHS.findIndex(x => x.startsWith(mon))`). It returns null when there is no month or the day is not > 0.
- `toMinutes('HH:MM')` returns `h*60 + (m||0)`, and `toMinutes('')` returns `0`. `toHhmm(min)` returns `pad(floor(min/60)%24):pad(min%60)`.
- `formatTime(min, hour24)`: in 24h mode it returns `HH:MM`. In 12h mode it returns `'<h12> AM|PM'` when the minutes are 0 and `'<h12>:<mm> AM|PM'` otherwise, where `h12 = h%12 || 12` and `AM` means `h<12`. Examples: 480→`8 AM`, 510→`8:30 AM`, 720→`12 PM`, 0→`12 AM`, 1050 (24h)→`17:30`.
- `shortLabel(d)` returns `'<Ddd>, <Mmm> <d>'`, for example `Thu, Sep 3`.

---

## 5. Planner page (`PlannerPage.tsx`)

### 5.1 State

| State | Init | Kind (port classification) |
|---|---|---|
| `prefs` via `usePersisted('runtruck-planner-prefs', DEFAULT_PREFS, revivePrefs)` | localStorage or defaults | (b) presentation prefs. Recommended: server-side per-user preference (§11.5); browser storage is allowed |
| `events` via `usePersisted('runtruck-planner-events', PLANNER_EVENTS, reviveEvents)` | localStorage or 42 seed events | **(a) business data → PostgreSQL** |
| `categories` via `usePersisted('runtruck-planner-categories', DEFAULT_CATEGORIES, reviveCategories)` | localStorage or 6 defaults | **(a) business/tenant config → PostgreSQL** |
| `cursor: Date` | `fromIso(TODAY)` (not persisted; resets to Sep 3 on every mount) | (b) |
| `selected: {o: Occurrence, x, y} \| null` (popover) | null | (b) |
| `editing: {ev, isNew} \| null` (EventDialog) | null | (b) (the draft; the save goes to the API) |
| `settings: 'Layout' \| 'Color codes' \| 'Event cards' \| null` | null | (b) |
| `loads`, `query` from `useAppShell` | – | loads = (a) served by the loads API; query = (b) |

`pref(key, value)` does a shallow merge into prefs, which persists immediately.

### 5.2 DOM tree

```
<>
  div.cal-toolbar
    div.cal-badge > span{monthName.slice(0,3)} + strong{cursor.getDate()}
    div[style="min-width:0"] > div.cal-title{title} + (range && div.cal-range{range})
    div[style="flex:1"]
    div.cal-nav > button.ui-btn[aria-label="Previous <view lower>"]{‹}  button.ui-btn{Today}  button.ui-btn[aria-label="Next <view lower>"]{›}
    div.ui-filter[role=group][aria-label=View] > button.ui-filter-opt(.is-active){Day|Week|Month}
    button.ui-btn{Customize}
    button.ui-btn.ui-btn-primary{+ Add Event}
  div.cal-legend
    button.cal-legend-item(.is-off)[aria-pressed=on] > span.cal-dot.t-<tone> + label   (one per legend entry)
    button.ui-link.cal-legend-edit{Edit colors}
  view==='Month' ? <MonthGrid/> : <TimeGrid/>
  selected && <EventPopover/>
  editing && <EventDialog/>
  settings && <CalendarSettings/>
</>
```

Glyphs: `‹` is U+2039, `›` is U+203A, the time-range dash is the en dash U+2013 with spaces around it, `·` is U+00B7, `—` is U+2014, and the close button is `×` U+00D7. The `aria-label`s are `Previous day`, `Next week`, `Previous month` and so on (`view.toLowerCase()`).

### 5.3 Toolbar texts

- Badge: first 3 letters of the month name, uppercased by CSS (`SEP`), above the day of month (`3`).
- `title`:
  - Day view: `` `${WEEKDAYS[day]}, ${MonthName} ${date}, ${year}` `` gives **`Thursday, September 3, 2026`**.
  - Week and Month views: `` `${MonthName} ${year}` `` gives `September 2026`. This is the cursor's month, even when the visible week straddles two months.
- `range`:
  - Week: `` `${shortLabel(days[0])} – ${shortLabel(days[last])}` ``. Default: **`Mon, Aug 31 – Sun, Sep 6`**. With weekends hidden: `Mon, Aug 31 – Fri, Sep 4`. With the week starting Sunday: `Sun, Aug 30 – Sat, Sep 5`.
  - Month: `` `${n} events this month` ``, where `n = shown.filter(e => e.date.startsWith(iso(cursor).slice(0,7))).length`. This counts **start dates only**, over the filtered list (hidden codes and search applied), load events included. There is no singular form. Default Sep 2026 = **`50 events this month`** (Aug 2026 = 8, Oct 2026 = 0).
  - Day: `''`, and the `.cal-range` div is not rendered.
- View switch: `Day` / `Week` / `Month`. The active option has `.is-active`.

### 5.4 Toolbar interactions

| Control | Effect |
|---|---|
| `‹` / `›` | `setSelected(null)`. The cursor moves by ±1 day (Day), ±7 days (Week) or `addMonths(±1)` (Month, **which sets the day to 1**) |
| `Today` | cursor = `2026-09-03`, `setSelected(null)` |
| `Day` / `Week` / `Month` | `pref('view', v)` (**persisted**), `setSelected(null)` |
| `Customize` | `setSettings('Layout')` |
| `+ Add Event` | `create(iso(cursor))`: a new event on the **cursor date** at 09:00–10:00 |
| Legend chip | Toggles `c.key` in `prefs.hidden` (persisted). An off chip gets `.is-off`: line-through, muted text, dot opacity .35 |
| `Edit colors` | `setSettings('Color codes')` |

`create(date, startMin?)` does `setSelected(null)`, then `s = startMin ?? 540` and `category = first unlocked category key ?? 'meeting'`. It then opens EventDialog with `isNew:true` and `ev = { id:'ev-'+Date.now(), title:'', category, date, start:toHhmm(s), end:toHhmm(min(s+60, 1425 /*23:45*/)) }`.

`openDay(d)` sets cursor = d, `pref('view','Day')` (persisted) and `setSelected(null)`.

### 5.5 Colour logic ("Look")

```
byValue   = prefs.colorBy !== 'type'
valueOf(ev, by) = (by==='driver'?ev.driver : by==='customer'?ev.customer : by==='truck'?ev.truck : '')  → if falsy or 'Unassigned' → 'Unassigned'
values    = byValue ? [...new Set(all.filter(e=>e.readOnly).map(e=>valueOf(e,colorBy)))].sort() : []   // from ALL events, not the shown ones
valueTone(v) = prefs.valueTones[`${colorBy}:${v}`] ?? TONES[values.indexOf(v) % 10]
colorKey(ev) = byValue && ev.readOnly ? `${colorBy}:${valueOf(ev)}` : ev.category      // key used by hidden[]
tone(ev)     = byValue && ev.readOnly ? valueTone(valueOf(ev)) : (catOf.get(ev.category)?.tone ?? 'slate')
```

User events always use their category tone. Load events use the category tone in `type` mode and the value tone otherwise.

Default value tones (sorted with JS default sort, then indexed into TONES):
- **driver**: Ana Cortez amber, Dara Whitfield green, Ellis Nakamura red, Marcus Hale purple, Priya Raman blue, Tobias Frey teal, Unassigned pink.
- **customer**: Bayline Distribution amber, Cascade Building Supply green, Harbor Point Retail red, Northgate Foods purple, Sierra Ag Partners blue.
- **truck** (the value is the full unit string, truck + trailer): T-103 / RF-27 amber, T-107 / DV-51 green, T-109 / FB-04 red, T-114 / DV-88 purple, T-114 / RF-88 blue, T-118 / DV-14 teal, T-121 / FB-12 pink, Unassigned orange.

Colours are not guaranteed unique against the categories (for example, Marcus Hale is purple, the same as Driver schedule).

**Legend entries:**
- `type` mode: every category in order: `Loaded (pickup)` amber, `Empty (delivery)` green, `Maintenance` red, `Driver schedule` purple, `Meetings` blue, `Billing & admin` teal.
- Value mode: the **unlocked** categories (Maintenance, Driver schedule, Meetings, Billing & admin), then one chip per value (key `driver:Ana Cortez`, and so on; label = value; tone = `valueTone`).
- The legend is always followed by the `Edit colors` link.

**Card lines** (`look.lines(o)`) with `[first, ...rest] = prefs.cardLines`:

```
field(f): place→ev.place | title→ev.title | category→catOf(ev.category)?.label ?? 'Uncategorized'
        | time→ o.allDay ? 'All day' : `${time(o.start)} – ${time(o.end)}` | load→ev.loadId
        | driver→ev.driver ?? ev.people?.[0] | truck→ev.truck | customer | facility | commodity | none→''   (undefined → '')
lines = [ field(first) || ev.title, ...rest.map(field).filter(Boolean) ]
```

With the defaults (`place,time,load`), a load stop gives `['Fresno, CA','10:30 AM – 12:30 PM','L-40218']`. A seed event has no place, so it falls back to its title: `['Dispatch standup','8 AM – 8:30 AM']`. The `load` line disappears for events without `loadId`. The `driver` field shows `Unassigned` for L-40221 stops, while `truck` is `''` there and is filtered out.

### 5.6 Filtering (`shown`)

```
shown = all.filter(e => !prefs.hidden.includes(colorKey(e))
                      && matchesQuery({ title, place, notes, people: people?.join(' '), customer, truck }, query))
```

`matchesQuery` (in `search.ts`) trims and lowercases the query. An empty query matches everything. Otherwise an event matches when any string or number field in the object contains the query (the `tagClass` key is skipped). That makes `loadId` searchable only through the title, facility through the notes, and the driver through `people`. Commodity is **not** searchable. The hidden keys and the search affect both grids and the Month count, but not `values`, the legend or the Event-cards sample.

### 5.7 Occurrence expansion: `occurrencesOn(events, date)`

- Timed events (with `start`) appear on `date === ev.date` only.
- All-day events appear on every date with `ev.date <= date <= (ev.endDate ?? ev.date)`, using string comparison.
- An occurrence is `{ev, date, start, end, allDay}`:
  - Timed: `start = toMinutes(ev.start)`, `end = max(toMinutes(ev.end ?? ev.start), start + 15)` (minimum 15 minutes).
  - All-day: `start = 0`, `end = 1440`.
- Sort order: all-day first, then `start` ascending, then `end` **descending**. The sort is stable, so ties keep `all` order (user events before load events).

### 5.8 TimeGrid (Day and Week views)

**Columns:**
- Day view: `[cursor]`.
- Week view: 7 days from `startOfWeek(cursor, weekStart)`. When `!showWeekends`, days with `getDay()` 0 or 6 are removed.
- `onOpenDay` is passed only in Week view, so only Week-view headers are buttons.

**Geometry:** `rowH = ROW_H[density]`, `visStart = dayStart*60`, `visEnd = dayEnd*60`, `hours = [dayStart .. dayEnd-1]`, `cols = {gridTemplateColumns: '64px repeat(N, minmax(0, 1fr))'}`.

```
div.cal
  div.cal-scroll (ref; max-height: max(420px, calc(100vh - 300px)); overflow:auto)
    div.cal-sticky (position:sticky; top:0; z-index:3)
      div.cal-head[style=cols] > div(empty 64px gutter) + per day: div.cal-head-cell >
          (Week) button.cal-head-btn(.is-today) | (Day) div.cal-head-btn(.is-today)
             > span.cal-head-num{d.getDate()} + span.cal-head-day{WEEKDAYS[d].slice(0,3)}
      hasAllDay && div.cal-allday[style=cols] > div.cal-gutter-label{All day} + per day div.cal-allday-cell
             > button.cal-chip.t-<tone> {lines[0]}  (one per all-day occurrence that day; onClick → select)
    div.cal-body[style: cols; height: hours.length*rowH px; --cal-row: <rowH>px]
      div.cal-gutter > per hour div.cal-hour[style=height:rowH]{ h > dayStart ? time(h*60) : (nothing) }
      per day div.cal-col(.is-today)[onClick=clickSlot]
         > per laid-out timed occurrence: button.cal-ev.t-<tone>[style top/height/left/width][title=lines.join(' · ')]
              > span.cal-ev-title{lines[0]} + lines.slice(1, fit).map(span.cal-ev-line)
```

- `hasAllDay` is true when any visible day has at least one all-day occurrence after filtering. Otherwise the whole all-day row is omitted.
- Multi-day all-day events render as a **separate chip on each day**; there is no spanning bar. The chip text is `lines[0]`.
- The first hour row has no label: it renders empty, so the CSS `:empty` rule applies and there is no transform. The other labels sit `translateY(-7px)` so they straddle the hour line.
- Hour lines come from the `.cal-col` background `repeating-linear-gradient`: a 1px line in `--ui-row` at the bottom of every `--cal-row`.
- Today column: `.cal-col.is-today` gets a background of `color-mix(primary-soft 35%)`. The header gets `.cal-head-btn.is-today`, which uses the primary-soft background and primary-hover text.

**Timed events rendered in a column:** `byDay[i]` filtered to `!allDay && end > visStart && start < visEnd`, then passed through `layout()`.

**Overlap layout** (`layout(occ)`, `PlannerPage.tsx:47-74`), fed with timed occurrences in sorted order:

```
out=[]; cluster=[]; laneEnds=[]; clusterEnd=-1
for o in occ:
  if o.start >= clusterEnd: flush(); clusterEnd = -1        // flush: every item in cluster gets lanes = laneEnds.length
  lane = first index with laneEnds[idx] <= o.start, else append new lane
  laneEnds[lane] = o.end; cluster.push({o,lane}); clusterEnd = max(clusterEnd, o.end)
flush()
```

Lanes are shared by a whole transitive-overlap cluster. Touching events (`start == previous end`) start a new cluster. The layout uses unclipped times.

**Card geometry:**

```
top    = ((max(start, visStart) - visStart) / 60) * rowH                         (px)
height = max(((min(end, visEnd) - max(start, visStart)) / 60) * rowH - 3, 20)  (px)
left   = calc(<lane/lanes*100>% + 3px); width = calc(<100/lanes>% - 6px)
fit    = max(1, floor((height - 8) / 16))   → shows lines[0] + lines[1 .. fit-1]
```

At 56px/hour, a 30-minute card is 25px tall and fits 1 line, a 1-hour card is 53px and fits 2, a 1.5-hour card is 81px and fits 4, and a 2-hour card is 109px and fits 6.

**Initial scroll** (`PlannerPage.tsx:350-353`):

```
firstStart = min(...timed occurrences in range with end > visStart → start, 480)
scrollTop  = max(0, ((firstStart - visStart)/60)*rowH - 12)
```

- The effect runs on mount and whenever `[firstStart, visStart, rowH, days.length]` changes. Navigating to another week with the same `firstStart` does **not** re-scroll.
- `scrollTo` is instant.
- Default Week: firstStart = 360 (L-40222 pickup, Sat 06:00), so scrollTop = **0**.
- Day Sep 3: firstStart = 480, so scrollTop = **100**.
- Week with weekends hidden: firstStart = 480, so scrollTop = 100.

**Click to create** (`clickSlot`): this handler acts only when `e.target === e.currentTarget`, meaning the empty column background. It computes `y = clientY - col.getBoundingClientRect().top` and calls `onCreate(date, min(visStart + floor(y/rowH*2)*30, visEnd - 30))`. The start snaps to 30 minutes and the new event lasts one hour.

### 5.9 Default Week view snapshot (Aug 31 – Sep 6, rowH 56, 6 AM–8 PM, body height 14×56 = 784px)

All-day row (present):

| Day | Chips (tone · text) |
|---|---|
| Mon 31 | – |
| Tue 1 | purple · Tobias Frey — home time |
| Wed 2 | purple · Tobias Frey — home time; red · T-118 in shop — turbo |
| **Thu 3 (today)** | purple · Tobias Frey — home time; red · T-118 in shop — turbo |
| Fri 4 | purple · Tobias Frey — home time; red · T-118 in shop — turbo |
| Sat 5 | purple · Tobias Frey — home time; red · T-118 in shop — turbo |
| Sun 6 | purple · Tobias Frey — home time |

Timed cards (lane/lanes, top px, height px, the lines shown):

| Day | Event | lane | top | h | tone | Lines shown |
|---|---|---|---|---|---|---|
| Mon 31 | standup | 0/1 | 112 | 25 | blue | Dispatch standup |
| Mon 31 | load:L-40212:p | 0/1 | 336 | 109 | amber | Los Angeles, CA · 12 PM – 2 PM · L-40212 |
| Tue 1 | standup | 0/1 | 112 | 25 | blue | Dispatch standup |
| Tue 1 | ev-3 | 0/1 | 224 | 53 | teal | Payroll review — week of Sep 1 · 10 AM – 11 AM |
| Tue 1 | load:L-40212:d | 0/1 | 392 | 109 | green | Las Vegas, NV · 1 PM – 3 PM · L-40212 |
| Tue 1 | load:L-40214:p | 0/2 | 504 | 109 | amber | Bakersfield, CA · 3 PM – 5 PM · L-40214 |
| Tue 1 | load:L-40210:d | 1/2 | 560 | 109 | green | Denver, CO · 4 PM – 6 PM · L-40210 |
| Wed 2 | standup | 0/1 | 112 | 25 | blue | Dispatch standup |
| Wed 2 | load:L-40214:d | 0/1 | 224 | 109 | green | Phoenix, AZ · 10 AM – 12 PM · L-40214 |
| Wed 2 | load:L-40220:p | 0/2 | 420 | 109 | amber | Sacramento, CA · 1:30 PM – 3:30 PM · L-40220 |
| Wed 2 | ev-4 | 1/2 | 448 | 53 | teal | Invoice batch B-2034 review · 2 PM – 3 PM |
| Thu 3 | standup | 0/1 | 112 | 25 | blue | Dispatch standup |
| Thu 3 | load:L-40218:p | 0/2 | 252 | 109 | amber | Fresno, CA · 10:30 AM – 12:30 PM · L-40218 |
| Thu 3 | load:L-40219:p | 1/2 | 336 | 109 | amber | Stockton, CA · 12 PM – 2 PM · L-40219 |
| Thu 3 | ev-5 | 0/2 | 392 | 109 | red | FB-12 DOT annual inspection · 1 PM – 3 PM |
| Fri 4 | standup | 0/1 | 112 | 25 | blue | Dispatch standup |
| Fri 4 | ev-6 | 0/1 | 224 | 81 | purple | Road test — Sofia Nguyen · 10 AM – 11:30 AM |
| Fri 4 | load:L-40220:d | 0/1 | 392 | 109 | green | Boise, ID · 1 PM – 3 PM · L-40220 |
| Fri 4 | load:L-40221:p | 0/2 | 504 | 109 | amber | Oakland, CA · 3 PM – 5 PM · L-40221 |
| Fri 4 | load:L-40218:d | 1/2 | 560 | 109 | green | Reno, NV · 4 PM – 6 PM · L-40218 |
| Sat 5 | load:L-40222:p | 0/2 | 0 | 109 | amber | Redding, CA · 6 AM – 8 AM · L-40222 |
| Sat 5 | ev-7 | 1/2 | 56 | 109 | red | T-114 PM service A · 7 AM – 9 AM |
| Sat 5 | load:L-40219:d | 0/2 | 140 | 109 | green | Salt Lake City, UT · 8:30 AM – 10:30 AM · L-40219 |
| Sun 6 | load:L-40222:d | 0/1 | 224 | 109 | green | Seattle, WA · 10 AM – 12 PM · L-40222 |
| Sun 6 | load:L-40221:d | 0/1 | 644 | 109 | green | Portland, OR · 5:30 PM – 7:30 PM · L-40221 |

Day view (Sep 3) shows the same Thu column as a single full-width column with no header button.

### 5.10 MonthGrid

```
div.cal
  div.cal-month-head[style=cols] > per day of weeks[0]: div{WEEKDAYS[d].slice(0,3)}   (uppercased by CSS: MON TUE …)
  per week: div.cal-month-row[style=cols] > per day:
     div.cal-month-cell(.is-other if other month)[onClick: if target===currentTarget → onCreate(date) (09:00–10:00)]
        button.cal-month-num(.is-today){d.getDate()}   → onOpenDay(d)
        first 3 occurrences: button.cal-month-ev.t-<tone> > span.cal-dot.t-<tone> + (!allDay && span.cal-month-time{time(start)}) + span.cal-month-title{lines[0]}
        list.length > 3 && button.ui-link.cal-more{`+${list.length-3} more`} → onOpenDay(d)
```

- `cols = repeat(weeks[0].length || 7, minmax(0,1fr))`, with no gutter column.
- Weeks: start at `startOfWeek(first of month, weekStart)` and step 7 days while `w.getMonth() === month || w < first`. Each week is filtered by `showWeekends`. Sep 2026 with Monday start gives 5 rows: Aug 31–Oct 4.
- There is no scroll container. The grid grows to its natural height (`min-height:118px` per cell).
- Other-month cells get the `--ui-expand` background, with the day number muted.
- Other-month cells still show events and still accept clicks.

Default Sep 2026 cells (with MAX = 3, the first three occurrences are listed in order):

| Date | n | Shown (tone · [time] text) | more |
|---|---|---|---|
| Aug 31 (other) | 2 | blue 8 AM Dispatch standup; amber 12 PM Los Angeles, CA | – |
| Sep 1 | 6 | purple Tobias Frey — home time; blue 8 AM Dispatch standup; teal 10 AM Payroll review — week of Sep 1 | +3 more |
| Sep 2 | 6 | purple Tobias Frey — home time; red T-118 in shop — turbo; blue 8 AM Dispatch standup | +3 more |
| Sep 3 (today) | 6 | same as Sep 2 | +3 more |
| Sep 4 | 7 | same as Sep 2 | +4 more |
| Sep 5 | 5 | purple Tobias Frey…; red T-118 in shop…; amber 6 AM Redding, CA | +2 more |
| Sep 6 | 3 | purple Tobias Frey…; green 10 AM Seattle, WA; green 5:30 PM Portland, OR | – |
| Sep 7 | 1 | teal Labor Day — office closed | – |
| Sep 8 | 3 | blue 8 AM Dispatch standup; purple 9 AM Orientation — Jamal Reed; blue 1 PM Safety meeting — HOS refresher | – |
| Sep 9 | 2 | blue 8 AM Dispatch standup; blue 11 AM Northgate Foods quarterly review | – |
| Sep 10 | 2 | blue 8 AM Dispatch standup; teal 3 PM IFTA Q3 prep | – |
| Sep 11 | 2 | blue 8 AM Dispatch standup; teal 9:30 AM Sierra Ag collections call | – |
| Sep 14–18, 21–23, 25, 28–30 | 1 each | blue 8 AM Dispatch standup | – |
| Sep 20 | 1 | purple Marcus Hale — Clearinghouse query due | – |
| Sep 24 | 2 | purple Ana Cortez — MVR & annual review due; blue 8 AM Dispatch standup | – |
| Sep 12, 13, 19, 26, 27, Oct 1–4 | 0 | – | – |

### 5.11 EventPopover

- Opened by `select(o, e)`, which calls `e.stopPropagation()` and then `setSelected({o, x:e.clientX, y:e.clientY})`. It is triggered by any event card, chip or month row.
- Position: `position:fixed; left = max(12, min(x+12, innerWidth-352)); top = max(12, min(y-20, innerHeight-360))`. The position is computed at render and does not follow scrolling. A keyboard-activated click has clientX/Y = 0, which puts the popover at 12,12.
- It closes on a document `pointerdown` outside the popover, on `Escape`, on navigation, on a view change, or on Today (`useDismiss`, `PlannerPage.tsx:487-504`). A pointerdown on another card closes it, and the following click reopens it for that card. A pointerdown on an empty slot closes it, and the click then opens the Add dialog.

```
div.cal-pop[role=dialog][aria-label=lines[0]][style=left,top]
  div.cal-pop-title > span.cal-dot.is-ring.t-<tone> + lines[0]
  div.cal-pop-meta > span{shortLabel(occurrence date)} + span{ allDay ? (endDate ? `Until ${shortLabel(endDate)}` : 'All day') : `${time(start)} – ${time(end)}` }
  div.cal-pop-kind{ (category?.label ?? 'Uncategorized') + (loadId ? ` · ${loadId}` : '') }     ← CSS uppercase
  details.length>0 && dl.cal-pop-details > per [k,v]: div > dt{k} + dd{v}
       rows (only truthy): ['City, state', place], ['Facility', facility], ['Customer', customer], ['Truck', truck], ['Commodity', commodity]
  ev.notes && !ev.readOnly && p.cal-pop-notes{notes}
  people.length>0 && div.cal-people > first 3: span.cal-avatar[title=name]{initials} + span.cal-people-text{ people.length>3 ? `+${n-3} more` : people.join(', ') }
       people = ev.people.filter(p => p && p !== 'Unassigned'); initials = name.split(' ').map(w=>w[0]).join('').slice(0,2)
  div.cal-pop-actions
       ev.loadId && Link.ui-btn.ui-btn-sm → /app/loads/<loadId> {`Open load ${loadId}`}
       !ev.readOnly && button.ui-btn.ui-btn-sm{Edit} + button.ui-btn.ui-btn-sm{Delete}
  ev.readOnly && div.cal-pop-hint{From the load board — change it on the load.}
```

- The meta date is the **clicked occurrence's** date (for example `Thu, Sep 3` for ev-1 clicked on Sep 3), paired with `Until Sun, Sep 6`.
- **Edit** calls `setEditing({ev, isNew:false})` and `setSelected(null)`.
- **Delete** removes the event by id **immediately**, with no confirmation, and closes the popover.

Examples:

- **L-40218 pickup:**
  - Title: `Fresno, CA`.
  - Meta: `Thu, Sep 3` and `10:30 AM – 12:30 PM`.
  - Kind: `LOADED (PICKUP) · L-40218`.
  - Details: City, state `Fresno, CA`; Facility `Northgate Cold Storage`; Customer `Northgate Foods`; Truck `T-114 / RF-88`; Commodity `Frozen produce`.
  - People: `MH` + `Marcus Hale`.
  - Actions: button `Open load L-40218`.
  - Hint shown.
- **ev-10:**
  - Title: `Safety meeting — HOS refresher`.
  - Meta: `Tue, Sep 8` and `1 PM – 2 PM`.
  - Kind: `MEETINGS`.
  - No details and no notes.
  - People: avatars `RM`, `MH`, `DW` with the text `+3 more` (names are not listed).
  - Actions: Edit and Delete.
- **L-40221 stops:** no Truck row, and no people row (`Unassigned` is filtered out).

### 5.12 Empty states

There is no dedicated empty state:
- When there are no events, the grids render empty.
- The all-day row is omitted when there are no all-day occurrences.
- The Month count reads `0 events this month`.
- In value mode with no loads, Settings shows the `<Noun> colors` heading over an empty bordered `.cal-codes` box.
- The Event-cards preview falls back to `{lines:['Fresno, CA'], tone:'amber'}` only when `all` is empty.

---

## 6. EventDialog (`components/EventDialog.tsx`)

- Native `<dialog class="ui-dialog is-form" aria-label="Add event|Edit event" onClose={onClose}>`. A `useEffect` calls `showModal()` if the dialog is not already open (the guard covers StrictMode double effects).
- It closes through `ref.current.close()` (from ×, Cancel, Save or Delete) or through the native Escape key. Either way the `close` event fires and the parent sets `editing = null`.
- Clicking the backdrop does nothing.
- Local state: `e` (a copy of the event), `allDay = !event.start`, and `tried = false`.

```
dialog.ui-dialog.is-form
  div.ui-dialog-main
    section.ui-dialog-body
      button.ui-dialog-close[aria-label=Close]{×}
      h2.ui-h2[style=margin:0]{Add event | Edit event}
      div.ui-form-grid   (2 cols; 1 col under 760px)
        label.ui-field.is-wide(.is-invalid if tried&&badTitle) > span.ui-field-label{Title <span.ui-req>*</span>} + input.ui-input[autoFocus]{title}
        label.ui-field > span{Color code} + select.ui-input{ categories.filter(c => !c.locked || c.key === e.category) → option[value=key]{label} }
        label.ui-field(.is-invalid if tried&&badDate) > span{Date <span.ui-req>*</span>} + input.ui-input[type=date]{date}
        div.ui-field.is-wide > label.ui-check > input[type=checkbox]{allDay} + "All day"
        allDay ?
          label.ui-field(.is-invalid) > span{Until (optional)} + input.ui-input[type=date][min=date]{endDate ?? ''} (+ tried&&badEnd: span.ui-field-error{Must be on or after the start date})
        :
          label.ui-field > span{Starts} + input.ui-input[type=time][step=900]{start}
          label.ui-field(.is-invalid) > span{Ends} + input.ui-input[type=time][step=900]{end} (+ span.ui-field-error{Must be after the start})
        label.ui-field > span{City, state} + input.ui-input[placeholder="e.g. Modesto, CA"]{place ?? ''}
        label.ui-field > span{Related load} + select.ui-input > option[value=""]{None} + loads.map(option[value=id]{`${id} · ${route}`})
        label.ui-field.is-wide > span{People (comma-separated)} + input.ui-input{(people ?? []).join(', ')}
        label.ui-field.is-wide > span{Notes} + textarea.ui-input{notes ?? ''}
    footer.ui-dialog-foot
      !isNew && button.ui-btn{Delete}
      div[style=flex:1]
      button.ui-btn{Cancel}
      button.ui-btn.ui-btn-primary{Add event | Save}
```

**Grid placement:**
- Timed: [Title wide] / [Color code | Date] / [All day wide] / [Starts | Ends] / [City, state | Related load] / [People wide] / [Notes wide].
- All-day: [Title] / [Color code | Date] / [All day] / [Until | City, state] / [Related load | empty] / [People] / [Notes].

**Derived values and validation:**
- `start = e.start ?? '09:00'` and `end = e.end ?? '10:00'`. These defaults apply when an all-day event is toggled to timed.
- `badTitle = !e.title.trim()`.
- `badDate = !e.date`.
- `badEnd = allDay ? (e.endDate && e.endDate < e.date) : toMinutes(end) <= toMinutes(start)`.

Only `badEnd` shows a message. Title and Date only get a red border. Nothing is flagged until the first failed Save (`tried`); after that, the flags update live.

**Input behaviour:**
- `place` is set raw.
- `loadId` is set to the value or `undefined`.
- `notes` is set to the value or `undefined`, and is **not trimmed**.
- `people` is set to `value.split(',').map(trimStart)`, so typing `A,` displays `A, `.
- `endDate` is set to the value or `undefined`.

**Save** (runs only when all three checks pass):

```
onSave({ ...e, title: e.title.trim(), place: e.place?.trim() || undefined,
         start: allDay ? undefined : start, end: allDay ? undefined : end,
         endDate: allDay && e.endDate && e.endDate > e.date ? e.endDate : undefined,   // equal → dropped
         people: e.people?.map(p => p.trim()).filter(Boolean) })
then close()
```

The parent appends the event when `isNew`, and otherwise replaces it by id. **Delete** (edit only) calls `onDelete()` and closes, with **no confirmation**.

- **Add** from the toolbar or a slot: the category defaults to the first unlocked code (`maintenance` with the defaults), the date comes from the slot or cursor, and the time is 09:00–10:00 (toolbar and Month) or the snapped slot +1h.
- **Edit**: the fields are pre-filled from the event.

---

## 7. CalendarSettings ("Customize", `components/CalendarSettings.tsx`)

- Native `<dialog class="ui-dialog" aria-label="Customize calendar" onClose={p.onClose}>`, opened with `showModal()` in a `useEffect` (guarded).
- It holds its own `page` state, initialized from the prop (`Layout` from Customize, `Color codes` from Edit colors).
- **Every change applies live.** There is no Save or Cancel. It closes via × or Escape.

```
dialog.ui-dialog
  aside.ui-dialog-nav > div.ui-dialog-title{Customize} + button.ui-dialog-nav-item(.is-active){Layout|Color codes|Event cards}
  section.ui-dialog-body > button.ui-dialog-close[aria-label=Close]{×} + <page>
```

`Choice` renders `div.ui-filter > button.ui-filter-opt(.is-active when value===v)` (keyed by label). `Row` renders `div.ui-setting(.is-stacked) > div > div.ui-setting-name{label} + (help && div.ui-setting-help{help})`, followed by the control.

### 7.1 Layout page

- `h2.ui-h2[margin:0]{Layout}`, then a `<div>` containing these Rows:
  1. `Week starts on`: Choice `[0,'Sun'],[1,'Mon']` sets `weekStart`.
  2. `Weekends`: `[true,'Show'],[false,'Hide']` sets `showWeekends`.
  3. `Time format`: `[false,'12h'],[true,'24h']` sets `hour24`.
  4. `Row height`, help `How tall an hour is in Day and Week views.`: `['Compact','S'],['Comfortable','M'],['Spacious','L']` sets `density`.
  5. `Day starts`: `select.ui-input.cal-menu-select`. Options are hours 0–23 labelled `formatTime(h*60, hour24)` (`12 AM`…`11 PM`, or `00:00`…`23:00`). onChange sets `dayStart = min(v, dayEnd-1)`.
  6. `Day ends`: options are hours 1–24 labelled `formatTime` except 24, which is **`Midnight`** in both formats. onChange sets `dayEnd = max(v, dayStart+1)`.
  7. `Reset calendar`, help `Layout, color codes and card lines back to the defaults, and the original events restored.`: `button.ui-btn.ui-btn-sm{Reset}`.
     - It asks `window.confirm('Reset the calendar? Color codes, layout and card settings go back to the defaults, and events you added or edited are removed.')`.
     - If confirmed, it runs `setPrefs(DEFAULT_PREFS)` (which also resets the view to Week and clears hidden), `setEvents(PLANNER_EVENTS)` and `setCategories(DEFAULT_CATEGORIES)`.

### 7.2 Color codes page

- A `<div>` containing `h2{Color codes}` and `p.ui-p[margin-top:4px]{Decide what each color stands for. Rename, recolor, add or delete them.}`.
- `Row stacked` `Color load stops by`, help `Stop type uses the Loaded and Empty codes below; the others give each driver, customer or truck its own color.`: Choice `Stop type|Driver|Customer|Truck` (`type|driver|customer|truck`) sets `colorBy`.
- `div.cal-codes` holds one `div.cal-code(.is-muted when locked && byValue)` per category, in order:
  - `span.cal-dot.t-<tone>`.
  - `input.ui-input.cal-code-name[aria-label="Color code name"]{label}`. onChange updates the label live and the legend follows. onBlur changes a blank value to `Untitled`.
  - For a locked code: `span.cal-code-note`, reading `From the load board` in type mode or `'Not used while coloring by ' + driver|customer|truck` in value mode. For an unlocked code: `button.ui-link{Delete}` calling `onDeleteCategory(key)`.
  - `div.cal-palette[role=radiogroup][aria-label="Color for <label>"]` with 10 `button.cal-swatch.t-<tone>(.is-on)[role=radio][aria-checked][aria-label=<tone>][title=<tone>]`. Clicking one updates the tone.
- `button.ui-btn[align-self:flex-start]{+ Add color code}` appends `{key:'code-'+Date.now(), label:'New color code', tone: first TONE not used by any category ?? 'slate'}`. With the defaults, that tone is `pink`.
- Value mode only: `h3.cal-subhead{Driver colors|Customer colors|Truck colors}` followed by a `div.cal-codes` with one `div.cal-code` per value: dot, `span.cal-code-name.is-text{value}`, an empty `<span/>`, and a Palette. A pick sets `prefs.valueTones['<colorBy>:<value>'] = tone`.

**Delete a code** (`PlannerPage.tsx:163-175`):
- `fallback` is the first unlocked category other than the one being deleted.
- If there is none: `window.alert('Keep at least one color code for your own events.')`.
- Otherwise, `n` = the number of **user** events with that key, across all dates.
- If `n > 0`, it asks `window.confirm('Delete “<label>”? Its <n> event<s> move to “<fallback label>”.')` (curly quotes; `event` is singular when n = 1).
- When it proceeds, it reassigns those events to the fallback, removes the category, and removes the key from `hidden`.

Default messages:
- Maintenance: `…Its 3 events move to “Driver schedule”.`
- Driver schedule: `…5 events move to “Maintenance”.`
- Meetings: `…29 events move to “Maintenance”.`
- Billing & admin: `…5 events move to “Maintenance”.`
- A new code with 0 events is deleted silently.

### 7.3 Event cards page

- A `<div>` containing `h2{Event cards}` and `p.ui-p[margin-top:4px]{Choose what each card shows. By default a load stop leads with the city and state where the truck loads or goes empty.}`.
- `div.cal-cards-setup`, a grid of `minmax(0,1fr) 220px` that collapses to 1 column under 760px:
  - Left: `div.ui-form-grid[grid-template-columns:minmax(0,1fr)]` with one `label.ui-field` per `cardLines` entry (always 3).
    - The label is `First line (bold)` for line 0 and `Line 2` / `Line 3` for the others.
    - Each has a `select.ui-input` with the CARD_FIELDS options. Line 0 excludes `none`.
    - A change replaces index `i` in `cardLines`.
  - Right: `div.ui-label[margin-bottom:8px]{Preview}` above `div.cal-ev.cal-preview.t-<sample.tone>`, which contains `span.cal-ev-title{lines[0]}` and all remaining lines as `span.cal-ev-line` (no fit limit).
- `div.ui-note{Short cards show as many lines as fit. Month view shows the first line. When the first line is empty (an office event with no city, say) the card falls back to the event title.}`

**Sample:**
- `sampleEv = all.find(e => e.readOnly && e.category === 'pickup') ?? all[0]`, which is the first pickup of the first load in board order.
- Its occurrence is `occurrencesOn([sampleEv], sampleEv.date)[0]`, and the preview shows `look.lines(occ)` with `look.tone(ev)`.
- Default: `Fresno, CA` / `10:30 AM – 12:30 PM` / `L-40218`, amber (purple when colouring by driver, because of Marcus Hale).

---

## 8. Styles

### 8.1 `calendar.css` (verbatim; port unchanged as a global stylesheet)

```css
/* Planner calendar (day / week / month). Colours come from the shell.css
   tokens, so it follows light and dark mode. */

.cal-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
.cal-badge {
  width: 52px; height: 56px; flex: none; display: flex; flex-direction: column; align-items: center; justify-content: center;
  background: var(--ui-card); border: 1px solid var(--ui-border); border-radius: 12px;
}
.cal-badge span { font-size: 10px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ui-muted); }
.cal-badge strong { font-size: 18px; line-height: 1.2; }
.cal-title { font-size: 18px; font-weight: 700; }
.cal-range { margin-top: 2px; font-size: 13px; color: var(--ui-muted); }
.cal-nav { display: inline-flex; }
.cal-nav .ui-btn { border-radius: 0; }
.cal-nav .ui-btn:first-child { border-radius: 999px 0 0 999px; }
.cal-nav .ui-btn:last-child { border-radius: 0 999px 999px 0; }
.cal-nav .ui-btn + .ui-btn { margin-left: -1px; }

.cal-legend { display: flex; flex-wrap: wrap; gap: 8px; margin-top: -6px; }
.cal-legend-item {
  display: inline-flex; align-items: center; gap: 8px; padding: 5px 12px;
  font: inherit; font-size: 12px; font-weight: 600; color: var(--ui-text-2);
  background: var(--ui-card); border: 1px solid var(--ui-border); border-radius: 999px; cursor: pointer;
}
.cal-legend-item.is-off { color: var(--ui-muted); background: transparent; text-decoration: line-through; }
.cal-legend-item.is-off .cal-dot { opacity: 0.35; }

/* category colours: --c is the accent, --c-soft the fill */
.t-amber { --c: var(--ui-amber); --c-soft: var(--ui-amber-soft); }
.t-green { --c: var(--ui-green); --c-soft: var(--ui-green-soft); }
.t-red { --c: var(--ui-red); --c-soft: var(--ui-red-soft); }
.t-purple { --c: var(--ui-purple); --c-soft: var(--ui-purple-soft); }
.t-blue { --c: var(--ui-primary); --c-soft: var(--ui-primary-soft); }
.t-teal { --c: var(--ui-teal); --c-soft: var(--ui-teal-soft); }
.t-pink { --c: #be185d; --c-soft: #fde7f1; }
.t-orange { --c: #c2410c; --c-soft: #ffedd5; }
.t-indigo { --c: #4338ca; --c-soft: #e6e7fe; }
.t-slate { --c: #475569; --c-soft: #e8ecf1; }
:root[data-theme="dark"] .t-pink { --c: #f78fc0; --c-soft: #3a1829; }
:root[data-theme="dark"] .t-orange { --c: #fb9b5f; --c-soft: #3a2413; }
:root[data-theme="dark"] .t-indigo { --c: #a5b0ff; --c-soft: #232650; }
:root[data-theme="dark"] .t-slate { --c: #aab6c6; --c-soft: #26303d; }
.cal-dot { width: 8px; height: 8px; flex: none; border-radius: 999px; background: var(--c); }
.cal-dot.is-ring { width: 10px; height: 10px; background: transparent; border: 2px solid var(--c); }

.cal { background: var(--ui-card); border: 1px solid var(--ui-border); border-radius: 16px; overflow: hidden; }
.cal-scroll { max-height: max(420px, calc(100vh - 300px)); overflow: auto; }
/* day headers and the all-day row stay pinned while the hours scroll */
.cal-sticky { position: sticky; top: 0; z-index: 3; background: var(--ui-card); }
.cal-head { display: grid; border-bottom: 1px solid var(--ui-border); }
.cal-head-cell { padding: 8px 6px; border-left: 1px solid var(--ui-border); }
.cal-head-btn {
  width: 100%; display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 6px 0;
  font: inherit; color: var(--ui-text); background: transparent; border: 0; border-radius: 10px;
}
button.cal-head-btn { cursor: pointer; }
button.cal-head-btn:hover { background: var(--ui-hover); }
.cal-head-btn.is-today { background: var(--ui-primary-soft); color: var(--ui-primary-hover); }
.cal-head-num { font-size: 18px; font-weight: 700; line-height: 1.1; }
.cal-head-day { font-size: 12px; color: var(--ui-muted); }
.cal-head-btn.is-today .cal-head-day { color: inherit; }

.cal-allday { display: grid; border-bottom: 1px solid var(--ui-border); }
.cal-gutter-label { padding: 8px 8px 0 0; text-align: right; font-size: 11px; color: var(--ui-muted); }
.cal-allday-cell { display: flex; flex-direction: column; gap: 3px; min-width: 0; padding: 5px 4px; border-left: 1px solid var(--ui-border); }
.cal-chip {
  overflow: hidden; padding: 3px 8px; text-align: left; white-space: nowrap; text-overflow: ellipsis;
  font: inherit; font-size: 12px; font-weight: 600; color: var(--ui-text);
  background: var(--c-soft); border: 1px solid color-mix(in srgb, var(--c) 45%, transparent); border-radius: 7px; cursor: pointer;
}

.cal-body { position: relative; display: grid; }
.cal-hour { padding-right: 8px; text-align: right; font-size: 11px; color: var(--ui-muted); }
.cal-hour:not(:empty) { transform: translateY(-7px); }
.cal-col {
  position: relative; min-width: 0; cursor: cell; border-left: 1px solid var(--ui-border);
  background-image: repeating-linear-gradient(to bottom, transparent 0, transparent calc(var(--cal-row) - 1px), var(--ui-row) calc(var(--cal-row) - 1px), var(--ui-row) var(--cal-row));
}
.cal-col.is-today { background-color: color-mix(in srgb, var(--ui-primary-soft) 35%, transparent); }
.cal-ev {
  position: absolute; z-index: 1; display: flex; flex-direction: column; gap: 2px; overflow: hidden;
  padding: 4px 8px; text-align: left; font: inherit; color: var(--ui-text); cursor: pointer;
  background: var(--c-soft); border: 1px solid color-mix(in srgb, var(--c) 55%, transparent); border-left: 3px solid var(--c); border-radius: 8px;
}
.cal-ev:hover, .cal-chip:hover { box-shadow: 0 2px 8px var(--ui-shadow); }
.cal-ev-title { font-size: 12px; font-weight: 600; line-height: 16px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cal-ev-line { font-size: 11px; line-height: 14px; color: var(--ui-text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.cal-month-head { display: grid; border-bottom: 1px solid var(--ui-border); }
.cal-month-head > div { padding: 10px; text-align: center; font-size: 12px; font-weight: 600; color: var(--ui-muted); text-transform: uppercase; letter-spacing: 0.04em; }
.cal-month-row { display: grid; }
.cal-month-row + .cal-month-row { border-top: 1px solid var(--ui-border); }
.cal-month-cell { min-width: 0; min-height: 118px; display: flex; flex-direction: column; gap: 3px; padding: 6px; cursor: cell; }
.cal-month-cell + .cal-month-cell { border-left: 1px solid var(--ui-border); }
.cal-month-cell.is-other { background: var(--ui-expand); }
.cal-month-cell.is-other .cal-month-num { color: var(--ui-muted); }
.cal-month-num {
  align-self: flex-start; min-width: 26px; height: 26px; padding: 0 6px; margin-bottom: 2px;
  font: inherit; font-size: 13px; font-weight: 600; color: var(--ui-text);
  background: transparent; border: 0; border-radius: 999px; cursor: pointer;
}
.cal-month-num:hover { background: var(--ui-hover); }
.cal-month-num.is-today { color: var(--ui-on-primary); background: var(--ui-primary); }
.cal-month-ev {
  display: flex; align-items: center; gap: 6px; min-width: 0; padding: 2px 6px; text-align: left;
  font: inherit; font-size: 12px; color: var(--ui-text); background: transparent; border: 0; border-radius: 6px; cursor: pointer;
}
.cal-month-ev:hover { background: var(--c-soft); }
.cal-month-time { flex: none; color: var(--ui-muted); font-variant-numeric: tabular-nums; }
.cal-month-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
.cal-more { align-self: flex-start; padding: 0 6px; font-size: 12px; }

.cal-pop, .cal-menu {
  z-index: 60; color: var(--ui-text); background: var(--ui-card); border: 1px solid var(--ui-border);
  border-radius: 14px; box-shadow: 0 16px 40px var(--ui-shadow);
}
.cal-pop { position: fixed; width: 320px; padding: 16px 18px; }
.cal-pop-title { display: flex; align-items: center; gap: 10px; font-size: 16px; font-weight: 700; }
.cal-pop-meta { display: flex; flex-wrap: wrap; gap: 6px 16px; margin-top: 10px; font-size: 13px; color: var(--ui-text-2); }
.cal-pop-kind { margin-top: 6px; font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--ui-muted); }
.cal-pop-notes { margin: 10px 0 0; font-size: 13px; line-height: 19px; color: var(--ui-text-2); }
.cal-people { display: flex; align-items: center; margin-top: 14px; }
.cal-avatar {
  width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center; margin-right: -6px;
  font-size: 11px; font-weight: 700; color: var(--ui-primary-hover); background: var(--ui-primary-soft);
  border: 2px solid var(--ui-card); border-radius: 999px;
}
.cal-people-text { margin-left: 14px; font-size: 13px; color: var(--ui-text-2); }
.cal-pop-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
.ui-shell .cal-pop-actions a.ui-btn { color: var(--ui-text-2); text-decoration: none; }
.cal-pop-hint { margin-top: 10px; font-size: 12px; color: var(--ui-muted); }

.cal-pop-details { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 4px 12px; margin: 12px 0 0; font-size: 13px; }
.cal-pop-details > div { display: contents; }
.cal-pop-details dt { color: var(--ui-muted); }
.cal-pop-details dd { margin: 0; font-weight: 600; }
.cal-legend-edit { align-self: center; margin-left: 4px; font-size: 12px; }

/* — Customize popup — */
.cal-menu-select { width: 130px; height: 32px; font-size: 13px; }
.cal-subhead { margin: 8px 0 0; font-size: 15px; font-weight: 700; }
.cal-codes { display: flex; flex-direction: column; border: 1px solid var(--ui-border); border-radius: 14px; }
.cal-code {
  display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 8px 12px; padding: 12px 14px;
}
.cal-code + .cal-code { border-top: 1px solid var(--ui-border); }
.cal-code.is-muted { opacity: 0.6; }
.cal-code .cal-palette { grid-column: 2 / -1; }
.cal-code-name { height: 34px; font-weight: 600; }
.cal-code-name.is-text { display: flex; align-items: center; font-size: 14px; }
.cal-code-note { font-size: 12px; color: var(--ui-muted); text-align: right; }
.cal-palette { display: flex; flex-wrap: wrap; gap: 6px; }
.cal-swatch {
  width: 22px; height: 22px; padding: 0; cursor: pointer;
  background: var(--c); border: 2px solid var(--ui-card); border-radius: 999px; box-shadow: 0 0 0 1px var(--ui-border);
}
.cal-swatch.is-on { box-shadow: 0 0 0 2px var(--ui-text); }
.cal-cards-setup { display: grid; grid-template-columns: minmax(0, 1fr) 220px; gap: 20px; align-items: start; }
@media (max-width: 760px) { .cal-cards-setup { grid-template-columns: minmax(0, 1fr); } }
.cal-ev.cal-preview { position: static; width: 100%; min-height: 80px; cursor: default; }

/* the add/edit event dialog: the form shell without a side menu */
.ui-dialog.is-form { width: min(640px, calc(100% - 48px)); min-height: 0; }
.ui-setting.is-stacked { flex-direction: column; align-items: flex-start; gap: 10px; }
.ui-setting.is-stacked .ui-setting-help { max-width: none; }
```

(`.cal-menu` is dead CSS: no element uses it.)

### 8.2 Tone palette (the resolved `--c` / `--c-soft`)

| tone | light `--c` / `--c-soft` | dark `--c` / `--c-soft` |
|---|---|---|
| amber | #a05a00 / #fff1d6 | #f2b45c / #3a2b12 |
| green | #167a3b / #dff5e6 | #5ccb86 / #12301d |
| red | #b42318 / #fdecea | #ff8a80 / #3a1c1a |
| purple | #6d3fd1 / #efe8fd | #b79bff / #2a2145 |
| blue (= primary) | #1e5eff / #dce6ff | #5b8bff / #1f2f52 |
| teal | #0f766e / #dcf5f1 | #5fd4c4 / #12302d |
| pink | #be185d / #fde7f1 | #f78fc0 / #3a1829 |
| orange | #c2410c / #ffedd5 | #fb9b5f / #3a2413 |
| indigo | #4338ca / #e6e7fe | #a5b0ff / #232650 |
| slate | #475569 / #e8ecf1 | #aab6c6 / #26303d |

### 8.3 `shell.css` classes used by this area (defined in shell.css, owned by the shell spec)

- Buttons and links: `ui-btn`, `ui-btn-primary`, `ui-btn-sm`, `ui-filter`, `ui-filter-opt`, `ui-link`.
- Text: `ui-h2`, `ui-p`, `ui-label`, `ui-note`.
- Dialogs: `ui-dialog`, `ui-dialog-main`, `ui-dialog-body`, `ui-dialog-foot`, `ui-dialog-close`, `ui-dialog-nav`, `ui-dialog-title`, `ui-dialog-nav-item`.
- Settings rows: `ui-setting`, `ui-setting-name`, `ui-setting-help`.
- Forms: `ui-form-grid`, `ui-field`, `ui-field-label`, `ui-field-error`, `ui-req`, `ui-input`, `ui-check`.
- Tokens: `--ui-*`.

Key values:
- `.ui-btn`: 36px tall, `padding:0 18px`, 14px/600, pill; `-sm` is 30px, `padding:0 14px`, 13px.
- `.ui-dialog`: `width:min(720px, calc(100% - 48px)); min-height:420px; max-height:90vh; border-radius:16px; display:flex when [open]`; `::backdrop` uses `--ui-overlay`.
- `.ui-dialog-body`: `padding:28px 32px; gap:20px; overflow-y:auto`.
- `.ui-dialog-nav`: 200px wide, `--ui-thead` background.
- `.ui-form-grid`: 2 columns with a `16px 18px` gap, and 1 column at ≤760px.
- `.ui-input`: 38px tall, radius 10px; `textarea.ui-input` has `min-height:96px`.

---

## 9. localStorage persistence (exactly what the prototype stores)

`usePersisted(key, fallback, revive)` (`persist.ts`):
- **Read:** once, in the `useState` initializer. It does `JSON.parse(localStorage.getItem(key))`, then `revive(parsed) ?? fallback`. A missing key or any exception gives the fallback.
- **Write:** in a `useEffect` on `[key, value]`, it runs `localStorage.setItem(key, JSON.stringify(value))`. This also happens **on first mount**, so defaults are written on the first visit. Errors are swallowed.

| Key | Content | Revive rule |
|---|---|---|
| `runtruck-planner-prefs` | The full `Prefs` object | Any non-null object is shallow-merged over `DEFAULT_PREFS`, with no type validation (`PlannerPage.tsx:85-87`) |
| `runtruck-planner-events` | **User events only** (a `PlannerEvent[]`; the load-derived events are never stored). 42 events initially | The array is accepted when every item has string `id` and `date`. Other fields are not validated (`:81-83`) |
| `runtruck-planner-categories` | `Category[]` | Every item needs string key, label and tone. The **locked defaults are forced first**: saved label and tone are merged over them and `locked:true` is forced. The saved non-locked items follow in their saved order with `locked:false` (`:90-95`) |
| (`runtruck-theme`, shell) | `'light'`/`'dark'` | Not in this area, but it drives the dark tone overrides |

These are not persisted: cursor, popover, editing draft, which settings page is open, and the search query (which lives in memory in the AppShell context).

**Port mapping:**
- `runtruck-planner-events` and `runtruck-planner-categories` are **business data and must move to PostgreSQL**.
- `runtruck-planner-prefs` is presentation. It may stay in the browser, but a server-side user preference is recommended so it follows the user.
- If prefs stay in localStorage, they must be read after hydration (see §14).

---

## 10. Data contract: what each screen reads

| UI element | Field(s) | Source (mock) | Display format |
|---|---|---|---|
| Badge | cursor | `TODAY` | `SEP` (CSS upper) / `3` |
| Title | cursor, view | `TODAY` | `Thursday, September 3, 2026` / `September 2026` |
| Range | days / shown events | computed | `Mon, Aug 31 – Sun, Sep 6` / `50 events this month` |
| Legend | categories (key, label, tone), values | `DEFAULT_CATEGORIES`, loads | dot + label chip |
| Week/Day header | dates | computed | `31` over `Mon` |
| All-day chip | lines[0], tone | events | ellipsized 12px/600 |
| Timed card | start, end, lines, tone | events + loads | `10:30 AM – 12:30 PM` (12h) / `10:30 – 12:30` (24h) |
| Hour gutter | hours | prefs | `7 AM` … `7 PM` (default, 6 AM unlabeled) |
| Month cell | occurrences | events + loads | `8 AM Dispatch standup`, `+3 more` |
| Popover | date, times, category label, loadId, place, facility, customer, truck, commodity, notes (user only), people | events + loads + categories | see §5.11 |
| EventDialog | event fields, categories, loads (id, route) | events, `DEFAULT_CATEGORIES`, `LOADS` | `L-40218 · Fresno, CA → Reno, NV` |
| Customize | prefs, categories, distinct values, sample | prefs, categories, loads | see §7 |

**Derived and computed values, and where they belong:**

| Computation | Formula (see section) | Default result | Authoritative → backend? |
|---|---|---|---|
| Load stop → calendar event (date, start/end, place, facility, customer, driver, truck, commodity) | §3.5 | 16 events | **Yes.** It must come from `load_stops` / appointments. The synthetic time formula is mock-only |
| `cityState(address)` | §3.5 | `Fresno, CA` | **Yes** (store the city and state on stop locations) |
| Event title for stops `'<load#> · <place>'`, notes `'<facility> · <customer>'` | §3.5 | – | Presentation; the client may compose these (used for search) |
| Validation (title, date, end > start, endDate ≥ date, locked codes not selectable) | §6 | – | **Yes** (Zod in the API, mirrored in the form) |
| Category delete → reassign events, count of affected events | §7.2 | 29/5/5/3 | **Yes** (a transaction in the API) |
| New IDs (`ev-<ts>`, `code-<ts>`) | §5.4, §7.2 | – | **Yes** (UUIDs generated server-side) |
| Reset to defaults | §7.1 | – | **Yes, if kept.** It is a destructive business operation |
| Occurrence expansion, sorting, lane layout, geometry, fit | §5.7–5.8 | §5.9 | Presentation (client) |
| Tones, colorKey, legend, values ordering, valueTone defaults | §5.5 | §5.5 | Presentation (client). The distinct value list must come from the backend (§11.3) |
| hidden and search filtering | §5.6 | – | Presentation (client) |
| Month count `N events this month` | §5.3 | 50 | Presentation (client, from the fetched range) |
| Scroll offset, popover position | §5.8, §5.11 | 0 / 100 | Presentation |

There are **no financial calculations** in this area.

---

## 11. Backend requirements (architecture-compliant contract)

> `docs/03-database.md` does not exist yet in Runtruck2. These tables are a **proposal to add there** (architecture §7: do not invent structures that contradict it). They need to be reconciled with the loads, stops and appointments schema.

### 11.1 Tables (all tenant-owned, UUID PKs, UTC `created_at`/`updated_at`)

- **`planner_categories`**: `id uuid`, `organization_id uuid NOT NULL`, `system_key text NULL` (`'pickup'|'delivery'`, unique per org), `label text NOT NULL`, `tone text NOT NULL CHECK (tone IN TONES)`, `is_locked bool NOT NULL`, `sort_order int NOT NULL`, timestamps. Seed each organization with the 6 defaults in order. The locked rows cannot be deleted, but their label and tone can change.
- **`planner_events`**: `id uuid`, `organization_id`, `category_id uuid FK → planner_categories` (must be unlocked), `title text NOT NULL`, `starts_on date NOT NULL`, `ends_on date NULL` (all-day only, > `starts_on`), `start_time time NULL`, `end_time time NULL` (both null means all-day; `end_time > start_time`), `timezone text NOT NULL` (the organization's IANA tz; see §15 C6), `place text NULL`, `notes text NULL`, `people text[] NOT NULL DEFAULT '{}'`, `load_id uuid NULL FK → loads (same org)`, `created_by uuid`, timestamps, optional `deleted_at`.
- **User preferences** (optional, recommended): `user_preferences(user_id, organization_id, key='planner', value jsonb)`, holding a Zod-validated `Prefs`.
- Load stop events are **not stored**. The API derives them from `loads` + `load_stops` (+ appointments, drivers, trucks, trailers, customers, locations).

### 11.2 Permissions (proposal, to add to 07-roles-permissions)

- `planner.view` covers reading events and categories. Load stop events also require `loads.view`; without it, the API omits them.
- `planner.events.create`, `planner.events.update` and `planner.events.delete`.
- `planner.categories.manage` covers creating, renaming, recolouring and deleting codes, and changing colour codes shared by the organization.
- `planner.reset` covers the destructive reset if it is kept (Owner/Admin only).
- The frontend may hide controls, but the backend enforces every permission.

### 11.3 Endpoints (`/api/v1`, `{data, meta}` envelopes, org taken from the session)

| Method & path | Purpose | Response `data` |
|---|---|---|
| `GET /planner/events?from=YYYY-MM-DD&to=YYYY-MM-DD` | The user events overlapping the range (`starts_on <= to AND coalesce(ends_on, starts_on) >= from`) **plus** the load stop events in the range | `PlannerEventDto[]`, in a stable order: user events (by `starts_on`, `start_time`, `created_at`), then stop events (load board order, pickup before delivery / stop sequence) |
| `POST /planner/events` | Create | `PlannerEventDto`; emits `PlannerEventCreated` + audit |
| `PATCH /planner/events/:id` | Update (rejects read-only stop ids) | `PlannerEventDto`; `PlannerEventUpdated` + audit |
| `DELETE /planner/events/:id` | Delete | `{id}`; `PlannerEventDeleted` + audit |
| `GET /planner/categories` | Ordered codes, with `eventCount` (user events, all dates) | `CategoryDto[]` |
| `POST /planner/categories` | Add (server picks the first free tone, default label `New color code`) | `CategoryDto` |
| `PATCH /planner/categories/:id` | Rename or recolour (a blank label becomes `Untitled`) | `CategoryDto` |
| `DELETE /planner/categories/:id` | Delete locked → `CONFLICT`. Last unlocked → `CONFLICT` (message `Keep at least one color code for your own events.`). Otherwise reassign events to the first unlocked code by `sort_order` in a transaction | `{id, movedCount, fallbackId}` |
| `GET /planner/stop-values?by=driver\|customer\|truck` | The sorted distinct values over **all** load stop events (blank or `Unassigned` → `Unassigned`) for the value-mode legend and palette | `string[]` |
| `GET /planner/sample-stop` (or `meta.sampleStop` on events) | The first pickup stop of the first load in board order, for the Event-cards preview | `PlannerEventDto \| null` |
| `GET/PUT /me/preferences/planner` | Optional server prefs | `Prefs` |
| `POST /planner/reset` | Only if the product keeps it | – |

The "Related load" select also needs `GET /api/v1/loads?fields=id,number,route`, covering all loads in board order (paginate or search if the list grows large; §37).

`PlannerEventDto`:

```ts
{ id: string /*uuid; stop events use the load_stop uuid*/, readOnly: boolean, title: string, categoryId: string, categoryKey?: 'pickup'|'delivery',
  date: string, endDate: string|null, start: string|null /*HH:MM*/, end: string|null,
  place: string|null, notes: string|null, people: string[],
  loadId: string|null /*uuid*/, loadNumber: string|null /*'L-40218', display + URL*/,
  facility?: string, customer?: string, driver?: string /*'Unassigned' allowed*/, truck?: string /*'T-114 / RF-88' or ''*/, commodity?: string }
```

The client must display `loadNumber` wherever the prototype shows `loadId`: the `Load #` card line, the popover kind, the `Open load L-40218` button and its link, and the Related load option. The `/app/loads/:id` URL key must match what the Loads spec chooses.

**Zod input schema (sketch):**
- `title` is trimmed and has min 1.
- `date` matches `/^\d{4}-\d{2}-\d{2}$/`.
- `endDate` is a date or null. It is allowed only when all-day, and it is normalized to null when ≤ `date`. A value `< date` is a `VALIDATION_ERROR`.
- `start` and `end` match `/^([01]\d|2[0-3]):[0-5]\d$/`. Both are null or both are set, with `end > start`.
- `categoryId` is a UUID belonging to the org and must be unlocked.
- `place` is trimmed or null.
- `notes` is a string or null (trimming is recommended).
- `people` is an array of trimmed non-empty strings.
- `loadId` is a UUID in the org, or null.

**Seed data for parity:**
- The 42 `PLANNER_EVENTS` (§3.4), with UUID ids.
- The 6 categories.
- Load stops whose appointment windows reproduce the §3.5 table. See §15 C2 for the conflict with the Loads page windows.

### 11.4 Domain events and audit

- Emit `PlannerEventCreated`, `PlannerEventUpdated`, `PlannerEventDeleted`, `PlannerCategoryCreated`, `PlannerCategoryUpdated`, `PlannerCategoryDeleted` (payload includes `movedCount`, `fallbackId`) and `PlannerReset`.
- Each emission writes an `audit_logs` row with the previous and new values.

### 11.5 What stays in the browser

The following are (b) presentation state:
- `view`, `weekStart`, `showWeekends`, `dayStart`, `dayEnd`, `density`, `hour24`, `hidden`, `colorBy`, `valueTones`, `cardLines`
- `cursor`
- popover and dialog open state
- the settings page
- the search query

`valueTones` and `colorBy` could reasonably be org-level instead. **This needs a decision** (§15 C8).

---

## 12. Interactions: complete list

| # | Trigger | Handler | State mutated | Class |
|---|---|---|---|---|
| 1 | `‹` / `›` | `move(∓1)` | cursor, selected | b |
| 2 | `Today` | set cursor = TODAY | cursor, selected | b |
| 3 | `Day`/`Week`/`Month` | `pref('view')` | prefs.view (persisted) | b |
| 4 | `Customize` | `setSettings('Layout')` | settings | b |
| 5 | `+ Add Event` | `create(iso(cursor))` | editing | b (draft) |
| 6 | Legend chip | toggle hidden | prefs.hidden | b |
| 7 | `Edit colors` | `setSettings('Color codes')` | settings | b |
| 8 | Week header day button | `openDay(d)` | cursor, prefs.view='Day', selected | b |
| 9 | Empty time-slot click | `create(date, snapped start)` | editing (+ closes popover) | b |
| 10 | Event card / all-day chip / month event click | `select(o, e)` (stopPropagation) | selected {o,x,y} | b |
| 11 | Month day-number / `+N more` | `openDay(d)` | cursor, view | b |
| 12 | Month cell background click | `create(date)` 09:00–10:00 | editing | b |
| 13 | Outside pointerdown / Escape (popover) | `setSelected(null)` | selected | b |
| 14 | Popover `Open load L-…` | navigate `/app/loads/:id` | route | – |
| 15 | Popover `Edit` | `setEditing({ev,isNew:false})` | editing, selected | b |
| 16 | Popover `Delete` | remove event (no confirm) | events | **a → DELETE /planner/events/:id** |
| 17 | Dialog Save (new) | append | events | **a → POST** |
| 18 | Dialog Save (edit) | replace by id | events | **a → PATCH** |
| 19 | Dialog Delete | remove (no confirm) | events | **a → DELETE** |
| 20 | Dialog ×, Cancel or Escape | `close()` → `onClose` | editing | b |
| 21 | Settings nav item | `setPage` | internal | b |
| 22 | Layout choices and selects | `pref(...)` | prefs | b |
| 23 | Reset (with confirm) | defaults for prefs, events and categories | prefs + **events + categories** | **a** (+ b) |
| 24 | Color load stops by | `pref('colorBy')` | prefs | b (see C8) |
| 25 | Code name typing and blur | `onCategory(key,{label})` (blank → `Untitled` on blur) | categories | **a → PATCH** (debounce, or save on blur) |
| 26 | Swatch click (code) | `onCategory(key,{tone})` | categories | **a → PATCH** |
| 27 | `+ Add color code` | `addCategory` | categories | **a → POST** |
| 28 | Code `Delete` | alert, confirm, reassign, remove | categories, events, prefs.hidden | **a → DELETE** (+ b hidden cleanup) |
| 29 | Value swatch | `pref('valueTones')` | prefs | b (see C8) |
| 30 | Card line select | `pref('cardLines')` | prefs | b |
| 31 | Header search typing | `setQuery` | query | b |

For the port, every (a) mutation must go through the API and then refetch or update the cache. The UI should look the same after a successful response. There is no optimistic-failure UI in the prototype, so decide how errors are shown (for example with the shell's error pattern).

---

## 13. Keyboard and accessibility facts to preserve

- All interactive items are real `<button>`s (focusable, and Enter/Space activate them).
- The legend chips have `aria-pressed`.
- The view switch is `role=group aria-label="View"`.
- The popover is `role=dialog` labelled by `lines[0]` and closes on Escape.
- Palettes are `role=radiogroup` with `role=radio` + `aria-checked`, and each swatch's aria-label and title is the tone name.
- Dialog Escape is native.
- **Initial focus in EventDialog:** React applies `autoFocus` by calling `.focus()` during commit, *before* the effect runs `showModal()`. That call is a no-op on the still-closed dialog. `showModal()` then focuses the first focusable descendant, which is the **`×` close button** rather than Title (this is from analysis, not verified in a browser). Keep the same DOM order and the same open-in-effect mechanism so the focus matches.

---

## 14. Porting hazards for Next.js App Router

1. **react-router APIs:** `Link` is used in `PlannerPage.tsx:2,557` (`to=`), so replace it with `next/link` (`href=`). The anchor keeps `className="ui-btn ui-btn-sm"`, and the `.ui-shell .cal-pop-actions a.ui-btn` rule still applies. The route mounting is `<Route path="planner">` inside the `/app` layout `Outlet` (`App.tsx:37`), which becomes `app/(app)/app/planner/page.tsx` under the shell layout.
2. **Client component:** everything here uses hooks, `window` and `document`, so it needs `'use client'`. The page file can be a server component that renders a client `PlannerView`.
3. **localStorage in the `useState` initializer** (`persist.ts:6-13`):
   - On the server, `localStorage` is undefined. The resulting ReferenceError is caught and the defaults render.
   - On the client, the first render reads storage. Any stored difference (such as `view:'Month'`) causes a **hydration mismatch**.
   - The write effect then overwrites storage.
   - Options: read the prefs from the API or cookie server-side; render the grid client-only (`dynamic(..., {ssr:false})`); or read storage in an effect behind a mounted flag, accepting a flash.
   - Events and categories must come from the API, not storage.
4. **`window.innerWidth/innerHeight`** is read during `EventPopover` render (`:519-520`). That is safe only because the popover renders after a click, but it must never be server-rendered.
5. **`window.alert` and `window.confirm`** (`PlannerPage.tsx:167,171`, `CalendarSettings.tsx:109`) are client-only. Keep native dialogs for identical behaviour.
6. **`document.addEventListener`** in `useDismiss` runs in an effect, so it is fine.
7. **Native `<dialog>` + `showModal()` in effects** (`EventDialog.tsx:23-26`, `CalendarSettings.tsx:74-77`):
   - The `!el.open` guard is needed for React StrictMode, which Next enables in dev.
   - React 19 supports `onClose` on `<dialog>`.
   - Descendant selectors (`.ui-shell h2`, `.ui-shell a`) still match because the top layer does not change DOM ancestry. Keep the dialogs rendered inside the `.ui-shell` subtree (**no portals to `body`**), or the fonts, colours and heading styles change.
8. **The popover uses `position:fixed`** inside `main.ui-main` (`overflow-y:auto`). Do not add `transform`, `filter` or `contain` to any ancestor in the Next layout, or fixed positioning breaks.
9. **Global CSS:** the stylesheets must be imported in the root `app/layout.tsx` in the order `industry.css`, `app.css`, `shell.css`, `calendar.css`. Do not convert them to CSS Modules, which would hash the `cal-*`, `t-*` and `ui-*` class names.
10. **Fonts:**
    - The prototype uses a Google Fonts `<link>` for Inter 400/500/600/700, and `.ui-shell` uses `font-family:"Inter", system-ui, sans-serif`.
    - `next/font/google` generates a hashed family name plus fallback metrics. Either keep the literal family `"Inter"` (a `<link>` in the layout `<head>`) or map the `next/font` variable into `.ui-shell`, and verify the metrics match.
11. **Theme boot script:** the inline `localStorage['runtruck-theme']` script from `index.html` must move into the root layout `<head>` (`dangerouslySetInnerHTML`), with `suppressHydrationWarning` on `<html>`, so the dark tone overrides apply before paint.
12. **Dates:** `new Date(y,m,d)` and local getters are used everywhere, and `TODAY` is a constant, so SSR output is timezone-independent. `Date.now()` is only used in handlers for ids, and those ids must become server UUIDs. Do not introduce `new Date()` into render (hydration mismatch).
13. **`useAppShell`** (the loads and query context) must be a client provider in the `/app` layout. The planner must fetch events and stops via the API (range = visible days, or the whole month grid), not derive them from a full loads list.
14. **Viewport units:** `.cal-scroll` uses `calc(100vh - 300px)` and `.ui-shell` uses `height:100vh`. Keep the same shell structure so the 300px offset still fits.
15. **Scroll effect:** `scrollRef.current?.scrollTo` runs in a `useEffect` with deps `[firstStart, visStart, rowH, days.length]`. Keep the same deps so re-scroll behaviour matches (§5.8). With async data, `firstStart` changes when the data arrives, which triggers a scroll. That is acceptable, but it differs from the synchronous prototype if data loads after the first paint. Consider rendering the grid only when the data is ready.

---

## 15. Bugs, inconsistencies and architecture conflicts

### Bugs and inconsistencies (reproduce them for parity, or fix them with sign-off)

- **B1 (weekday):**
  - `planner.ts:7` `TODAY='2026-09-03'` is a **Thursday**, and the planner shows `Thursday, September 3, 2026` with Thu highlighted.
  - The dashboard's `REVENUE_DAYS` (`mock.ts:332`, ending `'Wed'`) and the orchestrator brief assume Wednesday. The mock data is internally inconsistent.
  - The planner's own seed data is consistent with Thursday: Labor Day Mon Sep 7, and ev-1 "Back on duty Mon Sep 7."
- **B2 (appointment windows disagree):**
  - The planner synthesizes pickup and delivery times from the load number (`planner.ts:166-177`). For example, L-40218 pickup is 10:30–12:30.
  - The Loads page uses `stopsOf()` windows `08:00–14:00` (pickup) and `06:00–12:00` (delivery) (`mock.ts:123-128`, used in `LoadsPage.tsx:71`).
  - So one load shows two different appointment times, and the backend must have a single source (`load_stops`). **A decision is needed** on which values to seed. The planner parity table is in §3.5.
- **B3 (year):** `YEAR=2026` is hard-coded (`planner.ts:8,156,173-174`). Load dates carry no year, so a load in 2027 would be drawn in 2026.
- **B4 (single stop time ignored):** for New-Load stops, a window without `–` (only a from or to time, or `Any time`) becomes `08:00–09:00`, ignoring the time that was entered (`planner.ts:158`).
- **B5 (cleared start becomes all-day):**
  - Clearing the **Starts** time input sets `start=''` (the `?? '09:00'` fallback does not catch `''`), and `toMinutes('')` is 0, so validation passes (`EventDialog.tsx:29,33`).
  - The event is saved with `start:''` plus an end time, and `occurrencesOn` treats it as **all-day** (`PlannerPage.tsx:35`).
- **B6:** Notes are not trimmed, so whitespace-only notes are saved (`EventDialog.tsx:117`).
- **B7:** Deleting an event from the popover (`PlannerPage.tsx:295`) and from the dialog (`EventDialog.tsx:123`) has **no confirmation**, while deleting a code does confirm.
- **B8:** Month navigation resets the cursor to the 1st (`dates.ts:22-24`). The badge then shows `1`, and switching to Week or Day lands on the 1st, not the same day number.
- **B9:** `` `${n} events this month` `` has no singular form (`PlannerPage.tsx:219`). It counts start dates only, so a multi-day event that started last month is not counted, while weekend events hidden by "Hide weekends" still are.
- **B10:** When there are more than 3 people, the popover text shows only `+N more` and no names (`PlannerPage.tsx:553`).
- **B11:** `hidden` keys go stale across colour modes. In value mode a hidden `pickup` has no chip and no effect, and `driver:*` keys linger in type mode. There is no cleanup except on category delete.
- **B12:** `valueTone` returns `TONES[-1]` (undefined, giving class `t-undefined`) for a value not in `values`. This is unreachable today (`PlannerPage.tsx:116`).
- **B13 (loose revive):** `reviveEvents` only checks `id` and `date` (`PlannerPage.tsx:81-83`), and `revivePrefs` does no type checks (`:85-87`). Corrupt storage can crash the dialog (for example `e.title.trim()` on a non-string).
- **B14:** Loads created with New Load live only in memory (`AppShellContext.tsx`, comment "a reload drops them"). User events saved with `loadId` pointing at one of them survive in localStorage and then link to a missing load after a reload.
- **B15:** `addCategory` falls back to `'slate'` when all 10 tones are used, which duplicates a colour (`PlannerPage.tsx:160`). The `code-${Date.now()}` and `ev-${Date.now()}` ids can collide if created within the same millisecond.
- **B16:** Locked codes say "From the load board", but they are still renamable and recolourable (`CalendarSettings.tsx:132-144`). That is probably intended, but note it.
- **B17:** `Day ends` shows `Midnight` even in 24h mode (`CalendarSettings.tsx:101`).
- **B18:** `shortToIso` matches months by prefix (`dates.ts:33`), so `Ju` resolves to June and `Ma` to March.
- **B19:** The popover does not follow the grid scroll, so it stays fixed while the cards move underneath it.
- **B20:** A keyboard-activated card opens the popover at the top-left (12,12), because `clientX/Y` is 0.

### Conflicts with `docs/02-development-architecture.md`

- **C1 (Rule 1 / §5):** events and colour codes are business data stored in **localStorage** (`PlannerPage.tsx:99-101`, `persist.ts`). They must move to PostgreSQL via the API.
- **C2 (Rule 5 / §37):** load stop events are derived in the browser from the entire loads list (`planner.ts:147-180`), with invented appointment times. The backend must serve range-limited stop events from `load_stops`.
- **C3 (§8):** ids are non-UUID and client-generated (`ev-<ts>`, `code-<ts>`, `standup-<date>`, `load:<id>:p`), and category keys double as foreign keys.
- **C4 (§12/13, Rule 2):** there are no auth, permission or tenant checks. Anyone can edit, delete or reset. Permissions need to be defined (§11.2).
- **C5 (§16):** validation exists only client-side, in EventDialog. It needs Zod in the API.
- **C6 (§9):** events store local `date` + `HH:MM` strings with no timezone. Store the org timezone (or UTC timestamps plus a tz) and convert in the client. For parity, render in the org tz.
- **C7 (§23/§30):** there are no domain events or audit logs for event and code changes.
- **C8:** there is an open ownership question. Are colour codes (and `colorBy` / `valueTones`) **per organization** (shared office meaning) or **per user**? The prototype is single-user. The proposal is org-level categories, and per-user or org-level value tones by decision. §49 requires raising this rather than assuming.
- **C9 (Reset):** `Reset calendar` inside a "Customize" preference dialog deletes business data (all user-added and edited events and colour codes) with only a `window.confirm` (`CalendarSettings.tsx:104-114`, `PlannerPage.tsx:322`). In a multi-tenant system this must be removed, limited to prefs only, or gated by `planner.reset` + audit. **A product decision is required.**
- **C10:** "today" is a constant (`planner.ts:7`). The port needs a configurable demo date (for example an env or config value `DEMO_TODAY=2026-09-03`) for parity, and the real clock in the org tz otherwise.
