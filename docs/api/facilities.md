# API — Facilities

Endpoint specification for the facility register: shippers, consignees, the crossdock, the port, the yard and the shops that stops, trailer yard locations, work-order shops and claim claimants point at. It follows [04-api.md](../04-api.md); the table is [03-database.md §5.3.1](../03-database.md), seeded by 03 §7.5.

- Wire types: `packages/types/src/facilities.ts`. Input schema: `packages/validation/src/facilities.ts`.
- API module (architecture §6, `locations/`): `apps/api/src/locations/`, registered in `apps/api/src/modules/fleet-crm.ts`.

**Screen status.** `/app/facilities` is Runtruck1's "coming soon" page ([core-pages.md](../reference/runtruck1/core-pages.md) §6): static copy and a "Yard map" placeholder, no data. It **calls no endpoint** (§3). Every other screen gets facility names and places through its own DTO (load stops, trailer location, work-order shop, claimant), joined server-side. `GET /facilities` is therefore a lookup with no web consumer in this release; it is specified because the design brief names it (§2) and so that future facility pickers have a contract.

## 0. Feature summary (architecture §44)

| item | content |
|---|---|
| FEATURE | Facility lookup list. |
| PURPOSE | API contract for facilities (design brief §2 endpoint list); future pickers. |
| USERS | Dispatchers, maintenance (read). |
| PERMISSIONS | `locations.view` ([07 §6.1](../07-roles-permissions.md)). |
| DATABASE TABLES | read: `facilities`. |
| DATABASE CHANGES | none. |
| API ENDPOINTS | `GET /facilities`. |
| BUSINESS RULES | none beyond tenancy and ordering. |
| STATE CHANGES / EVENTS / JOBS / NOTIFICATIONS / INTEGRATIONS / AI | none (read-only; the Facilities page has no controls). |
| SECURITY | session auth, permission guard, organization from the session only. |
| ERROR CASES | §2.6. |
| TESTS | §4. |
| ACCEPTANCE CRITERIA | the 20 seeded facilities in the order of §2.2; tenant isolation and permission denial proven; the `/app/facilities` page renders exactly core-pages §6 without an API call. |

## 1. Clock and tenancy

No value depends on the date. Every query filters `facilities.organization_id = ctx.organizationId`; no endpoint accepts an organization id. List mechanics and `q` are as [fleet.md §1.2–§1.4](fleet.md) (all rows, then `q`, then `offset`/`limit`; `meta.total` is the filtered count).

## 2. `GET /api/v1/facilities`

| | |
|---|---|
| Permission | `locations.view` |
| Query | `facilityListQuerySchema` → `FacilityListQuery`: `limit`, `offset`, `q`. |
| Response | `FacilityListResponse` = `{ data: FacilityListItem[], meta: PageMeta }` (no `summary`: no screen shows facility KPIs). |
| Consumers | none in this release. |

### 2.1 `FacilityListItem`

| field | type | computed from |
|---|---|---|
| `id` | `string` (uuid) | `facilities.id` |
| `name` | `string` | `facilities.name` |
| `kind` | `FacilityKind` | `facilities.kind` (not displayed anywhere; no Runtruck1 label) |
| `addressLine1` | `string \| null` | `facilities.address_line1` |
| `city` | `string` | `facilities.city` (address city) |
| `state` | `string` | `facilities.state` |
| `postalCode` | `string \| null` | `facilities.postal_code` |
| `timezone` | `string` | `facilities.timezone` (IANA) |
| `marketCity` | `string \| null` | `facilities.market_city` (route-label city when it differs from `city`) |
| `marketState` | `string \| null` | `facilities.market_state` |
| `marketShort` | `string \| null` | `facilities.market_short` ("SLC") |

Route labels (`coalesce(marketCity, city) + ", " + coalesce(marketState, state)`) and short markets (`coalesce(marketShort, marketCity, city)`) are composed by the consumers that need them (03 §6.0.3); the raw columns are returned here.

### 2.2 Order

`ORDER BY lower(facilities.name) COLLATE "C", facilities.id` (names are unique per organization case-insensitively, `facilities_org_name_uq`; byte order keeps the result independent of the database locale). Seed (20 rows): Bayline DC 4, Bayline LA Annex, Boise Builders Depot, Cascade Mill, Cascade Yard 2, Duwamish Steel Yard, Front Range Foods, Harbor Point DC, Northgate Cold Storage, Northgate Creamery, Port of Oakland, Berth 22, Reno Grocers DC, Sierra Ag Huller 3, Sunridge shop, Sunridge yard, Sunset Beverage DC, Thermo King, Valley Foods DC, Valley Truck Center, Wasatch Crossdock.

Runtruck1 has no facility list, so there is no order to reproduce; alphabetical is the natural lookup order.

### 2.3 Searchable fields (`q`)

`name`, `addressLine1`, `city`, `state`, `postalCode` (the non-null ones), trimmed and lowercased substring match as `matchesQuery`.

### 2.4 Query plan

One statement: `SELECT … FROM facilities WHERE organization_id = $org ORDER BY lower(name) COLLATE "C", id` (the tenant index `facilities_org_name_uq` covers the organization filter).

### 2.5 Audit and events

None (read-only).

### 2.6 Errors

| HTTP | code | when |
|---|---|---|
| 400 | `VALIDATION_ERROR` | `limit` outside 1–500, negative `offset`, `q` longer than 200. |
| 401 | `UNAUTHORIZED` | no or expired session. |
| 403 | `FORBIDDEN` | the member lacks `locations.view`. |
| 403 | `NO_ACTIVE_MEMBERSHIP` | the account has no active organization. |
| 500 | `INTERNAL_ERROR` | anything unexpected. |

## 3. Web mapping: Facilities (`/app/facilities`)

- **Calls:** none. The page renders the static `ComingSoon` card and the `div.ui-placeholder` "Yard map" exactly as core-pages §6 (label "Coming soon", heading "Every yard, shop and dock in one register", the paragraph and the four bullets). It can be a Server Component apart from the shell's top bar.
- **Top bar:** the search input is shown and filters nothing (core-pages B14, D6); no "Filters" button and no actions.
- **Sidebar:** the Facilities item is shown when the member holds `locations.view` (07 §5). A member without it who opens the URL still gets the static page, because it reads no data.
- **View-model:** none (no rows, no search).

## 4. Tests

Integration: 20 rows in the order of §2.2 with the §7.5 columns (e.g. Wasatch Crossdock `marketShort` "SLC", Reno Grocers DC `marketCity` "Reno"); `q=modesto` → Sierra Ag Huller 3, Sunridge shop, Sunridge yard; 403 without `locations.view`; a "Test Carrier Co" member sees none of Sunridge's facilities; 400 on a bad `limit`.

## 5. Differences from Runtruck1 (D5)

None: Runtruck1 shows no facility data.

## 6. Decisions made in this document

| # | Decision | Why |
|---|---|---|
| FA1 | `/app/facilities` makes no API call; [07 §6.2](../07-roles-permissions.md)'s Facilities row ("`GET /facilities` → `locations.view`") should read "none (static page; sidebar gate `locations.view`)". | Runtruck1's page has no data (core-pages §6); fetching would add a request whose result is never shown. |
| FA2 | `GET /facilities` is ordered by name (no `position` column exists) and returns raw market columns, not composed labels. | No Runtruck1 order exists; label composition belongs to the consumer rules of 03 §6.0.3. |
