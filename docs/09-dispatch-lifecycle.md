# 09 — Dispatch Lifecycle

How a load gets its driver, truck, trailer or partner carrier (architecture §19), which assignment rules the backend enforces in this release and which are deferred. Rank 6 (domain specification): [01](01-product-requirements.md), security, [03](03-database.md), the architecture and [api/loads.md](api/loads.md) outrank it.

Related: load statuses [08](08-load-lifecycle.md) · columns [03 §5.6.1, §5.6.3](03-database.md) · the create endpoint [api/loads.md §6](api/loads.md).

---

## 1. Model

| fact | where | meaning |
|---|---|---|
| Who is responsible for moving the load | `loads.carrier_id` | the organization's **own-fleet** carrier row (`carriers.is_own_fleet`, exactly one per organization) or a **partner** carrier; null = "Not yet covered" (seeded L-40221 only) |
| What the partner is paid | `loads.carrier_rate_cents` | brokered loads only ("Carrier cost", "Carrier rate") |
| What the own driver is paid for the load | `loads.driver_pay_cents` | own-fleet loads only ("Driver pay"); never both (`loads_pay_ck`) |
| Who and what hauls it | `dispatches` (one **live** row per load, `status <> 'cancelled'`, `dispatches_org_load_active_uq`) | own fleet: `driver_id`, `truck_id`, `trailer_id` (tenant FKs); partner: free-text `driver_name`, `truck_number`, `trailer_number` (`dispatches_party_ck`); at least one of the six is set (`dispatches_not_empty_ck`) |
| Partner contact | `loads.carrier_contact_name`, `loads.carrier_phone` | New Load "Carrier dispatcher", "Carrier phone" |

Display (03 §6.0.3): the **driver label** is the live dispatch's driver full name, else its `driver_name`, else "Unassigned"; the **unit label** is the truck and trailer unit numbers (or free-text numbers) joined " / ", else "—" (the board cell reads "Unassigned").

## 2. Dispatch status (`dispatch_status`, not displayed)

```
assigned ──(load delivered: T10/T11 of 08)──► completed
    │
    └──(unassigned or replaced: T2 of 08)───► cancelled
```

- `POST /loads` writes `assigned`, with `assigned_at` = `ClockService.now()` and `assigned_by_user_id` = the caller.
- The seed writes `completed` for the delivered board loads (L-40214, L-40212, L-40210) and `assigned` for the others (03 §7.12).
- A cancelled row stays for history; a new assignment inserts a new row. Rows are never deleted by normal actions.

## 3. Assignment rules: enforced vs deferred

Assignment happens only in backend services (Rule 5, §19). In this release the only assignment path is **New Load** (`POST /loads`). **D6 governs the scope:** New Load must accept every assignment Runtruck1 accepted, unless accepting it is a security issue. Runtruck1 applied no dispatch rule at all (new-load §6.6, data-model §8 #22): Home-time drivers, in-shop trucks, trailers under inspection, drivers already on another load and a driver whose CDL expired were all assignable, and the demo data itself contains such assignments (Priya Raman on L-40214 with a CDL that expired 07/2026; FB-12 "Inspection" on L-40220).

### 3.1 Enforced now

| # | rule | why (not a D6 conflict) | failure |
|---|---|---|---|
| E1 | Setting a driver, truck, trailer or partner carrier requires **`loads.assign`** in addition to `loads.create`. | Authorization (07 §8 item 2). | 403 `FORBIDDEN` |
| E2 | Every referenced driver, truck, trailer and carrier belongs to the caller's organization. Unknown and foreign ids behave the same. | Tenant isolation (Rule 3); also enforced by the composite FKs (03 §1.3). | 400 `VALIDATION_ERROR`, issue on the field ("Driver was not found.", "Truck was not found.", "Trailer was not found.", "Carrier was not found.") |
| E3 | Own fleet ⇒ `driverId`/`truckId`/`trailerId` (references), no free text, no carrier rate; partner ⇒ free text, no references, no driver pay. | Data integrity; the body is a discriminated union (`haul`), `loads_pay_ck`, `dispatches_party_ck`. | 400 `VALIDATION_ERROR` |
| E4 | A partner carrier is a carrier with `is_own_fleet = false`; the own-fleet carrier is never chosen explicitly (it is implied by "Own fleet"). | Integrity: the own authority cannot be "brokered" to. Runtruck1's partner list is `CARRIERS.slice(1)`, so the case is unreachable from its UI. | 400 `VALIDATION_ERROR` at `haul.carrierId` ("Choose a partner carrier.") |
| E5 | The driver's employee is **active** (`employees.status = 'active'`). | Architecture Rule 5's own example ("A dispatcher cannot assign an inactive driver"). All six seeded drivers are active and Runtruck1 lists only them, so nothing Runtruck1 accepted is refused. | 400 `VALIDATION_ERROR` at `haul.driverId` ("This driver is not active.") |
| E6 | At most one live dispatch per load. | `dispatches_org_load_active_uq`; a create writes at most one row. | (cannot happen on create) |
| E7 | The partner's carrier rate is > 0 (Runtruck1 "Carrier rate"); driver pay 0 or empty means none (stored null). | Runtruck1's own validation; `loads_pay_ck`. | 400 `VALIDATION_ERROR` "Carrier rate" |

### 3.2 Deferred (evaluated by architecture §19, not enforced, because Runtruck1 accepted them — D6)

| # | rule (future) | Runtruck1 case that it would refuse | planned behaviour when introduced |
|---|---|---|---|
| D1 | Driver availability: duty status `home_time`, HOS remaining | Tobias Frey (Home time) is selectable | warning in the assign response, then a configurable block |
| D2 | Driver already on another active load (overlapping stop dates) | Marcus Hale can be put on a second load | warning |
| D3 | Driver qualification: CDL / medical card expired (`driver_documents`) | Priya Raman, CDL expired 07/2026 | **evaluated now, never blocking** (01 §6 C27): each problem is recorded as a `complianceWarnings` entry of the `LOAD_CREATED` / `LOAD_ASSIGNED` audit record ([api/loads.md §6.4](api/loads.md) item 7); switching to a block is a later product decision |
| D4 | Truck status `in_shop` / `service_due`; next service passed | T-118 (In shop) is selectable | block `in_shop`, warn `service_due` |
| D5 | Trailer status `inspection`, trailer already loaded on another live dispatch | FB-12 (Inspection) | warn |
| D6 | Trailer type vs equipment (reefer equipment needs a reefer trailer) | any trailer with any equipment | warn |
| D7 | Driver's own truck: the truck is assigned to another driver (`trucks.assigned_driver_id`) | any truck with any driver | warn |
| D8 | Location, load timing and appointment feasibility | — | needs tracking (Phase 10) |

Each deferred rule is a decision for the product owner before it is switched on (it changes what New Load accepts). They are recorded in [01 §6](01-product-requirements.md) under the loads decisions (see §7).

## 4. What New Load writes (the only path in this release)

In the create transaction ([api/loads.md §6.4](api/loads.md)), after the rules of §3.1:

- **Own fleet:** `loads.carrier_id` = the organization's own-fleet carrier (null if the organization has none), `driver_pay_cents` = the entered pay (0 → null), `carrier_rate_cents` null. If a driver, truck or trailer is chosen, one `dispatches` row `{driver_id, truck_id, trailer_id, status 'assigned'}`. The web pre-fills the truck from the driver's assigned truck (`trucks.assigned_driver_id`) only if no truck is chosen yet — a client convenience; the server stores what is sent.
- **Partner carrier:** `loads.carrier_id` = the partner, `carrier_rate_cents`, `carrier_contact_name`, `carrier_phone`; `driver_pay_cents` null. If a driver name, truck # or trailer # is given, one `dispatches` row with the free-text columns.
- **Status:** §4 of [08](08-load-lifecycle.md).
- **Audit and events:** `LOAD_CREATED` always; `LOAD_ASSIGNED` (`next: {carrierId, dispatchId, driverId, truckId, trailerId, driverName, truckNumber, trailerNumber}`, plus `complianceWarnings` when an own-fleet driver is assigned, C27) when E1 applied; events `LoadCreated`, and `LoadAssigned` `{loadId, dispatchId, carrierId, driverId, truckId, trailerId}` when E1 applied, and `LoadDispatched` `{loadId, loadNumber}` when the status is `dispatched` (payloads as [17 §5](17-event-architecture.md)). A later notification job (architecture §22: LoadAssigned → driver push) subscribes to `LoadAssigned`; none exists in this release.
- **Activity:** none for the assignment (Runtruck1's created loads show only "Load created by …" and "Driver instructions: …").

## 5. Permissions

| action | permission |
|---|---|
| Read the assignment (board, detail) | `loads.view` |
| Create a load with an assignment | `loads.create` + `loads.assign` |
| Assign / unassign later (future) | `loads.assign` |

The web hides nothing extra in New Load for members without `loads.assign` in this release (07 §5 status: control-level hiding is not implemented); the API refuses the create with 403 instead.

## 6. Future endpoints (specified, not built)

- `POST /loads/:id/assign` `{haul}` (`loads.assign`): replaces the live dispatch (old row → `cancelled`), T1 when the load was `needs_driver`; audit `LOAD_ASSIGNED`, events `LoadAssigned` (+ `LoadDispatched`).
- `POST /loads/:id/unassign` (`loads.assign`): T2; audit `LOAD_UNASSIGNED`, event `LoadUnassigned`.
- Both return the `LoadDetail` and apply §3.1 plus whichever §3.2 rules the product owner has switched on.

## 7. Decisions to record (01 §6)

- The only rules enforced at assignment in this release are E1–E7; D1–D8 are deferred because Runtruck1 accepted those assignments (D6) and none is a security issue.
- E5 (active driver) is enforced although Runtruck1 had no such rule: it is architecture Rule 5's explicit example and refuses nothing Runtruck1 could submit.
