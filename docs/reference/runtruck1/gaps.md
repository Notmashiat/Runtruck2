# Completeness review of the Runtruck1 → Runtruck2 port specs (gaps, corrections, conflicts)

Reviewer role: completeness critic. I checked every tracked file under `Runtruck1/app` (`git ls-files app`, 65 files) against the eight specs in this folder: `shell.md`, `core-pages.md`, `planner.md`, `new-load.md`, `accounting.md`, `fleet-hr-safety.md`, `marketing.md` and `data-model.md`. I read every source file in full. I recomputed every KPI and derived value by running the prototype's own `data/*.ts` files under Node 24 (type-stripped copies, same formulas as the pages).

**Verdict.** Coverage is essentially complete. Every source file, route, component, CSS file, data constant and computed value is specified by at least one spec. I found **4 factual errors** and fixed them in place (§3). I also found **cross-spec naming conflicts** that must be reconciled before implementation (§4), and a few small behaviours that no spec states (§2).

---

## 1. Coverage matrix (source file → owning spec)

| Source (under `app/`) | Lines | Covered by |
|---|---|---|
| `index.html` | 17 | shell §2.1 (also marketing, planner, fleet-hr-safety) |
| `src/main.tsx` | 19 | shell §2.2 |
| `src/App.tsx` (all 1 + 5 index + 20 leaf + 6 legacy + catch-all routes) | 81 | shell §3; each area repeats its own routes |
| `src/components/AppLayout.tsx`, `Sidebar.tsx`, `Header.tsx`, `SectionTabs.tsx`, `TabbedSection.tsx`, `SettingsDialog.tsx`, `Card.tsx`, `Kpis.tsx`, `Tag.tsx`, `ComingSoon.tsx` | 20/55/87/29/13/114/27/24/12/28 | shell §4 |
| `src/components/Blueprint.tsx` | 23 | shell §4.9, marketing §2.13 |
| `src/components/NewLoadDialog.tsx` | 763 | new-load (whole file); core-pages §7.2 |
| `src/components/EventDialog.tsx`, `CalendarSettings.tsx` | 132/221 | planner §6, §7 |
| `src/context/AppShellContext.tsx` | 51 | shell §4.11 (+ every area) |
| `src/data/mock.ts`, `accounting.ts`, `fleet.ts`, `hr.ts`, `planner.ts`, `safety.ts` | 332/127/15/57/180/102 | data-model §5 (record by record); area specs for their screens |
| `src/lib/dates.ts`, `persist.ts` | 58/24 | planner §4, §9; shell §4.12 |
| `src/lib/search.ts`, `theme.ts` | 10/31 | shell §4.12 |
| `src/pages/app/DashboardPage.tsx`, `LoadsPage.tsx`, `LoadDetailPage.tsx`, `CustomersPage.tsx`, `FacilitiesPage.tsx` | 97/171/124/68/17 | core-pages |
| `src/pages/app/PlannerPage.tsx` | 568 | planner |
| `src/pages/app/accounting/*` (7 tabs) | 46–66 each | accounting |
| `src/pages/app/fleet/*`, `hr/*`, `safety/*` (9 tabs) | 50–108 each | fleet-hr-safety |
| `src/pages/marketing/LandingPage.tsx` | 253 | marketing |
| `src/styles/shell.css` | 332 | shell §5 (all 93 `ui-*` classes; every one is referenced in a `.tsx`) |
| `src/styles/industry.css` | 285 | shell §5.4, marketing §2.14 |
| `src/styles/app.css` | 88 | marketing (primary), shell §5.1 |
| `src/styles/calendar.css` | 165 | planner §8 (verbatim; `.cal-menu` is correctly noted as dead CSS) |
| `vite.config.ts`, `tsconfig*.json`, `.oxlintrc.json`, `vercel.json`, `package.json`, `public/favicon.svg`, `public/icons.svg` | — | shell §1, §11 |
| `README.md` | 115 | Only one passing mention (shell §10.16). See §2.1. |
| `.gitignore` | 24 | **Not covered.** It is the stock Vite ignore list, with nothing to port; Runtruck2 has its own. |
| `package-lock.json` | 1353 | **Not covered.** See §2.2 for the resolved versions. |

Mock constants: `NAV`, `USER`, `LOADS`, `stopsOf`, `CARRIERS`, `DRIVERS`, `TRUCKS`, `TRAILERS`, `CUSTOMERS`, `TOP_ACCOUNTS`, `INVOICES`, `SETTLEMENTS`, `SETTLE_TAG`, `ACTIVE_STATUSES`, `SECTION_TABS`, `COMPLIANCE`, `AR`, `REVENUE_BARS`, `REVENUE_DAYS`, `UNINVOICED`, `INVOICES_EXTRA`, `ALL_INVOICES`, `PAYMENTS`, `BATCHES`, `BILLS`, `WATCHLIST`, `CONTRACTS`, `ONBOARDING`, `MAINTENANCE`, `DRIVER_DOCUMENTS`, `VIOLATIONS`, `CLAIMS`, `TODAY` (×2), `TONES`, `DEFAULT_CATEGORIES`, `STANDUPS`, `PLANNER_EVENTS`, `loadEvents`, `cityState`, `CARD_FIELDS`, `ROW_H`, `DEFAULT_PREFS`. **All of them are covered** by data-model §5 and by the owning area spec.

---

## 2. Missing or under-specified items (add these to the build)

### 2.1 README (`app/README.md`)
The README adds nothing that the specs miss. Two small discrepancies with the code:
- It says the sidebar foot shows Member ID and Company ID. Only Settings › Profile shows them (already noted in shell §10.16).
- Its `styles/` list omits `calendar.css`, which is a fourth global stylesheet imported last in `main.tsx`.

### 2.2 Resolved dependency versions (`package-lock.json`, lockfileVersion 3, 75 packages)
The specs quote only the `package.json` ranges ("React 19.2"). The versions that actually run are **react 19.3.0, react-dom 19.3.0, react-router 7.18.3, react-router-dom 7.18.3, vite 8.3.0, @vitejs/plugin-react 6.1.1, typescript 6.0.3, oxlint 1.83.0**. When checking native `<dialog>` `onClose`/`onCancel` and `autoFocus` timing, compare against React 19.3.

### 2.3 Initial focus of the other two dialogs
new-load §3 and planner §13 specify initial focus for New Load and EventDialog. No spec states it for **SettingsDialog** or **CalendarSettings**. Both open with `showModal()` in an effect, and neither has an `autoFocus` element. By the same dialog-focusing rule, focus lands on the first focusable descendant:
- SettingsDialog: the **"Profile"** nav button.
- CalendarSettings: the **"Layout"** nav button, even when opened via "Edit colors" on the Color codes page.

Keep the same DOM order. This was not verified in a browser.

### 2.4 Escape in EventDialog discards edits silently
The planner spec says EventDialog closes on Escape. It does not stress the contrast with New Load. New Load's `onCancel` calls `preventDefault()` and asks `Discard this new load?…` when the draft is dirty. EventDialog has no `onCancel`, so Escape (or ×, or Cancel) discards an edited event **without confirmation**. CalendarSettings needs no confirm because it applies changes live. Reproduce both behaviours as they are.

### 2.5 Browser Back/Forward after "Create load"
No spec covers history. `onCreated` does `navigate('/app/loads/<id>')`, a **push**. Back therefore returns to `/app/dashboard` or `/app/loads` with the dialog closed, and the created load is still in context. In the port, the created load must still be listed on Back, which means the list has to be refetched or invalidated after the POST.

### 2.6 Dashboard revenue labels vs dates
See the corrections in §3. The API shapes proposed in core-pages §8.1 (`revenueByDay[{date, weekday, amountCents}]`) and data-model §11 (`revenueDaily[7] {date, amountCents}`) must carry the **label** `Thu…Wed` explicitly. If the web derives the weekday from `date`, it renders `Fri…Thu`, which is a visible parity break.

---

## 3. Errors found and fixed in the specs

| # | Spec and location | Was | Is (verified) | Fix applied |
|---|---|---|---|---|
| 1 | core-pages.md:3, :193, :584, :718; shell.md:3; new-load.md:3; data-model.md:5 | "today" = **Wed** 2026-09-03; "Revenue per day: Thu Aug 28 → Wed Sep 3" | 2026-09-03 is a **Thursday**. Aug 28 is a Friday, Aug 31 a Monday, Sep 1 a Tuesday and Sep 7 a Monday (`new Date(2026,8,3).toDateString()` → `Thu Sep 03 2026`). The planner renders "Thursday, September 3, 2026". Only the hard-coded `REVENUE_DAYS` and the code comments say Wednesday. accounting, planner and fleet-hr-safety already had this right. | Text corrected in all 7 places. |
| 2 | data-model.md §5.17 (line 1403) | "REVENUE_DAYS is derived: the 3-letter weekday of today−6 … today → Thu … Wed." | Deriving from the pinned date gives **Fri … Thu**, not the prototype's `Thu … Wed`. The labels must be stored or served literally. | Rewritten. |
| 3 | accounting.md §9 B5 (line 842) | If overdue is derived from due dates, Past Due shows "4 invoices / $10,540, **1** in collections, and 4 accounts" | Collections uses `ageDays > 60`, measured from the issue date. INV-8811 (67 d) and INV-8815 (63 d) both remain, so it is **2**. It would be 0 only if collections were measured in days past terms (8811 is 7 d past, 8815 33 d past). 4 / $10,540 / 4 accounts are correct. | Corrected. |
| 4 | shell.md §4.11 (line 372) | `query` read by "19 list tabs/pages via `matchesQuery`, Dashboard, Loads, Planner" | `matchesQuery(` appears in exactly **20** files: 17 table pages (CRM, 3 Fleet, 7 Accounting, 2 HR, 4 Safety) plus Dashboard, Loads and Planner. | Corrected. |

---

## 4. Cross-spec conflicts to reconcile (each spec is internally fine; together they disagree)

These are proposals. `docs/03-database.md`, `04-api.md` and `07-roles-permissions.md` do not exist yet. Pick one name for each item and apply it everywhere (ARCH §49: do not choose silently).

| Topic | shell | core-pages / new-load | accounting | fleet-hr-safety | planner | data-model |
|---|---|---|---|---|---|---|
| Uninvoiced list | `GET /api/v1/accounting/uninvoiced-loads` | – | `GET /api/v1/billing/uninvoiced-loads` | – | – | `GET /api/v1/billing/uninvoiced` |
| Approve settlements | `POST /api/v1/settlements/approve` `{payPeriodStart, scope}` | – | `POST /api/v1/settlements/approve-all` `{periodStart}` | – | – | `POST /api/v1/settlements/approve` (ids or period) |
| Load detail | – | `GET /api/v1/loads/:id` | – | – | – | `GET /api/v1/loads/by-number/:n` |
| Dashboard | – | `GET /api/v1/dashboard/summary` | – | – | – | `GET /api/v1/dashboard` |
| Contracts | – | – | – | `/employee-contracts` | – | `/hr/contracts` |
| Claims | – | – | – | `/claims` | – | `/safety/claims` |
| Planner colour codes | – | – | – | – | `/planner/categories`, table `planner_categories` | `/planner/color-codes`, table `planner_color_codes` |
| DQ items table | – | – | – | `driver_documents` (+ optional `compliance_watchlist_items`) | – | `driver_qualification_items` (watchlist derived) |
| Load financials permission | – | `loads.financials.view` | – | – | – | `loads.view_financials` |
| Driver pay permission | – | – | – | `drivers.pay.view` | – | `drivers.view_pay` |
| Violations permission | – | – | – | `safety.view` | – | `violations.view` |
| Planner permissions | – | – | – | – | `planner.categories.manage`, `planner.reset` | `planner.color_codes.manage`, `planner.admin` |
| Bills permission | – | – | `bills.view` or `payables.view` (open) | – | – | `bills.view` |

Semantic conflicts (they affect what is rendered):

1. **Invoice status model.**
   - accounting §4.2 stores `DRAFT | SENT | PAID | OVERDUE`.
   - data-model §3.4 stores `sent` and derives "Overdue" as `due_on < today`. It keeps INV-8836 overdue through a `due_on = 2026-08-23` override.
   - With pure derivation, INV-8836 (Net 60, due Sep 22) moves from Past Due to Invoiced. Past Due then shows 4 / $10,540 and Invoiced 6 rows, so parity breaks.
   - Choose one model.
2. **Compliance watchlist.**
   - fleet-hr-safety B6 says deriving it from documents gives 5 rows (not pixel-identical), so it must be stored.
   - data-model §5.15 gives a derivation that reproduces the 4 rows exactly: filter Expired/Expiring, relabel, collapse Ana's MVR and annual review into "Annual MVR review", order Expired first then `expires_on desc`. That derivation works against the seed, but the collapse and ordering rules are reverse-engineered.
   - Decide between stored and derived.
3. **"Expiring" contract rule.**
   - fleet-hr-safety: a fixed term with no renewal, no window.
   - data-model: `renewal_kind = ends` and ending within 90 d (an assumption).
   - Both give Frey only, 73 d out. Pick one.
4. **Load-stop times for created loads in the planner.**
   - The prototype turns any window without `–` (single time or "Any time") into **08:00–09:00** (`planner.ts:158`; planner B4, new-load §15.13).
   - data-model §5.16 proposes "planned slot, else appointment window, else 08:00–09:00; when only one time was given, end = start".
   - For a created stop with only "opens 06:00", the prototype draws 08:00–09:00 but the proposal draws 06:00–06:15. Parity requires the prototype rule; the proposal is a fix that needs sign-off.
5. **Seeding the 11 uninvoiced loads and the 12 historical invoice loads** (L-40168…L-40198).
   - core-pages C1/Q2 leaves it open, noting that seeding them as Delivered gives Delivered = 13 / All = 19.
   - data-model §5.9–5.10 resolves it with `archived_at` (off-board loads).
   - accounting B2/D8 defers to the Loads spec.
   - Adopt data-model's `archived_at` rule in all three specs, or reject it. `GET /loads`, the EventDialog "Related load" list and the planner stop events must all exclude archived loads to keep 8 rows.
6. **Money formatter.** core-pages §9.1 uses `'$' + Math.round(cents/100).toLocaleString('en-US')`. accounting §4.1 and data-model §2.3 use `(cents/100).toLocaleString('en-US')`. The output is identical for whole dollars and differs for cents. Pick one shared `packages/ui` formatter.

---

## 5. Spot-check log (claims verified against source by recomputation)

All of these match the prototype unless marked ✗. The ✗ items are fixed in §3.

| # | Claim (spec) | Verified value |
|---|---|---|
| 1 | Dashboard Unbilled `11` / `$34,900 waiting` (core, shell, accounting) | ✓ |
| 2 | Chart heights 57/78/69/89/100/51/39 %, Mon highlighted (core §2.3) | ✓ |
| 3 | CRM weighted on-time 50,562 / 547 = 92.43 → `92%`; unweighted 91% (core §5.2) | ✓ |
| 4 | CRM Σ AR $91,850 → `$91.9K`; Σ revenue $1,295K → `$1.3M`; top-3 share 73.05% (core §5.2, data-model F-K1: `(91.85).toFixed(1)` = `91.8`, so round first) | ✓ |
| 5 | rpm for all 8 loads; pay = 25% half-to-even; implied other cost 624/845/794/—/499/388/1186/758 (core §4.3) | ✓ |
| 6 | Batches 7 / 22 invoices / Ready 2 / $12,550 / Sent this week 2 / $59,110 (accounting §3.3) | ✓ |
| 7 | Past Due 5 / $14,660 / 2 in collections / 67 d INV-8811 / 4 of 6 accounts (accounting §3.4) | ✓ |
| 8 | Paid order 8823, 8824, 8838, 8839, 8830; days 29/26/5/3/14; avg round(77/5) = 15; collected $13,980; factored 2 / $4,940 | ✓ |
| 9 | Payroll gross $5,477, deductions $512, net $4,965; 3 ready; payable-to-approve $3,036 (accounting B11) | ✓ |
| 10 | Bills 3/$15,000, 1/$486, 2/$10,360, 2/$4,115 | ✓ |
| 11 | AR alternatives: by issue age 5/$11,520, 3/$9,210, 2/$5,450; by days past terms 6/$15,640, 3/$8,950, 1/$1,590, 0 (accounting B4) | ✓ |
| 12 | Past Due derived from terms: 4 / $10,540 / **1** in collections (accounting B5) | ✗ it is 2 (fixed) |
| 13 | Trucks avg odometer 379,690 → `Avg 380K mi`; `T-114 in 900 mi`; next closest truck 22,390 mi (fleet §4.3, data-model #32) | ✓ |
| 14 | Drivers 6 / "3 on duty · 1 home time" / 2 / "Nakamura · 1h 45m" / 4; bars 100/93/82/66/55/30 %; "9,120 mi total" | ✓ |
| 15 | Trailers "3 reefer · 3 dry van · 2 flatbed", "1 rolling · 3 at shippers", "2 at the Modesto yard" | ✓ |
| 16 | Contracts 6/10, renewals 2, owner-ops 1, drafts 1; Frey 73 d out; Onboarding 5 / 1 / 2 / 2 / 1 | ✓ |
| 17 | Maintenance 7 open / 1 done / $7,115; DQ 15 / 6 drivers / 4 expiring (before Nov 2) / 1 expired / 1 missing | ✓ |
| 18 | Violations 29 points / 7; Claims 2 open, $11,000 reserved, $24,025 paid over 3 | ✓ |
| 19 | Planner: 42 seed events (27 standups); Sep 2026 = `50 events this month`, Aug = 8; per-category counts 29/5/5/3 | ✓ |
| 20 | Planner default week geometry (e.g. Thu: L-40218:p 0/2 top 252, L-40219:p 1/2 top 336, ev-5 0/2 top 392; Sat three-lane cluster tops 0/56/140) and scrollTop 0 (week) / 100 (day) | ✓ |
| 21 | Planner default value tones (driver, customer, truck lists) and month cell counts (Sep 1: 6, Sep 4: 7, Sep 5: 5, Sep 24: 2) | ✓ |
| 22 | New Load: fresh-form errorCount 11 (2+6+2+1); example A total $2,705, rpm $5.13, margin $2,093; example B margin `-$200`; `nextId` → `L-40223` | ✓ |
| 23 | Marketing clamp breakpoints 685.7/1314.3 px (h1) and 928.6/1214.3 px (quote); button height 32.4 px | ✓ |
| 24 | data-model invoice `due_on` = issued + terms for all 16 invoices; recomputed gross would be $5,478 | ✓ |
| 25 | Weekday of 2026-09-03 | ✗ Thursday, not Wednesday (fixed) |
| 26 | `REVENUE_DAYS` derivable from today−6…today (data-model §5.17) | ✗ gives Fri…Thu (fixed) |
| 27 | "19 list tabs/pages via matchesQuery" (shell §4.11) | ✗ 17 table pages, 20 files in total (fixed) |
| 28 | Header stub count 18 and Filters on 18 screens (shell §10.10) | ✓ |
| 29 | Search "sunridge" hits 7 of 8 loads; "PO 88" hits L-40218 and L-40214 (shell §4.12) | ✓ |

---

## 6. Nothing else missing

Every route, including the case-insensitive matching, the transient pre-redirect frames and the catch-all, is specified in shell §3. Every interaction (clicks, keyboard, Escape, backdrop, `window.confirm`/`alert`, localStorage writes) is covered by at least one spec, except the small items in §2. Every piece of state is classified (a) business or (b) presentation, and the classifications agree across the specs:
- **Business (a):** created loads, settlement approval, planner events, planner colour codes.
- **Presentation (b):** query, loadTab, driverTab, openId, planner prefs, cursor, dialogs, theme.
