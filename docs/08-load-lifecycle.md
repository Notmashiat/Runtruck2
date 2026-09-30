# 08 — Load Lifecycle

The load status enum and its state machine (architecture §17, §18). Rank 6 (domain specification) in the source-of-truth hierarchy (architecture §49): the product decisions ([01](01-product-requirements.md)), security, the database specification ([03](03-database.md)), the architecture and the API specification ([04](04-api.md), [api/loads.md](api/loads.md)) outrank it.

Related: dispatch assignment [09-dispatch-lifecycle.md](09-dispatch-lifecycle.md) · documents [13-document-system.md](13-document-system.md) · columns [03 §5.6](03-database.md) · endpoints [api/loads.md](api/loads.md), [api/documents.md](api/documents.md).

---

## 1. Status enum (`load_status`)

The status is a **stored** Postgres enum (design brief §2, 03 §1.7). Each value maps 1:1 to one Runtruck1 label. Chip tone and label are web presentation (03 §4.4). Counts over statuses are computed (D5).

| value | Runtruck1 label | chip | architecture §17 state | "Active" pill | board KPI |
|---|---|---|---|---|---|
| `needs_driver` | Needs driver | amber | BOOKED (no driver, not brokered) | yes | Undispatched |
| `dispatched` | Dispatched | gray | DISPATCHED | yes | — |
| `at_pickup` | At pickup | gray | AT_PICKUP | yes | — |
| `in_transit` | In transit | blue | LOADED, IN_TRANSIT, AT_DELIVERY | yes | In transit |
| `delayed` | Delayed | amber | an in-progress load running late (no §17 state) | yes | — (not counted as In transit) |
| `needs_pod` | Needs POD | amber | DELIVERED (proof of delivery not yet received) | no ("Needs POD" pill) | Needs POD |
| `delivered` | Delivered | gray | POD_RECEIVED | no ("Delivered" pill) | Delivered |

- **Active statuses** = `needs_driver`, `dispatched`, `at_pickup`, `in_transit`, `delayed` (Runtruck1 `ACTIVE_STATUSES`; `LOAD_ACTIVE_STATUSES` in `@runtruck/validation`). **Delivered statuses** = `needs_pod`, `delivered` (03 §6.0.3).
- §17's DRAFT is not used: Runtruck1 has no draft loads, and a New Load is created complete. READY_FOR_BILLING, INVOICED and PAID are **billing facts**, not load statuses: "uninvoiced" is computed from `invoice_items` (03 §6.0.4) and payment from `payments`. A cancelled state does not exist in this release (§6).
- **Archiving is not a status.** `loads.archived_at` takes a delivered load off the dispatch board (board, planner stop events, EventDialog "Related load"); the load keeps its status. The seed archives the 23 history loads (03 §7.13–§7.14). No endpoint archives a load in this release (§6).

## 2. State diagram

```
                 create (own fleet, no driver)              create (own fleet with driver, or partner carrier)
                              │                                              │
                              ▼                                              ▼
                       ┌──────────────┐   assign (T1)                 ┌────────────┐
                       │ needs_driver │ ────────────────────────────► │ dispatched │
                       └──────────────┘ ◄──────────────────────────── └────────────┘
                                         unassign (T2)                     │  │
                                                              arrive (T3)  │  │ pick up without a recorded arrival (T5)
                                                                           ▼  │
                                                                  ┌───────────┐│
                                                                  │ at_pickup ││
                                                                  └───────────┘│
                                                          loaded (T4) │   │    │
                                                                      ▼   │    ▼
                     running late (T6, T7) ┌─────────┐  ◄──────  ┌────────────┐
                     ────────────────────► │ delayed │           │ in_transit │
                                           └─────────┘  ──────►  └────────────┘
                                           back on time (T8)          │
                            delivered late (T9)  │                    │ delivered (T10 / T11)
                                                 ▼                    ▼
                                           ┌───────────┐   POD attached (T12)   ┌───────────┐
                                           │ needs_pod │ ─────────────────────► │ delivered │
                                           └───────────┘                        └───────────┘
```

## 3. Transitions

Every transition is a backend operation (Rule 2, Rule 5): it runs in one transaction that checks the current status, changes it, writes `audit_logs` and emits the domain events to the outbox (04 §7). An illegal transition is refused with **409 `LOAD_INVALID_TRANSITION`** ("This load can't move from {from label} to {to label}."). Every transition writes the audit action **`LOAD_STATUS_CHANGED`** (`previous: {status}`, `next: {status}`, `entity_label` "L-n") and the event **`LoadStatusChanged`** `{loadId, loadNumber, from, to}`, plus the named event in the table.

| # | from → to | trigger | permission | required data / rule | named event | in this release |
|---|---|---|---|---|---|---|
| T0a | (new) → `needs_driver` | `POST /loads`, own fleet, no driver | `loads.create` | §4 | `LoadCreated` | **implemented** |
| T0b | (new) → `dispatched` | `POST /loads`, partner carrier, or own fleet with a driver | `loads.create` + `loads.assign` | §4; the assignment rules of [09 §3](09-dispatch-lifecycle.md) | `LoadCreated`, `LoadAssigned`, `LoadDispatched` | **implemented** |
| T1 | `needs_driver` → `dispatched` | assign a driver (own fleet) or a partner carrier | `loads.assign` | a live dispatch with a driver, or a partner `carrier_id` ([09](09-dispatch-lifecycle.md)) | `LoadAssigned`, `LoadDispatched` | specified (no endpoint; §6) |
| T2 | `dispatched` → `needs_driver` | unassign | `loads.assign` | own fleet; the live dispatch becomes `cancelled`; `carrier_id` returns to the own fleet | `LoadUnassigned` | specified |
| T3 | `dispatched` → `at_pickup` | arrival at the first pickup (driver app, dispatcher, tracking) | `loads.update` | first pickup stop → `arrived`, `arrived_at` set | `LoadArrivedAtPickup` | specified |
| T4 | `at_pickup` → `in_transit` | pickup completed (loaded) | `loads.update` | first pickup → `completed`, `completed_at` set | `LoadPickedUp` | specified |
| T5 | `dispatched` → `in_transit` | pickup completed without a recorded arrival | `loads.update` | as T4 | `LoadPickedUp` | specified |
| T6 | `in_transit` → `delayed` | the load runs late | `loads.update` | a reason (free text, audited) | `LoadDelayed` | specified |
| T7 | `at_pickup` → `delayed` | held at the shipper | `loads.update` | a reason | `LoadDelayed` | specified |
| T8 | `delayed` → `in_transit` | back on schedule | `loads.update` | — | `LoadDelayCleared` | specified |
| T9 | `delayed` → `needs_pod` | delivered late, POD not attached | `loads.update` | last delivery → `completed` | `LoadDelivered` | specified |
| T10 | `in_transit` → `needs_pod` | delivered, POD not attached | `loads.update` | last delivery → `completed`; the live dispatch → `completed` | `LoadDelivered` | specified |
| T11 | `in_transit` / `delayed` → `delivered` | delivered with the POD already attached | `loads.update` | as T10, and the `proof_of_delivery` slot is `attached` | `LoadDelivered` | specified |
| T12 | `needs_pod` → `delivered` | a proof of delivery is uploaded | `documents.upload` **and** `loads.update` | the upload of [api/documents.md §3](api/documents.md) attaches a `proof_of_delivery` version, and `hasPermissions(ctx.permissions, ['loads.update'])`. Without `loads.update` the POD is attached and the load status stays `needs_pod`: no `LOAD_STATUS_CHANGED` audit row and no `LoadStatusChanged` event (the upload's own audit and events are written) | `PODUploaded` (from the upload) | **implemented** (automatic, inside the upload transaction) |

Not allowed through any normal action: leaving `delivered`, going back from `needs_pod` to an in-progress status, skipping from `needs_driver` to any in-progress status (a load must be dispatched first), and any change to an archived load's status except T12 (a POD may still arrive for an archived `needs_pod` load, e.g. L-40207).

Implementation: one pure function in the loads module, `assertLoadTransition(from, to)` (`apps/api/src/loads/load-status.ts`), holds the table above; every writer calls it and throws `AppError.conflict('LOAD_INVALID_TRANSITION', …)`. Its unit test covers every pair of statuses.

## 4. Initial status on create (Runtruck1 `toLoad`)

`covered = hauledBy = 'partner_carrier' || driverId != null` (NewLoadDialog.tsx:148):

| New Load | status | carrier on the load | dispatch row |
|---|---|---|---|
| own fleet, driver chosen | `dispatched` | the organization's own-fleet carrier | driver (+ truck, trailer when chosen) |
| own fleet, no driver | `needs_driver` | the organization's own-fleet carrier (Runtruck1 quirk: an uncovered created load still shows own fleet, unlike L-40221) | truck and/or trailer when chosen, else none |
| partner carrier (with or without a driver name) | `dispatched` | the chosen partner carrier | free-text driver / truck / trailer when any is given, else none |

The server decides the status; the body carries no status. The Review note ("It goes on the board as Dispatched / Needs driver") is the web's preview of the same rule.

## 5. Stops, status and labels

- `load_stops.status` (`pending` → `arrived` → `completed`) is the stop-level fact; the load status is the load-level fact. In this release they are stored independently: created stops start `pending`; seeded stops carry the statuses that reproduce Runtruck1's labels, including its quirks (01 §6 C7: the pickups of L-40221 and L-40222 are `completed`, L-40214's delivery is `pending`).
- The detail page's stop label comes from kind + stop status (03 §6.0.5); it is **not** derived from the load status.
- Transitions T3–T11 update the stop rows named in §3 in the same transaction once they are exposed.

## 6. Not implemented in this release (tracked, never reported as done)

- **"Update status"** on the load detail top bar stays inert (01 §7). T1–T11 therefore have no endpoint. The future endpoints are `POST /loads/:id/assign`, `POST /loads/:id/unassign` ([09 §6](09-dispatch-lifecycle.md)) and `POST /loads/:id/status` `{to, reason?}` (`loads.update`).
- **Cancel** (architecture §14 `POST /loads/:id/cancel`) and **draft** loads: they need a new enum value (`ALTER TYPE load_status ADD VALUE`, 03 §1.7), which is not added until a screen needs it.
- **Archive** (`archived_at`): set only by the seed. Billing will close loads off the board when that flow exists.
- `loads.delete` ("Delete draft loads") has no use until drafts exist.

## 7. Decisions recorded here

1. Runtruck1's labels map 1:1 onto the enum (design brief §2); `delayed` is a status, not an exception flag.
2. Uploading a proof of delivery moves a `needs_pod` load to `delivered` (T12) when the uploader also holds `loads.update` ("change load status"); an uploader with `documents.upload` only attaches the file and leaves the status unchanged, so no role can change a load's status without the status permission (architecture §18: every transition declares its permission). Runtruck1 has no such flow; the transition follows architecture §17 (DELIVERED → POD_RECEIVED) and changes nothing visible in the seeded demo unless a POD is uploaded to L-40214 or an archived `needs_pod` load through the API. With today's default roles every holder of `documents.upload` also holds `loads.update`.
3. Archived loads keep their status; archiving is orthogonal.
