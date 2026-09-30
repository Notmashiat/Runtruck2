# API — Planner (shared organization calendar)

The Planner screen (`/app/planner`): office events (create, edit, delete, range query), the read-only load-stop events derived from the board, the organization's color codes, the value lists for "Color load stops by", the EventDialog "Related load" list and **Reset calendar**. Conventions (envelopes, errors, formats, lists) are in [04-api.md](../04-api.md). The tables are [03-database.md §5.12](../03-database.md), the derived rules §6.4 and the seed §7.12, §7.24–§7.25; where this document and 03 disagree, 03 wins (architecture §49) and the conflict must be raised.

Inputs:
- Product decisions [01 §2](../01-product-requirements.md): **D8** (shared organization calendar, audited, Reset needs `planner.reset`), D4 (clock), D5 (computed values), D6 (quirks), D7 (one code path for every load).
- [Design brief](../reference/design-brief.md) §2: created-load stops in the planner (planned slot → window → 08:00–09:00), archived loads excluded, endpoint names, tables `planner_color_codes` / `planner_events`.
- The port spec [reference/runtruck1/planner.md](../reference/runtruck1/planner.md) (every value the screen shows and every interaction) and the prototype's `PlannerPage.tsx`, `EventDialog.tsx`, `CalendarSettings.tsx`, `data/planner.ts`.
- Permissions [07 §6](../07-roles-permissions.md); events and audit actions [17 §5](../17-event-architecture.md).

Contracts in code:
- `packages/types/src/planner.ts`: `PlannerTone`, `PlannerEventDto`, `PlannerEventsMeta`, `PlannerEventDeleteResultDto`, `PlannerColorCodeDto`, `PlannerColorCodesMeta`, `PlannerColorCodeDeleteResultDto`, `PlannerStopValuesDto`, `PlannerRelatedLoadDto`, `PlannerResetResultDto`.
- `packages/validation/src/planner.ts`: `plannerToneSchema`, `plannerEventCreateSchema`, `plannerEventUpdateSchema`, `plannerEventsQuerySchema`, `plannerColorCodeCreateSchema`, `plannerColorCodeUpdateSchema`, `plannerRelatedLoadsQuerySchema`, `plannerResetSchema` (each with its inferred `…Input` / `…Query` type). Path ids use `uuidSchema` from `common.ts`.
- API module: `apps/api/src/planner/` (controller, service, queries), registered in `apps/api/src/modules/planner.ts`.

## 0. Feature summary (architecture §44)

| | |
|---|---|
| FEATURE | Planner: the shared organization calendar (day / week / month). |
| PURPOSE | Runtruck1's Planner (R1) with events and color codes in PostgreSQL instead of `localStorage` (R2, D8). |
| USERS | Every member with `planner.view` (Owner, Admin, Dispatcher, Accounting, Manager and Maintenance roles per 07 §2; the Driver role holds no web permission until Phase 9). |
| PERMISSIONS | `planner.view` (read), `planner.manage` (events), `planner.configure` (color codes), `planner.reset` (Reset, Owner/Admin); load-stop events, stop values and the related-load list also need `loads.view` (07 §8 item 3). |
| DATABASE TABLES | write: `planner_events`, `planner_color_codes`, `audit_logs`, `events`. read: `loads`, `load_stops`, `facilities`, `customers`, `dispatches`, `drivers`, `employees`, `trucks`, `trailers`, `organizations`. |
| DATABASE CHANGES | `0000_init` has both tables (03 §5.12). `0003_review_hardening` adds CHECK `planner_events_span_ck` (an all-day event spans at most 366 days) and `organizations.planner_defaults` (which default calendar Reset restores, 03 §2.1). |
| API ENDPOINTS | §1. |
| BUSINESS RULES | §2 and each endpoint: event shape (timed vs all-day), unlocked color codes only for office events, related load must be a board load, locked codes cannot be deleted, the last unlocked code cannot be deleted, delete reassigns events, an all-day event spans at most 366 days, Reset restores the organization's own defaults (§3.11). |
| STATE CHANGES | Planner events and color codes have no lifecycle status; they are created, changed and hard-deleted (03 §1.4). |
| EVENTS | `PlannerEventCreated/Updated/Deleted`, `PlannerColorCodeCreated/Updated/Deleted`, `PlannerReset` (§5). |
| BACKGROUND JOBS / NOTIFICATIONS / INTEGRATIONS / AI | None. The outbox worker only logs the events. |
| SECURITY | Organization, user and permissions from the session only; bodies are strict (unknown keys, including `organizationId`, are rejected); every referenced id is looked up inside the organization; no internal details in errors. |
| ERROR CASES | §2.7 and per endpoint. |
| TESTS | §9. |
| ACCEPTANCE CRITERIA | With the seed the page renders exactly Runtruck1's planner (port spec §5.9, §5.10, §5.11, §7), every write is audited and emitted, Reset is refused without `planner.reset`, tenant isolation and permission denials are proven by §9; architecture §45. |

## 1. Endpoint index

All paths are under `/api/v1`. Every handler declares its permission with `@RequirePermissions(...)`; the organization, user, timezone and permissions come from `@Auth() ctx: AuthContext`.

| # | Method & path | Permission | Input (Zod) | `data` | `meta` | Audit action / domain event |
|---|---|---|---|---|---|---|
| 3.1 | `GET /planner/events` | `planner.view` (stop events only with `loads.view`) | query `plannerEventsQuerySchema` | `PlannerEventDto[]` | `PlannerEventsMeta` | — |
| 3.2 | `POST /planner/events` | `planner.manage` (+ `loads.view` to set a related load) | body `plannerEventCreateSchema` | `PlannerEventDto` (201) | `{}` | `PLANNER_EVENT_CREATED` / `PlannerEventCreated` |
| 3.3 | `PATCH /planner/events/:id` | `planner.manage` (+ `loads.view` to change the related load) | param `uuidSchema`, body `plannerEventUpdateSchema` | `PlannerEventDto` | `{}` | `PLANNER_EVENT_UPDATED` / `PlannerEventUpdated` |
| 3.4 | `DELETE /planner/events/:id` | `planner.manage` | param `uuidSchema` | `PlannerEventDeleteResultDto` | `{}` | `PLANNER_EVENT_DELETED` / `PlannerEventDeleted` |
| 3.5 | `GET /planner/color-codes` | `planner.view` | none | `PlannerColorCodeDto[]` | `PlannerColorCodesMeta` | — |
| 3.6 | `POST /planner/color-codes` | `planner.configure` | body `plannerColorCodeCreateSchema` | `PlannerColorCodeDto` (201) | `{}` | `PLANNER_COLOR_CODE_CREATED` / `PlannerColorCodeCreated` |
| 3.7 | `PATCH /planner/color-codes/:id` | `planner.configure` | param `uuidSchema`, body `plannerColorCodeUpdateSchema` | `PlannerColorCodeDto` | `{}` | `PLANNER_COLOR_CODE_UPDATED` / `PlannerColorCodeUpdated` |
| 3.8 | `DELETE /planner/color-codes/:id` | `planner.configure` | param `uuidSchema` | `PlannerColorCodeDeleteResultDto` | `{}` | `PLANNER_COLOR_CODE_DELETED` / `PlannerColorCodeDeleted` |
| 3.9 | `GET /planner/stop-values` | `planner.view` (non-empty only with `loads.view`) | none | `PlannerStopValuesDto` | `{}` | — |
| 3.10 | `GET /planner/related-loads` | `planner.manage` + `loads.view` | query `plannerRelatedLoadsQuerySchema` | `PlannerRelatedLoadDto[]` | `PageMeta` | — |
| 3.11 | `POST /planner/reset` | `planner.reset` | body `plannerResetSchema` (`{}`) | `PlannerResetResultDto` | `{}` | `PLANNER_RESET` / `PlannerReset` |

View preferences (view, week start, weekends, day start/end, density, 24 h, hidden codes, color-by, value tones, card lines) are **not** served by the API: they stay in the browser under `runtruck-planner-prefs`, as in Runtruck1 (D8, §7.8).

## 2. Shared rules

### 2.1 Clock, dates and time zones

- "Today" is `ClockService.today(ctx.timezone)` (D4; 2026-09-03, a Thursday). The web receives it from `GET /me` (`today`) and never uses the device date. No planner endpoint depends on today: ranges are always explicit.
- Dates are `YYYY-MM-DD` strings end to end (`date` columns, Drizzle `mode: 'string'`), never converted through `Date` on the server.
- Times are `HH:MM` wall clock and are **never converted** (03 §1.5): office events in the organization's zone (`organizations.timezone`), load-stop events in the stop's zone (`load_stops.timezone`, e.g. L-40219's delivery at Wasatch Crossdock is 08:30 America/Denver and is drawn at 08:30). `PlannerEventDto.timezone` states the zone of each event's times. The database returns `time` as `HH:MM:SS`; the API sends the first five characters.

### 2.2 Tenancy

- Every statement filters `organization_id = ctx.organizationId` on every tenant table it reads, and every join matches `organization_id` on both sides (e.g. `loads.organization_id = load_stops.organization_id AND loads.id = load_stops.load_id`). The composite tenant foreign keys (03 §1.3) make a cross-tenant reference impossible even if a predicate were missing.
- Inserts stamp `organization_id` from the context; updates and deletes include it in the `WHERE`; zero affected rows → the entity's 404.
- Referenced ids in bodies (`colorCodeId`, `loadId`) are looked up inside the organization before use. Another organization's id behaves exactly like an unknown one (§2.7).
- No endpoint accepts an organization id; the strict body schemas reject any unknown key, and query schemas ignore unknown parameters.

### 2.3 Content that depends on `loads.view`

Load-stop events expose load data (customer, driver, unit, commodity), so they are part of a response only when `hasPermissions(ctx.permissions, ['loads.view'])` (07 §8 item 3). Without it:
- `GET /planner/events` returns office events only (`meta.total` counts only them);
- `GET /planner/stop-values` returns three empty lists and a `sampleEvent` chosen among office events;
- `GET /planner/related-loads` is refused (403), and setting or changing an event's related load is refused (403, 07 §4 "data from another area").

An office event's own `loadId` / `loadNumber` (its "Related load") is part of the office event and is returned to every `planner.view` member.

### 2.4 Load-stop events (derived, read-only, never stored)

One event per `load_stops` row of kind `pickup` or `delivery` (fuel stops excluded) whose load is a **board load** (`loads.archived_at IS NULL`; 03 §6.0.3, design brief §2). Archived loads (the 11 uninvoiced loads and the 12 invoice-only loads) produce no event, even though the uninvoiced ones have stops dated Aug 24 – Sep 2.

Source rows (one statement, §3.1):
```
load_stops s
  JOIN loads l            ON l.organization_id = s.organization_id AND l.id = s.load_id AND l.archived_at IS NULL
  JOIN customers cu       ON cu.organization_id = l.organization_id AND cu.id = l.customer_id
  JOIN planner_color_codes pc ON pc.organization_id = s.organization_id AND pc.key = s.kind::text   -- the locked 'pickup' / 'delivery' code
  LEFT JOIN facilities f  ON f.organization_id = s.organization_id AND f.id = s.facility_id
  LEFT JOIN dispatches d  ON d.organization_id = l.organization_id AND d.load_id = l.id AND d.status <> 'cancelled'
  LEFT JOIN drivers dr    ON dr.organization_id = d.organization_id AND dr.id = d.driver_id
  LEFT JOIN employees em  ON em.organization_id = dr.organization_id AND em.id = dr.employee_id
  LEFT JOIN trucks t      ON t.organization_id = d.organization_id AND t.id = d.truck_id
  LEFT JOIN trailers tr   ON tr.organization_id = d.organization_id AND tr.id = d.trailer_id
WHERE s.organization_id = $org AND s.kind IN ('pickup', 'delivery')
```

Field rules (Runtruck1 `loadEvents`, `data/planner.ts:147-180`, restated on stored columns; the load helpers are 03 §6.0.3):

| field | rule |
|---|---|
| `place` | the **stop route label**: with `facility_id`, `coalesce(f.market_city, f.city) || ', ' || coalesce(f.market_state, f.state)`; without, `s.city || ', ' || s.state`. For seeded stops this is the route city ("Reno, NV" for Reno Grocers DC in Sparks); for New Load stops (free-text facility, no `facility_id`) it equals Runtruck1's `cityState(address)` provided the loads API stores `state` upper-cased as `toLoad` does (§10). |
| `title` | `formatLoadNumber(l.load_number) + ' · ' + place` ("L-40218 · Fresno, CA"). |
| `date` | `s.appointment_date`. |
| `start`, `end` | **planned slot** `s.planned_start`–`s.planned_end` when set (a CHECK guarantees both or neither); else the **window** `s.window_open`–`s.window_close` when **both** are set; else **08:00–09:00** (Runtruck1's rule for created stops with a single-bound window or "Any time", planner B4, reproduced). A window whose close is not after its open is returned as stored; the web then draws the 15-minute minimum card, as Runtruck1 does. |
| `timezone` | `s.timezone`. |
| `notes` | `s.facility_name || ' · ' || cu.name` ("Northgate Cold Storage · Northgate Foods"). Searchable, never shown in the popover (`readOnly`). |
| `facility` | `s.facility_name`. |
| `customer` | `cu.name`. |
| `driver` | **driver label**: `em.first_name || ' ' || em.last_name` when the live dispatch has a driver, else `d.driver_name`, else `'Unassigned'`. |
| `truck` | **unit label**: the non-empty of (`t.unit_number` or `d.truck_number`, `tr.unit_number` or `d.trailer_number`) joined `' / '`; `''` when none (Runtruck1 `l.unit === '—' ? '' : l.unit`). |
| `commodity` | `l.commodity`. |
| `people` | `[driver]` (the label, `'Unassigned'` included; the web filters it out of the popover). |
| `loadId`, `loadNumber` | `l.id`, `l.load_number`. |
| `colorCodeId`, `colorCodeKey` | `pc.id`, `pc.key`. The locked codes always exist: they cannot be deleted (§3.8) and Reset recreates them in the same transaction (§3.11). |
| `id`, `readOnly`, `endDate` | `s.id`, `true`, `null`. |

The rules are the same for every load, seeded or created (D7). Seed result, 16 events, identical to Runtruck1 (port spec §3.5; 03 §6.4):

| load | pickup event (date, time, place, facility) | delivery event | customer · driver · truck · commodity |
|---|---|---|---|
| L-40218 | 09-03 10:30–12:30 Fresno, CA · Northgate Cold Storage | 09-04 16:00–18:00 Reno, NV · Reno Grocers DC | Northgate Foods · Marcus Hale · T-114 / RF-88 · Frozen produce |
| L-40219 | 09-03 12:00–14:00 Stockton, CA · Bayline DC 4 | 09-05 08:30–10:30 Salt Lake City, UT · Wasatch Crossdock | Bayline Distribution · Dara Whitfield · T-107 / DV-51 · Palletized dry goods |
| L-40220 | 09-02 13:30–15:30 Sacramento, CA · Cascade Yard 2 | 09-04 13:00–15:00 Boise, ID · Boise Builders Depot | Cascade Building Supply · Ellis Nakamura · T-121 / FB-12 · Lumber |
| L-40221 | 09-04 15:00–17:00 Oakland, CA · Port of Oakland, Berth 22 | 09-06 17:30–19:30 Portland, OR · Harbor Point DC | Harbor Point Retail · Unassigned · `''` · Consumer goods |
| L-40214 | 09-01 15:00–17:00 Bakersfield, CA · Northgate Creamery | 09-02 10:00–12:00 Phoenix, AZ · Valley Foods DC | Northgate Foods · Priya Raman · T-103 / RF-27 · Dairy |
| L-40212 | 08-31 12:00–14:00 Los Angeles, CA · Bayline LA Annex | 09-01 13:00–15:00 Las Vegas, NV · Sunset Beverage DC | Bayline Distribution · Marcus Hale · T-114 / DV-88 · Beverages |
| L-40210 | 08-29 09:00–11:00 Modesto, CA · Sierra Ag Huller 3 | 09-01 16:00–18:00 Denver, CO · Front Range Foods | Sierra Ag Partners · Tobias Frey · T-118 / DV-14 · Almonds |
| L-40222 | 09-05 06:00–08:00 Redding, CA · Cascade Mill | 09-06 10:00–12:00 Seattle, WA · Duwamish Steel Yard | Cascade Building Supply · Ana Cortez · T-109 / FB-04 · Steel coil |

The Loads page and load detail keep showing the **window** (08:00–14:00 / 06:00–12:00); only the planner uses the planned slot (design brief §2, port spec B2).

### 2.5 Event order (Runtruck1's `all` order)

Runtruck1 draws `all = [...officeEvents, ...loadEvents(loads)]` and its per-day sort (all-day first, then start, then end descending) is **stable**, so ties keep `all` order. The API therefore returns events in this order, and the web must not re-sort before its own stable sort:

1. **Office events** by `created_at ASC, start_date ASC, start_time ASC NULLS FIRST, id ASC`. New events land after older ones (Runtruck1 appends), an edit keeps its place (Runtruck1 replaces in place; `created_at` does not change). Seeded and reset demo rows get explicit `created_at` values **one second apart in `PLANNER_EVENTS` order** (the 27 standups, then ev-1 … ev-15; `PLANNER_DEFAULTS_CREATED_FROM` + i s, ending 2026-09-03T00:00Z, 03 §7.25), so the API returns them in Runtruck1's `all` order `[...STANDUPS, ev-1 … ev-15]`, and every event created later sorts after them. `start_date`, `start_time` and `id` only break ties between rows created in the same instant.
2. **Load-stop events** in board order `l.created_at DESC, l.load_number DESC` (03 §6.3), then `s.sequence ASC` (pickup before delivery; every stop of a created load in running order).

### 2.6 Server-side `q`

Lists accept `q` (04 §5). It reproduces Runtruck1's `matchesQuery` on the planner's search object `{ title, place, notes, people: people.join(' '), customer, truck }` (port spec §5.6): `needle = q.trim().toLowerCase()`, empty matches everything, otherwise an event matches when one of those strings, lower-cased, contains the needle. `loadNumber` is searchable only through the stop title, the facility only through the notes, the driver only through `people`, and commodity not at all, exactly as in Runtruck1. SQL evaluates it with `ILIKE '%' || escaped(needle) || '%'` over the same expressions (`%`, `_` and `\` escaped). The web never sends `q`: it filters the events it holds with the same rule (§7.4).

### 2.7 Errors

| HTTP | code | when (message) |
|---|---|---|
| 400 | `VALIDATION_ERROR` | query, param or body fails its schema; a malformed UUID path id; a business rule on the input (below). `issues[]` names the field. |
| 401 | `UNAUTHORIZED` | no or expired session. |
| 403 | `FORBIDDEN` | missing permission ("You do not have permission to do that."), including `loads.view` for a related load (§2.3). |
| 403 | `NO_ACTIVE_MEMBERSHIP` | the account has no active organization. |
| 404 | `PLANNER_EVENT_NOT_FOUND` | "Event was not found." Unknown id, another organization's id, or the id of a **load-stop event** (they are not `planner_events` rows, so read-only events cannot be changed or deleted). |
| 404 | `PLANNER_COLOR_CODE_NOT_FOUND` | "Color code was not found." Unknown or foreign id in the path. |
| 409 | `PLANNER_COLOR_CODE_LOCKED` | "Load-board color codes can't be deleted." |
| 409 | `PLANNER_LAST_COLOR_CODE` | "Keep at least one color code for your own events." (Runtruck1's alert text) |
| 409 | `PLANNER_COLOR_CODE_LIMIT` | "An organization can have at most 100 color codes." |
| 500 | `INTERNAL_ERROR` | anything unexpected (logged with the request id). |

Business-rule issues (400 `VALIDATION_ERROR`, message "Some fields are invalid."):

| path | message | when |
|---|---|---|
| `title` | Enter a title. | blank after trimming |
| `date`, `endDate` | Use a YYYY-MM-DD date. | not a real calendar date, or outside 1900-01-01 … 2999-12-31 (`businessDateSchema`, 04 §6) |
| `start`, `end` | Use a HH:MM time. | not `HH:MM` 00:00–23:59 |
| `start` / `end` | Enter a start and an end time, or make the event all day. | only one of the two times |
| `end` | Must be after the start | `end <= start` (Runtruck1's text) |
| `endDate` | Must be on or after the start date | `endDate < date` (Runtruck1's text) |
| `endDate` | An event spans at most a year. | `endDate − date > 366` days (`PLANNER_MAX_EVENT_SPAN_DAYS`; CHECK `planner_events_span_ck`) |
| `endDate` | Only all-day events can span several days. | `endDate` with times |
| `colorCodeId` | Choose one of your color codes. | malformed, unknown or another organization's code |
| `colorCodeId` | Load-board color codes can't be used for your own events. | a locked code (`pickup`, `delivery`) |
| `loadId` | Choose a load from the board. | malformed, unknown, foreign or **archived** load |
| `from`, `to` | Use a YYYY-MM-DD date. | `GET /planner/events` range day not a business date (e.g. `0000-01-01`) |
| `to` | Must be on or after from. / A range covers at most 42 days. | `GET /planner/events` range |
| (root) | Change at least one field. | empty PATCH body |
| (root) | Unrecognized key: "…" | any key not in the strict body schema (e.g. `organizationId`, `readOnly`) |

## 3. Endpoints

### 3.1 `GET /planner/events`

- **Controller:** `@Get('planner/events') @RequirePermissions('planner.view')`, `list(@Auth() ctx, @Query(new ZodValidationPipe(plannerEventsQuerySchema)) query)`.
- **Query** (`plannerEventsQuerySchema`): `from`, `to` (required, real `YYYY-MM-DD` days, inclusive, `to >= from`, at most 42 days: a Month grid is at most 6 weeks), `q` (≤ 200), `limit` (1–500, **default 500**: the calendar needs every event of the range), `offset` (≥ 0).
- **Selection:**
  - office events **overlapping** the range: `start_date <= to AND coalesce(end_date, start_date) >= from` (a multi-day all-day event that started before `from` is included, so its chips draw), plus the redundant bound `start_date >= from − 366` (exact, because an event spans at most 366 days, §3.2), so the index bounds the scan at both ends;
  - load-stop events (§2.4) with `appointment_date BETWEEN from AND to`, only with `loads.view` (§2.3);
  - both filtered by `q` (§2.6).
- **Order:** §2.5. `limit`/`offset` apply to the concatenated list (office events, then stop events).
- **Response:** `200 { data: PlannerEventDto[], meta: PlannerEventsMeta }` with `meta = { total, limit, offset, from, to }`; `total` = matching office events + matching stop events. There is no `meta.summary`: the planner has no KPI tile, and "N events this month" is counted by the web over the returned events after its view filters (03 §6.4, §7.3).
- **Seed** (Rosa, Admin; no `q`):

| request (the web's ranges, §7.1) | office | stop | `total` |
|---|---|---|---|
| Week, Mon start: `from=2026-08-31&to=2026-09-06` | 12 (standups Aug 31–Sep 4, ev-1 … ev-7) | 15 (all but L-40210 pickup, Aug 29) | **27** |
| Day: `from=2026-09-03&to=2026-09-03` | 4 (standup, ev-1, ev-2, ev-5) | 2 (L-40218, L-40219 pickups) | **6** |
| Month Sep 2026 grid: `from=2026-08-31&to=2026-10-04` | 37 (22 standups, ev-1 … ev-15) | 15 | **52** → web count "50 events this month" |
| Month Aug 2026 grid: `from=2026-07-27&to=2026-09-06` | 17 (10 standups, ev-1 … ev-7) | 16 | **33** → web count "8 events this month" |

  First rows of the week response (§2.5): standup Aug 31, standup Sep 1, standup Sep 2, standup Sep 3, standup Sep 4, then ev-1, ev-2, ev-3, ev-4, ev-5, ev-6, ev-7, then L-40218 pickup, L-40218 delivery, L-40219 pickup, … L-40222 delivery (L-40210 contributes only its delivery). This is Runtruck1's `all` order; the web's stable per-day sort then places them exactly as Runtruck1 does.
- **Query plan (no N+1):** two statements (one without `loads.view`):
  1. office events `planner_events e` `LEFT JOIN planner_color_codes pc` (key) `LEFT JOIN loads l` (load number), range and `q` predicates, ordered, `count(*) over ()` for the total, `LIMIT offset + limit`. Index `planner_events_org_start_idx (organization_id, start_date)` bounds `from − 366 <= start_date <= to`, so the cost does not grow with the organization's history.
  2. stop events: the §2.4 statement with `s.appointment_date BETWEEN $from AND $to` (index `load_stops_org_date_idx`), the display strings composed in SQL once so `q` filters them, ordered, `count(*) over ()`, `LIMIT offset + limit`.
  The service concatenates and slices `[offset, offset + limit)`.
- **Errors:** 400 (range, `limit`, `q`), 401, 403.

### 3.2 `POST /planner/events`

- **Controller:** `@Post('planner/events') @RequirePermissions('planner.manage')`, body `plannerEventCreateSchema`.
- **Body** (`PlannerEventCreateInput` after parsing):

| field | type | rule (normalization) |
|---|---|---|
| `title` | string | trimmed, 1–200 |
| `colorCodeId` | uuid | an **unlocked** color code of the organization |
| `date` | `YYYY-MM-DD` | real day |
| `endDate` | `YYYY-MM-DD` \| null (default null) | all-day only; `>= date` and at most `date + 366` days; **equal to `date` → null** (Runtruck1 drops it) |
| `start`, `end` | `HH:MM` \| null (default null) | both null (all-day) or both set with `end > start` |
| `place` | string \| null (default null) | ≤ 120, trimmed, blank → null |
| `notes` | string \| null (default null) | ≤ 2,000, **not trimmed** (Runtruck1 B6), `''` → null |
| `people` | string[] (default []) | ≤ 50 names of ≤ 100, each trimmed, blanks dropped |
| `loadId` | uuid \| null (default null) | a **board** load of the organization; needs `loads.view` |

- **Transaction:**
  1. `SELECT id, is_locked FROM planner_color_codes WHERE organization_id = $org AND id = $colorCodeId FOR SHARE` → missing: 400 `colorCodeId` "Choose one of your color codes."; locked: 400 "Load-board color codes can't be used for your own events." The share lock makes a concurrent delete or Reset wait, so the insert never races a vanished code.
  2. When `loadId` is set: `hasPermissions(ctx.permissions, ['loads.view'])` else 403; `SELECT id FROM loads WHERE organization_id = $org AND id = $loadId AND archived_at IS NULL` else 400 `loadId`.
  3. `INSERT INTO planner_events (organization_id, title, color_code_id, start_date, end_date, start_time, end_time, place, notes, people, load_id, created_by_user_id)` with `ctx.userId`.
  4. Audit `PLANNER_EVENT_CREATED` and emit `PlannerEventCreated` (§5).
- **Response:** `201 { data: PlannerEventDto, meta: {} }` (the new office event, §4.1).
- **Errors:** 400, 401, 403.

### 3.3 `PATCH /planner/events/:id`

- **Controller:** `@Patch('planner/events/:id') @RequirePermissions('planner.manage')`, `@Param('id', new ZodValidationPipe(uuidSchema))`, body `plannerEventUpdateSchema` (every field of §3.2 optional, same per-field rules; at least one field).
- **Transaction:**
  1. `SELECT … FROM planner_events WHERE organization_id = $org AND id = $id FOR UPDATE` → none: 404 `PLANNER_EVENT_NOT_FOUND` (also for load-stop ids).
  2. Overlay the patch on the stored values and parse the **merged** event with `plannerEventCreateSchema`, so the pairwise rules (times, end date) and normalizations hold for the result. To turn a timed event all-day send `{ start: null, end: null }`; to turn an all-day event timed send `{ start, end, endDate: null }`.
  3. If `colorCodeId` changes: the §3.2 step 1 check. If `loadId` changes to a non-null value: the §3.2 step 2 check. An **unchanged** related load is not re-checked, so an event linked to a load that has since been archived can still be edited (the link stays).
  4. If the merged event equals the stored one: return it; no update, audit or event (a no-op save writes nothing).
  5. Otherwise `UPDATE … WHERE organization_id = $org AND id = $id`, audit `PLANNER_EVENT_UPDATED` (previous and next of the changed fields), emit `PlannerEventUpdated` with `changedFields`.
- **Response:** `200 { data: PlannerEventDto, meta: {} }`.
- **Errors:** 400, 401, 403, 404.

### 3.4 `DELETE /planner/events/:id`

- **Controller:** `@Delete('planner/events/:id') @RequirePermissions('planner.manage')`.
- **Transaction:** `DELETE FROM planner_events WHERE organization_id = $org AND id = $id RETURNING *` → no row: 404 `PLANNER_EVENT_NOT_FOUND`. Audit `PLANNER_EVENT_DELETED` (previous = the row's editable fields), emit `PlannerEventDeleted`. A hard delete (03 §1.4). There is no confirmation step anywhere (Runtruck1 B7, D6).
- **Response:** `200 { data: { id }, meta: {} }`.

### 3.5 `GET /planner/color-codes`

- **Controller:** `@Get('planner/color-codes') @RequirePermissions('planner.view')`. No query.
- **Rows:** every color code of the organization, ordered `is_locked DESC, position ASC, id ASC` (03 §6.4: the locked codes first, as Runtruck1's `reviveCategories` forces).
- **`PlannerColorCodeDto`:** `id`, `key`, `label`, `tone`, `locked` (= `is_locked`), `eventCount` = number of `planner_events` rows with this `color_code_id` (office events, **all dates**; the delete confirmation's count).
- **Response:** `200 { data: PlannerColorCodeDto[], meta: { total } }`. Not paginated: at most 100 codes per organization (§3.6).
- **Seed:** Loaded (pickup) amber locked 0 · Empty (delivery) green locked 0 · Maintenance red 3 · Driver schedule purple 5 · Meetings blue 29 · Billing & admin teal 5 (= Runtruck1's 3 / 5 / 29 / 5).
- **Query plan:** one statement, `planner_color_codes pc LEFT JOIN planner_events e ON e.organization_id = pc.organization_id AND e.color_code_id = pc.id GROUP BY pc.id` (index `planner_events_org_color_code_idx`).

### 3.6 `POST /planner/color-codes`

- **Controller:** `@Post('planner/color-codes') @RequirePermissions('planner.configure')`, body `plannerColorCodeCreateSchema` (`label?` ≤ 80, blank → "Untitled"; `tone?` one of `plannerToneSchema`). The web sends `{}` ("+ Add color code").
- **Transaction:** `SELECT tone, position FROM planner_color_codes WHERE organization_id = $org FOR UPDATE` (serializes concurrent adds); ≥ 100 rows → 409 `PLANNER_COLOR_CODE_LIMIT`. New row: `id` generated by the service, `key = 'code-' + id`, `label` = body label or **"New color code"**, `tone` = body tone or the **first tone of `plannerToneSchema.options` that no code uses, else `slate`** (Runtruck1 `addCategory`, B15), `is_locked = false`, `position = max(position) + 1`. Audit `PLANNER_COLOR_CODE_CREATED`, emit `PlannerColorCodeCreated`.
- **Response:** `201 { data: PlannerColorCodeDto (eventCount 0), meta: {} }`.
- **Seed:** the first add returns "New color code", **pink**, position 7.

### 3.7 `PATCH /planner/color-codes/:id`

- **Controller:** `@Patch('planner/color-codes/:id') @RequirePermissions('planner.configure')`, body `plannerColorCodeUpdateSchema` (`label?`, `tone?`, at least one).
- **Rules:** locked codes may be renamed and recoloured (Runtruck1 B16). The label is stored as typed (not trimmed, as Runtruck1); blank or whitespace-only becomes **"Untitled"** (Runtruck1's on-blur rule, enforced here so a blank label never persists). `key` and `is_locked` never change.
- **Transaction:** `SELECT … FOR UPDATE` (org + id) → 404 `PLANNER_COLOR_CODE_NOT_FOUND`; no actual change → return the code, write nothing; else update, audit `PLANNER_COLOR_CODE_UPDATED` (previous/next of `label`, `tone`), emit `PlannerColorCodeUpdated` with `changedFields`.
- **Response:** `200 { data: PlannerColorCodeDto, meta: {} }`.

### 3.8 `DELETE /planner/color-codes/:id`

- **Controller:** `@Delete('planner/color-codes/:id') @RequirePermissions('planner.configure')`.
- **Transaction** (03 §5.12.1):
  1. `SELECT id, key, label, tone, is_locked, position FROM planner_color_codes WHERE organization_id = $org ORDER BY is_locked DESC, position, id FOR UPDATE` (locks every code of the organization, so two concurrent deletes cannot remove the last two unlocked codes).
  2. The target is missing → 404 `PLANNER_COLOR_CODE_NOT_FOUND`; locked → 409 `PLANNER_COLOR_CODE_LOCKED`.
  3. `fallback` = the first **other unlocked** code in that order (Runtruck1 `categories.find(c => !c.locked && c.key !== key)`); none → 409 `PLANNER_LAST_COLOR_CODE`.
  4. `UPDATE planner_events SET color_code_id = $fallback, updated_at = now() WHERE organization_id = $org AND color_code_id = $id` → `reassignedEventCount` = affected rows.
  5. `DELETE FROM planner_color_codes WHERE organization_id = $org AND id = $id`.
  6. Audit `PLANNER_COLOR_CODE_DELETED` (previous `{key, label, tone}`, next `{reassignedToColorCodeId, reassignedEventCount}`), emit `PlannerColorCodeDeleted`. The moved events get no audit row of their own; the delete's row records the move.
- **Response:** `200 { data: { id, reassignedToColorCodeId, reassignedEventCount }, meta: {} }`.
- **Seed:** Maintenance → Driver schedule, 3; Driver schedule → Maintenance, 5; Meetings → Maintenance, 29; Billing & admin → Maintenance, 5; a new code → the first unlocked code, 0.

### 3.9 `GET /planner/stop-values`

Everything the page needs about load stops **independently of the visible range** (Runtruck1 derives it from `all`, every date).

- **Controller:** `@Get('planner/stop-values') @RequirePermissions('planner.view')`. No query.
- **`driver`, `customer`, `truck`:** over every load-stop event of §2.4 (all dates, board loads), the value `valueOf(ev, by)`: the event's `driver` / `customer` / `truck`, and **"Unassigned"** when it is empty or already "Unassigned"; distinct; sorted with JavaScript's default `Array.prototype.sort()` (UTF-16 code units, like Runtruck1), **not** by database collation.
- **`sampleEvent`** (Event-cards preview, Runtruck1 `sampleEv`): the first `pickup` stop event in §2.5 order (first pickup of the first board load); else the first office event in §2.5 order; else `null`. Full `PlannerEventDto`.
- **Without `loads.view`:** empty lists, sample from office events (§2.3).
- **Seed:**
  - `driver`: Ana Cortez, Dara Whitfield, Ellis Nakamura, Marcus Hale, Priya Raman, Tobias Frey, Unassigned
  - `customer`: Bayline Distribution, Cascade Building Supply, Harbor Point Retail, Northgate Foods, Sierra Ag Partners
  - `truck`: T-103 / RF-27, T-107 / DV-51, T-109 / FB-04, T-114 / DV-88, T-114 / RF-88, T-118 / DV-14, T-121 / FB-12, Unassigned
  - `sampleEvent`: L-40218 pickup, "L-40218 · Fresno, CA", 2026-09-03 10:30–12:30, place "Fresno, CA".
- **Query plan:** at most three statements: `SELECT DISTINCT` driver label, customer name, unit label over the §2.4 join (no date predicate); the sample (`… AND s.kind = 'pickup' ORDER BY l.created_at DESC, l.load_number DESC, s.sequence LIMIT 1`); only when that is empty, the first office event (`ORDER BY` §2.5 `LIMIT 1`).
- **Response:** `200 { data: PlannerStopValuesDto, meta: {} }`.

### 3.10 `GET /planner/related-loads`

The EventDialog "Related load" options (Runtruck1 lists every load of the board as `${id} · ${route}`).

- **Controller:** `@Get('planner/related-loads') @RequirePermissions('planner.manage', 'loads.view')`, query `plannerRelatedLoadsQuerySchema` (`q`, `limit` 1–500 default 500, `offset`).
- **Rows:** board loads (`archived_at IS NULL`), board order `created_at DESC, load_number DESC` (03 §6.4). `PlannerRelatedLoadDto = { id, loadNumber, route }`, `route` = first pickup label + " → " + last delivery label (03 §6.0.3, the same helper as `GET /loads`, §10). Only these three fields: no money or party data is sent for a select list.
- **`q`:** over `formatLoadNumber(loadNumber)` and `route` (§2.6 semantics). The web does not send it.
- **Seed** (8 rows): L-40218 Fresno, CA → Reno, NV · L-40219 Stockton, CA → Salt Lake City, UT · L-40220 Sacramento, CA → Boise, ID · L-40221 Oakland, CA → Portland, OR · L-40214 Bakersfield, CA → Phoenix, AZ · L-40212 Los Angeles, CA → Las Vegas, NV · L-40210 Modesto, CA → Denver, CO · L-40222 Redding, CA → Seattle, WA.
- **Query plan:** two statements: the page of board loads (partial index `loads_org_board_idx`), then the pickup/delivery stops of those loads (`load_id = ANY($ids)`, `LEFT JOIN facilities`), composed in memory.
- **Response:** `200 { data: PlannerRelatedLoadDto[], meta: { total, limit, offset } }`.

### 3.11 `POST /planner/reset`

D8: "Reset calendar" restores the default events and color codes **for the whole organization**: the organization's **own** defaults, chosen by `organizations.planner_defaults` (03 §2.1, §5.12.2). Runtruck1's demo events name the demo tenant's staff, customers and invoices ("Rosa Medina", "Northgate Foods quarterly review", "INV-8836, 41 days past due"), so they are restored only for the organization seeded with them and never written into another tenant.

| `planner_defaults` | restored | who has it |
|---|---|---|
| `standard` (default) | the six color codes of 03 §7.24, no events | every organization except the demo (Test Carrier Co, future tenants) |
| `runtruck1_demo` | the six codes and the 42 events of 03 §7.25, with their seeded `created_at` values (§2.5) | Sunridge Freight, set by the demo seed only |

- **Controller:** `@Post('planner/reset') @HttpCode(200) @RequirePermissions('planner.reset')`, body `plannerResetSchema` (`{}`; any key is a 400).
- **Transaction** (03 §5.12.2):
  1. `SELECT id FROM planner_color_codes WHERE organization_id = $org FOR UPDATE` (a concurrent event create waits on its share lock, then finds its code gone and gets a 400).
  2. Count the current events and codes (the audit's `previous`).
  3. `DELETE FROM planner_events WHERE organization_id = $org`, then `DELETE FROM planner_color_codes WHERE organization_id = $org`.
  4. `insertPlannerDefaults(tx, ctx.organizationId)` from `@runtruck/database/seed`, the **same function the seed uses** (§10): it reads the organization's `planner_defaults`, inserts the six codes (new ids) and, for `runtruck1_demo` only, the 42 events (`created_by_user_id` null), and returns `{ colorCodeCount, eventCount }` of what it wrote.
  5. Audit `PLANNER_RESET` (entity `organization`, previous `{eventCount, colorCodeCount}` before, next = the counts step 4 returned), emit `PlannerReset` with those counts.
- **Response:** `200 { data: { eventCount, colorCodeCount }, meta: {} }` with the **real** counts written: `{ eventCount: 42, colorCodeCount: 6 }` for Sunridge Freight, `{ eventCount: 0, colorCodeCount: 6 }` for any `standard` organization.
- **Refusal:** without `planner.reset` → 403 `FORBIDDEN`, nothing changes (the control stays visible for everyone, 07 §5).
- **Open for the product owner (P10):** D8 says Reset restores "the default events and color codes"; this document reads "default events" as Runtruck1's demo events **for the demo organization only**. Confirm, or specify what another organization's default events are (they would then need per-organization storage, 03 first).

## 4. DTO reference

### 4.1 `PlannerEventDto`

| field | type | office event (`planner_events e`) | load-stop event (§2.4) |
|---|---|---|---|
| `id` | uuid | `e.id` | `s.id` |
| `readOnly` | boolean | `false` | `true` |
| `title` | string | `e.title` | `L-{n} · {place}` |
| `colorCodeId` | uuid | `e.color_code_id` | locked code id |
| `colorCodeKey` | string | `pc.key` of `e.color_code_id` | `'pickup'` \| `'delivery'` |
| `date` | `YYYY-MM-DD` | `e.start_date` | `s.appointment_date` |
| `endDate` | `YYYY-MM-DD` \| null | `e.end_date` | `null` |
| `start`, `end` | `HH:MM` \| null | `e.start_time`, `e.end_time` (both null = all-day) | planned slot → window → 08:00/09:00 |
| `timezone` | IANA | `organizations.timezone` (`ctx.timezone`) | `s.timezone` |
| `place` | string \| null | `e.place` | stop route label |
| `notes` | string \| null | `e.notes` (as stored) | `{facility_name} · {customer}` |
| `people` | string[] | `e.people` (`[]` = none) | `[driver label]` |
| `loadId` | uuid \| null | `e.load_id` | `l.id` |
| `loadNumber` | integer \| null | `l.load_number` via `e.load_id` (archived loads included) | `l.load_number` |
| `facility` | string \| null | `null` | `s.facility_name` |
| `customer` | string \| null | `null` | `customers.name` |
| `driver` | string \| null | `null` | driver label (`'Unassigned'` possible) |
| `truck` | string \| null | `null` | unit label, `''` when none |
| `commodity` | string \| null | `null` | `l.commodity` |

`null` on an office event plays the role of Runtruck1's missing property (e.g. the "Driver" card line falls back to `people[0]` because `driver` is null).

Seed examples: ev-1 → `{ readOnly: false, title: "Tobias Frey — home time", colorCodeKey: "driver", date: "2026-09-01", endDate: "2026-09-06", start: null, end: null, timezone: "America/Los_Angeles", place: null, notes: "Back on duty Mon Sep 7.", people: ["Tobias Frey"], loadId: null, loadNumber: null, facility: null, customer: null, driver: null, truck: null, commodity: null }`. L-40218 pickup → `{ readOnly: true, title: "L-40218 · Fresno, CA", colorCodeKey: "pickup", date: "2026-09-03", endDate: null, start: "10:30", end: "12:30", timezone: "America/Los_Angeles", place: "Fresno, CA", notes: "Northgate Cold Storage · Northgate Foods", people: ["Marcus Hale"], loadNumber: 40218, facility: "Northgate Cold Storage", customer: "Northgate Foods", driver: "Marcus Hale", truck: "T-114 / RF-88", commodity: "Frozen produce" }`.

### 4.2 Other types

- `PlannerEventsMeta = PageMeta & { from, to }`.
- `PlannerColorCodeDto = { id, key, label, tone: PlannerTone, locked, eventCount }`; `PlannerColorCodesMeta = { total }`.
- `PlannerEventDeleteResultDto = { id }`; `PlannerColorCodeDeleteResultDto = { id, reassignedToColorCodeId, reassignedEventCount }`.
- `PlannerStopValuesDto = { driver: string[], customer: string[], truck: string[], sampleEvent: PlannerEventDto | null }`.
- `PlannerRelatedLoadDto = { id, loadNumber, route }` with `meta: PageMeta`.
- `PlannerResetResultDto = { eventCount, colorCodeCount }`.

## 5. Audit actions and domain events

Every write runs in one transaction that changes the rows, then calls `AuditService.record(tx, ctx, …)` and `EventsService.emit(tx, ctx, …)` (04 §7, 17 §2). Names and payloads are 17 §5's. Audit rows carry the editable fields (`title, colorCodeId, date, endDate, start, end, place, notes, people, loadId` for events; `key, label, tone` for codes); event payloads carry ids only (17 §3).

| endpoint | audit `action` · `entityType` · `entityLabel` | `previous` → `next` | event `type` · aggregate | payload |
|---|---|---|---|---|
| `POST /planner/events` | `PLANNER_EVENT_CREATED` · `planner_event` · title | — → all fields | `PlannerEventCreated` · `planner_event`, id | `plannerEventId`, `colorCodeId`, `startsOn` |
| `PATCH /planner/events/:id` | `PLANNER_EVENT_UPDATED` · `planner_event` · title | changed fields → changed fields | `PlannerEventUpdated` | `plannerEventId`, `changedFields[]` |
| `DELETE /planner/events/:id` | `PLANNER_EVENT_DELETED` · `planner_event` · title | all fields → — | `PlannerEventDeleted` | `plannerEventId` |
| `POST /planner/color-codes` | `PLANNER_COLOR_CODE_CREATED` · `planner_color_code` · label | — → `{key, label, tone}` | `PlannerColorCodeCreated` · `planner_color_code` | `colorCodeId` |
| `PATCH /planner/color-codes/:id` | `PLANNER_COLOR_CODE_UPDATED` · `planner_color_code` · label | changed → changed | `PlannerColorCodeUpdated` | `colorCodeId`, `changedFields[]` |
| `DELETE /planner/color-codes/:id` | `PLANNER_COLOR_CODE_DELETED` · `planner_color_code` · label | `{key, label, tone}` → `{reassignedToColorCodeId, reassignedEventCount}` | `PlannerColorCodeDeleted` | `colorCodeId`, `reassignedToColorCodeId`, `reassignedEventCount` |
| `POST /planner/reset` | `PLANNER_RESET` · `organization` (id = org) · organization name | `{eventCount, colorCodeCount}` before → after | `PlannerReset` · `organization`, org id | `eventCount`, `colorCodeCount` (after) |

No-op PATCHes (§3.3 step 4, §3.7) write neither. Reads are not audited. A request that fails validation or authorization writes nothing.

## 6. Computed values and D5

Every figure the planner shows is computed from stored rows, and against the seed **every one equals Runtruck1's**. The planner has no D5 difference.

| value | rule | seed = Runtruck1 |
|---|---|---|
| load-stop events | §2.4 | 16 events, the §2.4 table |
| "N events this month" (web, §7.3) | events returned for the month grid whose `date` starts with the cursor month, after hidden codes and search | Sep 2026 **50**, Aug 2026 **8**, Oct 2026 **0** |
| color code `eventCount` / delete message count | §3.5 | Maintenance 3, Driver schedule 5, Meetings 29, Billing & admin 5 |
| value lists and default value tones (web) | §3.9 | 7 drivers, 5 customers, 8 units (port spec §5.5 tones) |
| Event-cards sample | §3.9 | Fresno, CA / 10:30 AM – 12:30 PM / L-40218, amber |
| Related load options | §3.10 | 8 options |

Stored texts stay verbatim even where other screens now compute different figures: ev-11's notes "On-time 96%" and ev-13's "41 days past due" are notes, not figures (03 §7.25, D6).

## 7. Web mapping: Planner (`/app/planner`)

The page ports Runtruck1's `PlannerPage`, `EventDialog`, `CalendarSettings`, `lib/dates.ts` and `calendar.css` verbatim (layout, occurrence expansion, lane layout, geometry, colour logic, card lines, texts). Only the data sources change: `events` and `categories` come from the API through TanStack Query, `loads` is replaced by `stop-values` and `related-loads`, and `TODAY` is `me.today`. The date and time helpers (`iso`, `fromIso`, `addDays`, `addMonths`, `startOfWeek`, `toMinutes`, `toHhmm`, `formatTime`, `shortLabel`, `MONTHS`, `WEEKDAYS`) are Runtruck1's `lib/dates.ts`, ported into `apps/web/src/lib/dates.ts` (planner presentation); `formatLoadNumber` comes from `@runtruck/calculations`.

### 7.1 Calls and cache keys

| when | call | query key |
|---|---|---|
| page mount and every cursor / view / week-start change | `GET /planner/events?from=&to=` with the visible range: **Day** `from = to = iso(cursor)`; **Week** `from = startOfWeek(cursor, weekStart)`, `to = from + 6` (always 7 days, even with weekends hidden); **Month** `from = startOfWeek(first of month, weekStart)`, `to` = the last day of the last grid week (the grid loop of port spec §5.10, unfiltered by weekends). The month count needs every event whose start date is in the month, and this range always contains the whole month. | `['planner', 'events', from, to]` |
| page mount | `GET /planner/color-codes` | `['planner', 'color-codes']` |
| page mount | `GET /planner/stop-values` | `['planner', 'stop-values']` |
| EventDialog opens, only when `can('planner.manage', 'loads.view')` | `GET /planner/related-loads` | `['planner', 'related-loads']` |

The first paint has the calendar (implementation-brief §4 rule 1, which governs every ported page): the server prefetches the events of the default range, the codes and the stop values, and renders the grid with the default view settings. Saved prefs are read from `localStorage` only after hydration (port spec §14.3) and applied at once; Runtruck1's initial-scroll effect depends on `firstStart`, so it runs again with the final value (scrollTop 0 for the default week, 100 for Day Sep 3). Default settings are written to `localStorage` only when the member changes something. Queries refetch on focus: the calendar is shared, so other members' changes appear.

### 7.2 View model: DTO → Runtruck1 `PlannerEvent`

The ported code keeps operating on Runtruck1's `PlannerEvent` shape; `toPlannerEvent(dto)` builds it (same keys, `null` → absent):

| Runtruck1 key | from | seed (L-40218 pickup) |
|---|---|---|
| `id` | `dto.id` | stop uuid |
| `title` | `dto.title` | "L-40218 · Fresno, CA" |
| `category` | `dto.colorCodeKey` | "pickup" |
| `date` | `dto.date` | "2026-09-03" |
| `endDate` | `dto.endDate ?? undefined` | — |
| `start`, `end` | `dto.start ?? undefined`, `dto.end ?? undefined` | "10:30", "12:30" |
| `place` | `dto.place ?? undefined` | "Fresno, CA" |
| `notes` | `dto.notes ?? undefined` | "Northgate Cold Storage · Northgate Foods" |
| `people` | `dto.people` | ["Marcus Hale"] |
| `loadId` | `dto.loadNumber === null ? undefined : formatLoadNumber(dto.loadNumber)` | "L-40218" |
| `facility`, `customer`, `driver`, `truck`, `commodity` | `dto.x ?? undefined` (`truck` keeps `''`) | "Northgate Cold Storage", "Northgate Foods", "Marcus Hale", "T-114 / RF-88", "Frozen produce" |
| `readOnly` | `dto.readOnly \|\| undefined` | true |

The view model also carries, outside the search object, `colorCodeId` and `loadUuid` (`dto.loadId`) for writes. Codes map to Runtruck1's `Category`: `{ key: c.key, label: c.label, tone: c.tone, locked: c.locked }` in API order, with `id` and `eventCount` kept alongside. `all = [...officeVms, ...stopVms]` is exactly the API order (§2.5).

### 7.3 Display strings

| element | source → display (Runtruck1 formula) | seed |
|---|---|---|
| Badge, title | `cursor` from `me.today`; `MONTHS`, `WEEKDAYS` | `SEP` / `3`; "Thursday, September 3, 2026" (Day), "September 2026" (Week, Month) |
| Week range | `shortLabel(days[0]) – shortLabel(days[last])` | "Mon, Aug 31 – Sun, Sep 6" |
| Month count | `${shown.filter(e => e.date.startsWith(month)).length} events this month` over the returned events | "50 events this month" (Aug "8", Oct "0") |
| Legend (type mode) | codes in API order: dot `t-${tone}` + `label` | Loaded (pickup), Empty (delivery), Maintenance, Driver schedule, Meetings, Billing & admin |
| Legend (value mode) | unlocked codes, then `stopValues[colorBy]` with `valueTone(v) = prefs.valueTones[`${colorBy}:${v}`] ?? TONES[values.indexOf(v) % 10]` | drivers: Ana Cortez amber … Unassigned pink |
| Card lines | `field(place)` = `place`; `time` = `formatTime(start) – formatTime(end)` or "All day"; `load` = `loadId` (formatLoadNumber); `category` = code label or "Uncategorized"; `driver` = `driver ?? people[0]`; `truck`, `customer`, `facility`, `commodity`, `title` | "Fresno, CA" / "10:30 AM – 12:30 PM" / "L-40218"; standup "Dispatch standup" / "8 AM – 8:30 AM" |
| Popover kind | `${code.label ?? 'Uncategorized'}${loadId ? ` · ${loadId}` : ''}` (CSS upper-case) | "LOADED (PICKUP) · L-40218" |
| Popover meta | `shortLabel(occurrence date)` + time range, or "All day" / `Until ${shortLabel(endDate)}` | "Thu, Sep 3" · "10:30 AM – 12:30 PM"; ev-1 on Sep 3: "Until Sun, Sep 6" |
| Popover details | City, state `place`; Facility; Customer; Truck (`''` hidden); Commodity | Fresno, CA · Northgate Cold Storage · Northgate Foods · T-114 / RF-88 · Frozen produce |
| Popover notes | office events only (`!readOnly`) | ev-3 "Approve driver settlements before Friday." |
| Popover people | `people` without "Unassigned", initials of the first 3, names or `+${n-3} more` | "MH" "Marcus Hale"; ev-10 "RM" "MH" "DW" "+3 more" |
| Open load | `Link href={`/app/loads/${loadId}`}` text `Open load ${loadId}` | "Open load L-40218" → `/app/loads/L-40218` |
| Read-only hint | `readOnly` | "From the load board — change it on the load." |
| EventDialog "Color code" | codes where `!locked \|\| key === category`, option value = key, text = label | Maintenance, Driver schedule, Meetings, Billing & admin |
| EventDialog "Related load" | `None` + related loads: value `formatLoadNumber(loadNumber)`, text `${formatLoadNumber(loadNumber)} · ${route}` | "L-40218 · Fresno, CA → Reno, NV" |
| Customize › Color codes | codes; note "From the load board" / "Not used while coloring by driver"; palette `plannerToneSchema.options` order | 6 rows |
| Customize › value colors | `stopValues[colorBy]` | "Driver colors": 7 rows |
| Event-cards preview | `sampleEvent` → `occurrencesOn([vm], vm.date)[0]` → `look.lines`, `look.tone`; `null` → `{ lines: ['Fresno, CA'], tone: 'amber' }` | "Fresno, CA" / "10:30 AM – 12:30 PM" / "L-40218", amber |
| Delete-code confirm | `Delete “${label}”? Its ${eventCount} event${eventCount === 1 ? '' : 's'} move to “${fallback.label}”.` with `fallback` = first other unlocked code in list order | "Delete “Meetings”? Its 29 events move to “Maintenance”." |

### 7.4 Search parity

The top-bar query filters `all` exactly as Runtruck1 does, with the shared `matchesQuery` (`apps/web/src/lib/search.ts`) over this object and **no other keys** (so ids, `colorCodeId`, `loadUuid`, `loadId` and `commodity` are never matched):

```ts
{ title: ev.title, place: ev.place, notes: ev.notes, people: ev.people?.join(' '), customer: ev.customer, truck: ev.truck }
```

Seed checks: "l-40218" → the two L-40218 stop events only (a related-load office event is not matched); "hale" → L-40218 and L-40212 stops (people), ev-10 (people) and ev-14 (title, people); "modesto" → ev-2 and ev-5 (notes) and the L-40210 pickup (title, place); "unassigned" → the two L-40221 stops. The search applies to the grids and the month count, not to the legend, the value lists or the preview.

### 7.5 Writes

Every write goes through the API; on success the page updates its cache and invalidates the listed keys, so the screen then looks exactly as Runtruck1's would. There is no optimistic failure UI in Runtruck1; a refused or failed write shows `window.alert(error.message)` (the native dialogs this page already uses) and changes nothing locally.

| Runtruck1 interaction | request | after success |
|---|---|---|
| EventDialog **Add event** (new) | `POST /planner/events` with the body below | close the dialog; invalidate `['planner','events']`, `['planner','color-codes']`, `['planner','stop-values']` |
| EventDialog **Save** (edit) | `PATCH /planner/events/:id` with the full body below | same |
| Popover **Delete**, EventDialog **Delete** (no confirmation, B7) | `DELETE /planner/events/:id` | close popover / dialog; same invalidations |
| Code name typing | cache updated on every keystroke (legend follows live); `PATCH /planner/color-codes/:id {label}` debounced 400 ms and flushed on blur; on blur a blank value becomes "Untitled" locally, as Runtruck1 | the server response is written back only when the input is not focused |
| Code swatch | `PATCH /planner/color-codes/:id {tone}` | invalidate `['planner','color-codes']` |
| **+ Add color code** | `POST /planner/color-codes {}` | invalidate `['planner','color-codes']` |
| Code **Delete** | client: no other unlocked code → `alert('Keep at least one color code for your own events.')`; `eventCount > 0` → the confirm of §7.3; then `DELETE /planner/color-codes/:id` | `pref('hidden', hidden without the key)`; invalidate `['planner','color-codes']`, `['planner','events']` |
| **Reset** (after Runtruck1's `window.confirm`) | `POST /planner/reset` | `setPrefs(DEFAULT_PREFS)`; invalidate `['planner']`. On refusal (403) nothing changes, prefs included |

Event body built on Save (Runtruck1 `EventDialog` save, with the `start`/`end` defaults `e.start ?? '09:00'`, `e.end ?? '10:00'`):

```ts
const timed = !allDay && start !== '';           // B5: a cleared "Starts" saves the event all-day
{
  title: e.title.trim(),
  colorCodeId: codes.find((c) => c.key === e.category)!.id,
  date: e.date,
  endDate: allDay && e.endDate && e.endDate > e.date ? e.endDate : null,
  start: timed ? start : null,
  end: timed ? end : null,
  place: e.place?.trim() || null,
  notes: e.notes ?? null,                         // untrimmed (B6)
  people: (e.people ?? []).map((p) => p.trim()).filter(Boolean),
  loadId: e.loadId ? (relatedLoads.find((l) => formatLoadNumber(l.loadNumber) === e.loadId)?.id ?? original.loadUuid ?? null) : null,
}
```

The client-side checks (`badTitle`, `badDate`, `badEnd`, the `tried` flag and the "Must be after the start" / "Must be on or after the start date" messages) stay exactly as Runtruck1's; the API applies the same rules (§2.7). "+ Add Event", slot and month-cell clicks default to the first unlocked code and 09:00–10:00 or the snapped slot + 1 h, as Runtruck1.

### 7.6 Controls and permissions

Per 07 §5–§6.3 (hiding is a convenience; the API decides): "+ Add Event", empty-slot and month-cell create, popover Edit / Delete and EventDialog Save / Delete need `planner.manage`; color-code rename, recolour, add and delete need `planner.configure`; **Reset stays visible for everyone** and is refused by the API without `planner.reset` (D8). For Rosa (Admin) the page is identical to Runtruck1. Without `loads.view` the Related load select shows only "None" (an existing link is kept on save, because the body carries the unchanged `loadUuid`).

### 7.7 What the web no longer stores

`runtruck-planner-events` and `runtruck-planner-categories` are not read or written: events and codes are organization data (D8). A value left in a browser by Runtruck1 is ignored.

### 7.8 What stays in the browser

`runtruck-planner-prefs` (`view`, `weekStart`, `showWeekends`, `dayStart`, `dayEnd`, `density`, `hour24`, `hidden`, `colorBy`, `valueTones`, `cardLines`) with Runtruck1's `DEFAULT_PREFS` and `revivePrefs`, plus the in-memory cursor, popover, dialog drafts and settings page (port spec §9, §11.5). `hidden` stores color-code **keys** (stable across renames and Reset) and `${colorBy}:${value}` keys, as Runtruck1.

## 8. Runtruck1 quirks (D6)

| # (port spec §15) | handling |
|---|---|
| B1 Thursday | reproduced: real dates from `me.today` (2026-09-03 is a Thursday). |
| B2 planner slot ≠ Loads window | reproduced: both stored (`planned_start/end` for the planner, `window_open/close` for the Loads pages). |
| B3 year hard-coded to 2026 | **not reproduced**: stop events use the stored `appointment_date`, which carries its year. Visible only for a load dated outside 2026. |
| B4 single-bound window → 08:00–09:00 | reproduced by the API (§2.4). |
| B5 cleared "Starts" → all-day | reproduced by the web's body builder (§7.5); the API never stores an end time without a start (CHECK `planner_events_time_ck`). |
| B6 untrimmed notes | reproduced: the API stores notes as sent. |
| B7 no confirmation on event delete | reproduced (web). |
| B8–B12, B17, B19, B20 | presentation, reproduced by the ported web code. |
| B13 loose revive | not applicable to events and codes (API-validated); `revivePrefs` kept as is for prefs. |
| B14 link to a vanished load | not applicable: loads are never deleted; an archived related load stays linked (§3.3). |
| B15 `slate` fallback; id collisions | fallback reproduced (§3.6); ids are server UUIDs. |
| B16 locked codes renamable and recolourable | reproduced (§3.7). |
| B18 month prefix parsing | not applicable: dates are stored, never parsed from "Sep 3". |

## 9. Tests (API integration, `apps/api/test`)

1. **Seed ranges:** as Rosa, the four requests of §3.1 return totals 27 / 6 / 52 / 33 in §2.5 order (the week: standups Aug 31 – Sep 4, then ev-1 … ev-7, then the stop events); the L-40218 pickup and ev-1 DTOs equal §4.1 byte for byte; no event belongs to an archived load (the uninvoiced loads' Sep 1–2 stops are absent).
2. **Color codes:** `GET` returns the §3.5 order and counts; `POST {}` gives "New color code" / pink / key `code-<id>`; `PATCH {label: '  '}` stores "Untitled"; deleting Meetings moves 29 events to Maintenance; deleting a locked code → 409 `PLANNER_COLOR_CODE_LOCKED`; deleting down to the last unlocked code → 409 `PLANNER_LAST_COLOR_CODE`.
3. **Events:** create timed and all-day events; `endDate = date` is stored null; `end <= start`, `endDate < date`, `endDate` more than 366 days after `date`, `endDate` with times, a locked `colorCodeId`, an archived `loadId` → 400 with the §2.7 issue; `GET /planner/events?from=0000-01-01&to=0000-01-02` → 400, not 500; PATCH a stop-event id → 404; a no-op PATCH writes no audit row.
4. **Stop values and related loads:** §3.9 and §3.10 seed lists; a load created with `POST /loads` appears first in related loads, its stops appear as events with the window or 08:00–09:00 rule, and it becomes the sample.
5. **Reset:** as Rosa, after edits, `POST /planner/reset` returns 42 / 6, the codes have their default keys and new ids, the events have the seeded `created_at` values (§2.5 order holds again), one `PLANNER_RESET` audit row and one `PlannerReset` outbox row exist. As the Test Carrier Co owner, Reset returns 0 / 6 and writes no event: no row of that organization contains a Sunridge name, customer or invoice ("Rosa Medina", "Northgate", "INV-8836"), and Sunridge's calendar is unchanged. (The shared insert function's two cases are already covered by `apps/api/test/seed.int.test.ts`.)
6. **Permissions:** Accounting (planner.view only) → `POST /planner/events` 403; Dispatcher → events 201, color-code writes 403, reset 403; a member without `loads.view` gets office events only, empty stop values and 403 on related loads and on setting `loadId`.
7. **Tenant isolation:** the Test Carrier Co member sees none of Sunridge's events or codes; PATCH/DELETE of Sunridge's event or code ids → 404; a body with Sunridge's `colorCodeId` or `loadId` → 400; their Reset leaves Sunridge unchanged; `organizationId` in a body → 400.
8. **Audit and outbox:** each write of §5 leaves exactly one audit row and one outbox row with the caller's `organization_id`; failed validation or authorization leaves none.

## 10. Cross-domain dependencies

| needed from | what | owner |
|---|---|---|
| Loads module (`apps/api`) | Exported SQL helpers for the stop route label, route (first pickup / last delivery), driver label and unit label (03 §6.0.3), so the planner, `GET /loads` and the Dashboard compose them identically. | loads group |
| `POST /loads` | Stops of New Load keep `facility_id` null for free-text facilities and store `state` upper-cased (`toLoad`), so a created stop's `place` equals Runtruck1's `cityState(address)`. | loads group |
| New Load mutation (web) | On success also invalidate `['planner']` (new stop events, related loads, stop values, sample). | loads group |
| `GET /loads/by-number/:loadNumber` | "Open load L-…" of an office event linked to a since-archived load follows loads.md's C8 decision (resolve the archived load, or the D6 fallback to the first board load). | loads group |
| `@runtruck/database` seed | **Done.** `insertPlannerDefaults(tx, organizationId)` (exported from `@runtruck/database/seed`) inserts the organization's defaults per `planner_defaults` (§3.11): the codes of 03 §7.24 and, for `runtruck1_demo`, the events of §7.25 with **explicit `created_at`** values (`PLANNER_DEFAULTS_CREATED_FROM` + i s, §2.5). It returns `{ colorCodeIds, colorCodeCount, eventCount }`. Used by `db:seed`, the test fixtures and `POST /planner/reset`. | database / seed owner |
| Test fixtures | **Done.** Test Carrier Co (`standard`) gets the six codes through the same function, plus one fixture event, so isolation tests have its own codes with the same keys as Sunridge's. | database / seed owner |
| 07-roles-permissions | **Done** (07 §6.1, §6.2, §8 item 5). | permissions doc owner |
| `packages/validation/src/common.ts` | **Done.** `businessDateSchema` (real calendar day within 1900–2999) is used by every planner date; `isoDateSchema` is now an alias of it. | validation common owner |

## 11. Decisions made in this document (to record in 01 §6)

| # | decision |
|---|---|
| P1 | Event order = office events by `created_at, start_date, start_time NULLS FIRST, id`, then load-stop events in board order and stop sequence: reproduces Runtruck1's `all` order for every tie its stable sort can show (§2.5). |
| P2 | The EventDialog "Related load" list is `GET /planner/related-loads` (`planner.manage` + `loads.view`; id, number, route only) instead of `GET /loads` (07 §6.2 names `GET /loads`). |
| P3 | Setting or changing a related load needs `loads.view`; an office event's related load number is shown to every `planner.view` member; an unchanged link to a since-archived load is kept on edit. |
| P4 | Range-independent stop data (value lists, Event-cards sample) come from `GET /planner/stop-values`. |
| P5 | Input bounds: title ≤ 200, place ≤ 120, notes ≤ 2,000, people ≤ 50 × 100, code label ≤ 80, ≤ 100 color codes per organization, event range ≤ 42 days, an all-day event spans ≤ 366 days, dates within 1900–2999, page ≤ 500. |
| P6 | Server normalization mirrors Runtruck1's save: title, place and people trimmed; notes untrimmed (B6); blank code label → "Untitled"; `endDate = date` dropped; `endDate` with times rejected; B5 reproduced by the web body; B3 not reproduced. |
| P7 | A failed or refused planner write shows `window.alert(message)` and changes nothing; Reset resets the browser prefs only after the API succeeds. |
| P8 | Code renames are optimistic and saved with a 400 ms debounce plus on blur; no-op PATCHes write no audit row or event. |
| P9 | A malformed UUID in a path is a 400 `VALIDATION_ERROR`; an unknown or foreign one is the entity's 404; a load-stop id on an event write is `PLANNER_EVENT_NOT_FOUND`. |
| P10 | Reset restores the organization's own defaults (`organizations.planner_defaults`): the six color codes for every organization, Runtruck1's 42 demo events only for the demo organization; the response reports the real counts. **Needs the product owner's confirmation** (D8 interpretation, §3.11). |
