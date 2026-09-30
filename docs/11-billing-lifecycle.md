# 11 — Billing Lifecycle

Domain specification (rank 6 in architecture §49): below the product requirements ([01](01-product-requirements.md)), security, the database specification ([03](03-database.md)), the architecture and the API documents ([api/billing.md](api/billing.md), [api/payables.md](api/payables.md)). Where this document and one of those disagree, they win and this document is corrected.

It defines how money owed **to** the organization (receivables: loads → invoices → batches → payments) and money it **owes** vendors (payables: bills) move through their states: allowed transitions, who may trigger them, the data each needs, and the audit action and domain event each writes (architecture §18). Driver pay is in [12-settlement-lifecycle.md](12-settlement-lifecycle.md).

**Status in this release (01 §5, [24](24-development-phases.md) Phase 12):** the billing and payables screens are **read views**. No billing or payables transition is built: every control that would trigger one is navigation or an inert stub (01 §7). The statuses are stored facts seeded from Runtruck1 (design brief §2). The state machines below are the contract the Phase 12 follow-up implements; each row says "Not built" until it is.

---

## 1. Entities

| Entity | Table (03) | Stored status | Totals |
|---|---|---|---|
| Load (billing view of it) | `loads` §5.6.1, `documents` §5.7.1 | load status (08) | revenue(l) = line haul + fuel surcharge + accessorials (03 §6.0.3) |
| Invoice | `invoices` §5.8.2, `invoice_items` §5.8.3 | `invoice_status`: draft, sent, overdue, paid | Σ items (never stored, 03 §1.8) |
| Payment | `payments` §5.8.4 | none (a fact) | `amount_cents` |
| Factoring company | `factoring_companies` §5.8.1 | none | — |
| Invoice batch | `invoice_batches` §5.8.5, `invoice_batch_items` §5.8.6 | `invoice_batch_status`: ready, sent, settled | Σ member invoice totals (never stored) |
| Vendor, bill | `vendors` §5.9.1, `bills` §5.9.2 | `bill_status`: due, overdue, scheduled, paid | `amount_cents` |

Human numbers `INV-n` and `B-n` come from `organization_counters` keys `invoice` and `invoice_batch` inside the creating transaction (03 §1.9); the next ones after the seed are INV-8846 and B-2036.

---

## 2. From delivered load to invoice

### 2.1 Uninvoiced (computed, never stored)

A load — on the board or archived — is **uninvoiced** when its status is `needs_pod` or `delivered` and no `invoice_items` row references it (an item of an invoice in any status, draft included, counts). Its POD is **attached** when it has a `proof_of_delivery` document with status `attached` (03 §6.0.4). There is no `billing_status` column: against the seed the rule yields exactly Runtruck1's 11 loads (L-40199 … L-40209), because the delivered board loads L-40214, L-40212 and L-40210 already have invoices and the 12 invoice-only archived loads each have an item.

A load **becomes invoiced** the moment an `invoice_items` row points at it (creating an invoice, §3). Deleting a draft invoice (not built) would make it uninvoiced again. Payment status is an invoice fact, not a load status: 03 §4.4 maps architecture §17's `INVOICED`/`PAID` to billing facts.

Served by `GET /billing/uninvoiced-loads` ([api/billing.md](api/billing.md) §3); the Dashboard "Unbilled loads" tile uses the same rule and the same query.

### 2.2 "Invoice N loads"

In this release the Uninvoiced header button only navigates to Invoiced (D6); it creates nothing and counts every uninvoiced load, including the three with a missing POD (accounting.md B14). The future bulk action ("create invoices from uninvoiced loads", `billing.create`) runs as a background job (architecture §38, queue `invoice-generation`, [18](18-background-jobs.md)) and must enforce §3.2.

---

## 3. Invoice lifecycle

### 3.1 States

| State | Meaning | Invariants (03 §5.8.2, database-enforced) |
|---|---|---|
| `draft` | being prepared; not yet sent to the customer | `issued_on` and `due_on` null |
| `sent` | issued to the customer, not yet due or not yet swept overdue | `issued_on` set; `due_on = issued_on + net days(payment_terms)` (API-enforced, 03 §6.0.7) |
| `overdue` | past its due date with money outstanding | as `sent` |
| `paid` | fully paid (Σ payments ≥ total) | as `sent`; at least one payment (API-enforced once payments are recorded by the API) |

### 3.2 Transitions

| # | From → to | Trigger | Permission | Required data / business rule | Audit action | Domain event | Status |
|---|---|---|---|---|---|---|---|
| I1 | (none) → `draft` | create invoice for one or more uninvoiced loads (`POST /invoices`) | `billing.create` | every load uninvoiced (§2.1) and in the org; **POD attached** on each delivered load ("Cannot invoice until attached"); allocates `invoice_number`; items at positions 1…n; `payment_terms` copied from the customer | `INVOICE_CREATED` | `InvoiceCreated` `{invoiceId, invoiceNumber, customerId, loadIds}` | Not built |
| I2 | `draft` → `sent` | send / issue | `billing.approve` | at least one item; sets `issued_on = today`, `due_on = issued_on + net days` | `INVOICE_SENT` | `InvoiceSent` `{invoiceId}` | Not built |
| I3 | `sent` → `overdue` | daily sweep job | system (no user) | `due_on < today` and outstanding > 0 | `INVOICE_OVERDUE` (actor null) | `InvoiceOverdue` `{invoiceId}` | Not built |
| I4 | `sent` or `overdue` → `paid` | record payment (`POST /invoices/:id/payments`) when Σ payments reaches the total | `billing.approve` | payment `amount_cents > 0`, `method`, `factoring_company_id` iff factoring, `received_at` | `PAYMENT_RECORDED` and `INVOICE_PAID` | `PaymentRecorded`, `InvoicePaid` `{invoiceId}` | Not built |
| I5 | `draft` → (deleted) | discard a draft | `billing.create` | only drafts; items cascade; the loads become uninvoiced again | `INVOICE_DELETED` | `InvoiceDeleted` | Not built |

Not allowed through normal actions (architecture §18): `paid` → anything (a reversal is a future credit-note flow), `sent`/`overdue` → `draft`, `overdue` → `sent` (a partial payment keeps the invoice `overdue`). An illegal transition answers `409` with a specific code (e.g. `INVOICE_NOT_DRAFT`) and changes nothing. Events other than `InvoiceCreated` and `InvoicePaid` are new names and must be added to [17](17-event-architecture.md) §5 when built.

### 3.3 Why `overdue` is stored

`overdue` is a stored status (design brief §2), set by I3, not derived on read. INV-8836 stays `overdue`; it carries Net 30 terms (due Aug 23) so that its status and its due date agree, while Sierra Ag keeps Net 60 (01 C6). Past Due lists stored `overdue` invoices; AR aging buckets by days past due (§4).

### 3.4 Seed oddities kept (D6)

Runtruck1's data is reproduced as it is, and the transition rules above are **not** applied to seeded rows (the seed is the initial state, not a sequence of user actions; it writes no audit or event rows, 03 §7):
- INV-8836 is dated Jul 24 for L-40210, picked up Aug 29; INV-8840 (Aug 31) and INV-8841 (Sep 1) predate their loads' deliveries; L-40214 is still `needs_pod` although INV-8841 exists (accounting.md B3).
- INV-8845 is a draft for the in-transit L-40218; no screen shows drafts.
- Batch counts and totals are computed from seeded membership (01 C5), so five batches differ from Runtruck1 ([api/billing.md](api/billing.md) §8).

---

## 4. Receivable figures (definitions used by every screen)

All computed on read from stored rows (D5; 03 §6.0.7). `today` is `ClockService.today(org timezone)`.

| Term | Definition |
|---|---|
| invoice total | Σ `invoice_items.amount_cents` |
| paid | Σ `payments.amount_cents` of the invoice |
| outstanding | total − paid |
| age | `today − issued_on` (days); "—" while draft |
| days past due | `today − due_on` |
| paid on | org-local date of the latest payment's `received_at` |
| days to pay | paid on − `issued_on` |
| AR aging (Invoiced tiles) | invoices in `sent` or `overdue`, bucketed by days past due: Current ≤ 0, 1–30, 31–60, 60+ (> 60); each bucket Σ outstanding and a count |
| in collections (Past Due note) | `overdue` invoices with **age from issue** > 60 (Runtruck1's rule; "60+" wording with a strict `>`, accounting.md B6) |
| open AR (CRM) | Σ outstanding of `sent` + `overdue` invoices, per customer and in total ($26.2K for the seed, 03 §8) |

Seed consequence (D5): the Invoiced AR tiles read $11,520 · 5 / $13,070 · 4 / $1,590 · 1 / $0 · 0 instead of Runtruck1's hard-coded $96,400 · 32 / $41,200 · 14 / $18,750 · 5 / $7,900 · 2.

---

## 5. Payments

A payment is an immutable fact: `received_at` (instant), `method` (`ach`, `check`, `factoring`), `factoring_company_id` iff `factoring`, `amount_cents > 0`, optional `reference` (03 §5.8.4). Several payments may settle one invoice; the **latest** (greatest `received_at`, then `id`) gives the Paid tab's "Paid" date and "Via". Recording a payment is transition I4. Corrections are new rows (a future refund/reversal flow), never updates.

"Collected this month" is Σ payments whose org-local `received_at` falls in the current month; "Paid via factoring" counts paid invoices whose latest payment is factoring ([api/billing.md](api/billing.md) §4.5).

---

## 6. Invoice batch lifecycle

A batch groups invoices sent together to **one** recipient: a customer, or a factoring company that buys them (`invoice_batches_recipient_ck`). An invoice belongs to at most one batch (`invoice_batch_items_org_invoice_uq`). Count and total are computed from membership.

| # | From → to | Trigger | Permission | Rule | Audit action | Event | Status |
|---|---|---|---|---|---|---|---|
| B1 | (none) → `ready` | "+ New Batch" | `billing.create` | invoices not in another batch, all `sent`/`overdue` (or `draft` being issued with the batch), all for the recipient customer, or any customer when the recipient is a factor; allocates `batch_number`; `created_on = today` | `INVOICE_BATCH_CREATED` | `InvoiceBatchCreated` | Not built (inert stub) |
| B2 | `ready` → `sent` | send the batch | `billing.approve` | at least one invoice | `INVOICE_BATCH_SENT` | `InvoiceBatchSent` | Not built |
| B3 | `sent` → `settled` | every member invoice `paid` (a factor's advance counts as payment) | `billing.approve` or system | all members paid | `INVOICE_BATCH_SETTLED` | `InvoiceBatchSettled` | Not built |

"Sent this week" counts `sent` batches **created** fewer than 7 days before today (Runtruck1 measures from the created date, accounting.md B8); a sent date would need a new column, which is not added in this release (D5: no figure needs it).

---

## 7. Payables (bills) lifecycle

Bills are accounts payable to vendors ([api/payables.md](api/payables.md)). `scheduled` means auto-pay on `scheduled_on`; `paid_on` is set iff `paid` (03 §5.9.2).

| # | From → to | Trigger | Permission | Rule | Audit action | Event | Status |
|---|---|---|---|---|---|---|---|
| P1 | (none) → `due` | "+ Add Bill" | `payables.create` | vendor in the org, `amount_cents > 0`, `due_on` | `BILL_CREATED` | `BillCreated` | Not built (inert stub) |
| P2 | `due` or `overdue` → `scheduled` | schedule auto-pay | `payables.approve` | sets `scheduled_on ≥ today` | `BILL_SCHEDULED` | `BillScheduled` | Not built |
| P3 | `scheduled` → `due` | cancel auto-pay | `payables.approve` | clears `scheduled_on` | `BILL_UNSCHEDULED` | `BillUnscheduled` | Not built |
| P4 | `due` → `overdue` | daily sweep job | system | `due_on < today` | `BILL_OVERDUE` (actor null) | `BillOverdue` | Not built |
| P5 | `due`, `overdue` or `scheduled` → `paid` | mark paid / auto-pay job on `scheduled_on` | `payables.approve` or system | sets `paid_on` | `BILL_PAID` | `BillPaid` | Not built |

`paid` is terminal. Until P4 exists, a `due` bill past its date stays `due` and still counts in "Due this week" (no lower bound, accounting.md B15). "Paid this month" uses `paid_on` (the seed pays each bill on its due date, 01 C4).

---

## 8. Permissions and tenancy

| Action | Permission (catalog) | Roles (default) |
|---|---|---|
| View uninvoiced loads, invoices, payments, batches | `billing.view` | Owner, Admin, Accounting, Manager |
| Create invoices, batches | `billing.create` | Owner, Admin, Accounting |
| Send invoices and batches, record payments | `billing.approve` | Owner, Admin, Accounting, Manager |
| View bills | `payables.view` | Owner, Admin, Accounting, Manager |
| Enter bills | `payables.create` | Owner, Admin, Accounting |
| Schedule and pay bills | `payables.approve` | Owner, Admin, Accounting, Manager |

Every read and write is scoped to the session's organization; the composite tenant foreign keys (03 §1.3) make a cross-organization invoice item, payment or batch membership impossible even if application code is wrong. An invoice, batch or bill id of another organization answers 404 like an unknown id (06 §4).

---

## 9. Open points

- Invoice numbering for drafts: allocated at creation (I1), so discarded drafts leave gaps; accepted (numbers are unique, not gap-free).
- Partial payments, short-pays and credit notes are not modelled beyond `payments` rows; `outstanding` already supports partial payment.
- The sweep jobs (I3, P4) need the `invoice-generation`/scheduler infrastructure of [18](18-background-jobs.md); until then `overdue` changes only through the seed.
