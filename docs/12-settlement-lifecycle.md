# 12 — Settlement Lifecycle

Domain specification (rank 6 in architecture §49): below the product requirements ([01](01-product-requirements.md)), security, the database specification ([03](03-database.md)), the architecture and the API document [api/settlements.md](api/settlements.md). Where this document and one of those disagree, they win and this document is corrected.

It defines driver settlements (payroll): what a settlement is, how its figures are computed, its pay periods, its state machine, and the **approval** transition, which is the one settlement write built in this release (01 §5, [24](24-development-phases.md) Phase 13). Receivables and bills are in [11-billing-lifecycle.md](11-billing-lifecycle.md).

---

## 1. Scope

- **In this release:** read the pay period's settlements (Accounting › Payroll) and approve every `ready` settlement of the period (`POST /settlements/approve`, audited, emits `SettlementApproved`).
- **Not in this release:** preparing settlements from delivered loads, holds and releases, payouts, carrier (brokered-load) settlements, deductions management, settlement history screens. Each is specified below as "Not built".

---

## 2. Data and computed figures

| Table (03) | Holds |
|---|---|
| `settlements` §5.10.1 | one row per **driver per pay period** (`settlements_org_driver_period_uq`): `period_start`, `period_end` (inclusive), the pay basis in force (`pay_basis`, `pay_rate_cents`, `pay_percent_bp`), `status`, `hold_reason` (iff `on_hold`), `approved_at` (required when `approved`), `approved_by_user_id` |
| `settlement_items` §5.10.2 | the lines: `line_pay` (≥ 0, one per paid load, with `miles` and optionally `load_id`) and `deduction` (≤ 0, no miles, no load) |

Nothing is stored as a total (D5, 03 §1.8). Per settlement:

| Figure | Rule |
|---|---|
| Loads | count of `line_pay` items |
| Miles | Σ `miles` of `line_pay` items |
| Gross | Σ `line_pay` amounts |
| Deductions | Σ `deduction` amounts (≤ 0; displayed "-$142", or "—" when 0) |
| Net | gross + deductions |
| Pay basis label | 03 §6.0.6: "$0.62 / mi", "25% of line haul", "$68,000 / yr", "$34.50 / hr" |

### 2.1 Amount rules for generated settlements (Not built)

When settlements are prepared by the system (§4, S1), line pay is computed in integer cents with no floating point:
- `per_mile`: `miles × pay_rate_cents` (exact; 2,140 mi × 62 ¢ = 132,680 ¢ = $1,326.80);
- `percent_of_line_haul`: `round_half_up(loads.line_haul_cents × pay_percent_bp / 10,000)`;
- `hourly` / `annual_salary`: not used for drivers in this release.

**Seeded settlements are not recomputed.** Runtruck1 shows per-driver totals that do not follow the rate (Marcus $1,326, not $1,326.80: accounting.md B10). The seed stores them as items split evenly (01 C4, 03 §7.18), so every figure equals Runtruck1's.

---

## 3. Pay periods

- A pay period is a stored fact: `period_start … period_end` on each settlement. It is **not** derived from the organization week (Monday–Sunday): the seeded period is Tue 2026-09-01 … Mon 2026-09-07 (Runtruck1's "Week of Sep 1"; accounting.md B1).
- **Current period** (Payroll without `periodStart`): the period containing today, else the latest period that started on or before today (03 §6.7.6). Seed: 2026-09-01.
- A driver without a settlement in the period has no Payroll row (Tobias Frey, accounting.md B13), so the "Drivers" KPI counts settlements, not the roster.

---

## 4. State machine

| State | Label (web) | Meaning |
|---|---|---|
| `ready` | "Ready" (blue) | prepared, awaiting approval |
| `approved` | "Approved" (blue) | approved for payment (`approved_at`, `approved_by_user_id` set) |
| `on_hold` | "Hold · {hold_reason}" (amber) | withheld, e.g. `fuel` (a fuel-advance question) |
| `paid` | "Paid" (green) | paid out |

| # | From → to | Trigger | Permission | Required data / rule | Audit action | Domain event | Status |
|---|---|---|---|---|---|---|---|
| S1 | (none) → `ready` | prepare settlements for a period ("Run settlements" in a future release) | `settlements.create` | one per driver per period; items from the driver's delivered own-fleet loads of the period and deductions; basis from the driver's active contract | `SETTLEMENT_CREATED` | `SettlementCreated` | Not built |
| **S2** | **`ready` → `approved`** | **"Approve all" / "Run settlements"** → `POST /settlements/approve {periodStart}` | **`settlements.approve`** (+ `settlements.view`, [api/settlements.md](api/settlements.md) §3) | only `ready` rows of that period in the caller's organization; sets `approved_at = ClockService.now`, `approved_by_user_id = caller` | **`SETTLEMENT_APPROVED`** (one per settlement) | **`SettlementApproved`** `{settlementId, driverId, periodStart}` (one per settlement) | **Built in this release** |
| S3 | `ready` → `on_hold` | hold with a reason | `settlements.approve` | `hold_reason` required (`settlements_hold_ck`) | `SETTLEMENT_HELD` | `SettlementHeld` | Not built |
| S4 | `on_hold` → `ready` | release the hold | `settlements.approve` | clears `hold_reason` | `SETTLEMENT_RELEASED` | `SettlementReleased` | Not built |
| S5 | `approved` → `paid` | payout recorded (payroll run / bank file) | `settlements.approve` or system | payout reference (future column) | `SETTLEMENT_PAID` | `SettlementPaid` | Not built |

Not allowed through normal actions: `approved` → `ready` (Runtruck1 has no un-approve), `paid` → anything, `on_hold` → `approved` without a release. An endpoint that attempts an illegal single-settlement transition answers `409 SETTLEMENT_INVALID_TRANSITION` and changes nothing. The bulk approval (S2) never fails on held or paid rows: it simply skips them. Event names other than `SettlementApproved` must be added to [17](17-event-architecture.md) §5 when built.

---

## 5. Approval (S2) in detail

Runtruck1's approval is a global in-memory flag with no permission, audit, persistence or period scope (accounting.md §7.1, B12). Runtruck2 makes it a persisted transition:

1. **Authorization:** session → organization from the session → `settlements.approve` (and `settlements.view`) → business rule. The body carries only `periodStart`; the organization and the approver are never taken from the client (architecture Rule 4).
2. **Scope:** every `ready` settlement of `period_start = periodStart` in the caller's organization. Search does not limit it (as in Runtruck1: approval applies to every Ready row even when the table is filtered).
3. **Period must exist:** no settlement with that `period_start` in the organization → `404 SETTLEMENT_PERIOD_NOT_FOUND` (a foreign organization's period looks identical).
4. **One transaction:** one `UPDATE … WHERE status = 'ready' RETURNING`, then per updated settlement one `audit_logs` row and one `events` row, then the period is read back and returned. Held (`on_hold`) and `paid` rows are untouched.
5. **Idempotent:** a period with nothing `ready` returns 200 with the unchanged list and writes nothing. Concurrent calls cannot double-approve: the second `UPDATE` re-checks `status = 'ready'` after the first commits and matches no row.
6. **Durable:** the approval survives reloads and sign-out (an intended change from Runtruck1, whose flag reset on reload). Repeatable demos and E2E runs start from `pnpm db:reset` ([20](20-testing.md) §4).
7. **UI:** after approval the three Ready chips read "Approved" (still blue), the card link reads "Approved" and stays clickable (a further click is an idempotent no-op), the notes read "Approved for payment" / "Approved" ("approved view" = no `ready` row and at least one `approved`, [api/settlements.md](api/settlements.md) §2.3).

---

## 6. Payroll totals include held and paid settlements

The Payroll KPIs Gross / Deductions / Net payable and the footer "Net payable this week" sum **every** settlement of the period, including `on_hold` (Ellis, $1,245) and `paid` (Ana, $684): $5,477 / $512 / $4,965 (03 §6.7.6). That is Runtruck1's behaviour, kept for parity (D6; accounting.md B11, decision D10 "parity says include"). The amount actually payable on approval is Σ net of the approved rows ($3,036 for the seed), which no screen shows in this release. Changing the totals is a product decision for the owner, not a silent fix.

---

## 7. Figures other screens derive from settlements

- **Fleet › Drivers "Pay YTD"** (01 C3): Σ `line_pay` amounts of the driver's settlements with `period_start` in the current year, **any status** → $1,326, $1,188, $1,455, $824, $684, $0 for the seed (Runtruck1 hard-coded $61,400 … $63,750; D5, 03 §8). Computed by the fleet domain from these tables with the same item rules (§2).
- **HR › Contracts "Pay basis"** uses the same label rule as Payroll (03 §6.0.6).

---

## 8. Security

- `settlements.approve` is held by Owner, Admin, Accounting and Manager (roles.ts); Dispatcher, Driver and Maintenance are refused (403) — [19](19-security.md) lists "approve settlements" as a low-privilege threat.
- Architecture §26 classifies "Approve settlement" as **sensitive** for AI: an AI tool may only propose it and needs explicit human confirmation. A person clicking "Approve all" is that confirmation; the web keeps Runtruck1's no-dialog behaviour (D6).
- Settlement rows, amounts and driver pay are tenant business data (19 §1). Event payloads carry ids only; audit rows carry the driver's name in `entity_label` (internal, append-only).

---

## 9. Open points

- **Payroll totals** (§6): include held and paid rows (parity) or show payable-to-approve — product owner.
- **Carrier settlements** for brokered loads (`loads.carrier_rate_cents`) have no table yet; they arrive with Phase 13 proper.
- **Pay period creation** (who defines periods, weekly anchor day) is decided with S1.
