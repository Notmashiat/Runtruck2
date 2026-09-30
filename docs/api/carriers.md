# API — Carriers

Endpoint specification for the carrier list: the organization's own operating authority and the partner carriers that brokered loads are tendered to. Its only screen consumer is the New Load dialog's "Carrier" section ([reference/runtruck1/new-load.md](../reference/runtruck1/new-load.md) §6.5, §6.10). It follows [04-api.md](../04-api.md); the table is [03-database.md §5.2.1](../03-database.md), seeded by 03 §7.4.

- Wire types: `packages/types/src/carriers.ts`. Input schema: `packages/validation/src/carriers.ts`.
- API module (architecture §6): `apps/api/src/carriers/`, registered in `apps/api/src/modules/fleet-crm.ts`.
- The carrier shown on a load (the load "Carrier" card, the Loads expand row, "Not yet covered") comes from the load DTO by the rule of 03 §6.0.3 ([loads.md](loads.md)), not from this endpoint.

## 0. Feature summary (architecture §44)

| item | content |
|---|---|
| FEATURE | Carrier lookup: own authority plus partner carriers, with MC and DOT numbers. |
| PURPOSE | New Load "Hauled by" own-fleet note, partner "Carrier" select and the Review "Carrier" line (R1), from PostgreSQL (R2). |
| USERS | Dispatchers (New Load); accounting and managers (read). |
| PERMISSIONS | `carriers.view` ([07 §6.1](../07-roles-permissions.md)). |
| DATABASE TABLES | read: `carriers`. |
| DATABASE CHANGES | none. |
| API ENDPOINTS | `GET /carriers`. |
| BUSINESS RULES | exactly one own-fleet row per organization (§3, CA3); display composition 03 §6.0.3. |
| STATE CHANGES / EVENTS / JOBS / NOTIFICATIONS / INTEGRATIONS / AI | none (read-only; Runtruck1 has no carrier-editing control). |
| SECURITY | session auth, permission guard, organization from the session only. |
| ERROR CASES | §2.6. |
| TESTS | §4. |
| ACCEPTANCE CRITERIA | the New Load own-fleet note and partner options render exactly as §3; tenant isolation and permission denial proven; architecture §45. |

## 1. Clock and tenancy

No value depends on the date. Every query filters `carriers.organization_id = ctx.organizationId`; no endpoint accepts an organization id. List mechanics and `q` are as [fleet.md §1.2–§1.4](fleet.md) (all rows, then `q`, then `offset`/`limit`; `meta.total` is the filtered count).

## 2. `GET /api/v1/carriers`

| | |
|---|---|
| Permission | `carriers.view` |
| Query | `carrierListQuerySchema` → `CarrierListQuery`: `limit`, `offset`, `q`. |
| Response | `CarrierListResponse` = `{ data: CarrierListItem[], meta: PageMeta }`. There is no `summary`: no screen shows carrier KPIs. |
| Consumers | New Load "Carrier" section (loads group). |

### 2.1 `CarrierListItem`

| field | type | computed from |
|---|---|---|
| `id` | `string` (uuid) | `carriers.id` |
| `name` | `string` | `carriers.name`, stored **without** " (own fleet)"; the web appends it when `isOwnFleet` |
| `mcNumber` | `string \| null` | `carriers.mc_number`, digits only ("812044") |
| `dotNumber` | `string \| null` | `carriers.dot_number`, digits only ("2291176") |
| `isOwnFleet` | `boolean` | `carriers.is_own_fleet` |

The own authority is **in the list**, first by position, flagged `isOwnFleet: true`, as Runtruck1's `CARRIERS[0]`.

### 2.2 Order

`ORDER BY carriers.position, carriers.id`. Seed:

| position | name | mcNumber | dotNumber | isOwnFleet |
|---|---|---|---|---|
| 1 | Sunridge Freight | 812044 | 2291176 | true |
| 2 | Valley Line Transport | 604117 | 1780342 | false |
| 3 | Cascade Reefer Express | 733905 | 2014588 | false |
| 4 | High Desert Hauling | 581230 | 1655901 | false |
| 5 | Golden State Flatbed | 690452 | 1893027 | false |

### 2.3 Searchable fields (`q`)

The Runtruck1 `Carrier` fields as display strings (view-model §3): `name` ("Sunridge Freight (own fleet)" for the own row), `mc` ("MC 604117"), `dot` ("DOT 1780342"). No screen searches carriers; `q` exists for API completeness (04 §5).

### 2.4 Query plan

One statement: `SELECT id, name, mc_number, dot_number, is_own_fleet FROM carriers WHERE organization_id = $org ORDER BY position, id` (index `carriers_org_position_idx`).

### 2.5 Audit and events

None (read-only).

### 2.6 Errors

| HTTP | code | when |
|---|---|---|
| 400 | `VALIDATION_ERROR` | `limit` outside 1–500, negative `offset`, `q` longer than 200. |
| 401 | `UNAUTHORIZED` | no or expired session. |
| 403 | `FORBIDDEN` | the member lacks `carriers.view`. |
| 403 | `NO_ACTIVE_MEMBERSHIP` | the account has no active organization. |
| 500 | `INTERNAL_ERROR` | anything unexpected. |

## 3. Web mapping: New Load "Carrier" (loads group, [loads.md](loads.md))

The dialog calls `GET /api/v1/carriers?limit=500` and keeps the order. `own = rows.find(c => c.isOwnFleet)`, `partners = rows.filter(c => !c.isOwnFleet)`.

**View-model** (`CarrierVm`, Runtruck1 `Carrier`):

| key | from `CarrierListItem` | seed |
|---|---|---|
| `name` | `` isOwnFleet ? `${name} (own fleet)` : name `` | "Sunridge Freight (own fleet)", "Valley Line Transport" |
| `mc` | `` mcNumber ? `MC ${mcNumber}` : '—' `` | "MC 812044" |
| `dot` | `` dotNumber ? `DOT ${dotNumber}` : '—' `` | "DOT 2291176" |
| `ref` | `{ id, isOwnFleet }` | |

| UI element | mapping | seed |
|---|---|---|
| Own-fleet note (Hauled by = Own fleet) | `` `${ownVm.name} · ${ownVm.mc} · ${ownVm.dot}. Assign the driver, truck and trailer in Driver & equipment.` `` | "Sunridge Freight (own fleet) · MC 812044 · DOT 2291176. Assign the driver, truck and trailer in Driver & equipment." |
| Partner "Carrier" select | first option `""` "Select a carrier", then per partner: value `id`, text `` `${vm.name} · ${vm.mc}` `` | "Valley Line Transport · MC 604117", "Cascade Reefer Express · MC 733905", "High Desert Hauling · MC 581230", "Golden State Flatbed · MC 690452" |
| Review "Carrier" | brokered → the chosen partner's `vm.name`, or "—" when none; own fleet → `ownVm.name` | "Sunridge Freight (own fleet)" |
| Section help text "Haul it with the Sunridge fleet, or broker it to a partner carrier." | `organization.shortName` from `GET /me`, not this endpoint | "Sunridge" |

## 4. Tests

Integration: five rows in position order with the own row first; `q=MC 733905` → Cascade Reefer Express; `q=own fleet` → Sunridge Freight; 403 without `carriers.view`; a "Test Carrier Co" member sees only its own carriers (none of Sunridge's); 400 on a bad `limit`.

## 5. Differences from Runtruck1 (D5)

None. Names, MC and DOT numbers and order equal Runtruck1's `CARRIERS`.

## 6. Decisions made in this document

| # | Decision | Why |
|---|---|---|
| CA1 | The New Load own-fleet note reads the `is_own_fleet` carriers row (first in `GET /carriers`), not `organizations.mc_number`/`dot_number`. | That row is what an own-fleet load references (`loads.carrier_id`), so the note equals what the load's Carrier card later shows. The organization columns hold the same values (03 §2.1, §7.1); any future "edit authority" action must update both in one transaction. |
| CA2 | `POST /loads` with "Own fleet" should resolve the own-fleet carrier on the server (the organization's `is_own_fleet` row) instead of trusting a carrier id from the client. | Rule 4 (never trust the client); requirement for [loads.md](loads.md). |
| CA3 | Every organization must have exactly one own-fleet carrier row; the database enforces "at most one" (`carriers_own_fleet_uq`), and organization provisioning (not in this release; the seed creates it, 03 §7.4) must create it. Until then the web shows "—" for a missing own row's name, MC and DOT. | The New Load own-fleet path needs it. |
