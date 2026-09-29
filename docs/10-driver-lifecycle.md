# 10 — Driver Lifecycle

This document covers how a driver moves through Runtruck:

- recruiting and onboarding
- qualification (compliance documents)
- active duty and dispatch
- pay (settlements)
- leaving the company

It also covers the driver's own use of Runtruck through the mobile app (architecture §20, Phase 9).

**Status (2026-09-29):** in this release drivers are **read-only records** for Runtruck1 parity. No lifecycle transition can be performed through the API or the web app yet.

## 1. What the architecture requires

- Drivers are tenant-owned records (`organization_id`), managed through the backend with permissions and audit (§12, §13, §30).
- Dispatch assignment must check driver availability and compliance constraints in the backend (§19). Example rule from architecture Rule 5: an inactive driver cannot be assigned.
- The driver app (§20, Phase 9) lets drivers sign in, see their assigned loads and stops, update status, upload documents and photos, message, receive notifications and share location. It uses **the same API**.
- Settlement approval is a sensitive action (§26). Driver pay is computed and approved in the backend (Phase 13).

## 2. Stages and where each one lives

| Stage                     | Runtruck1 screen                                     | Stored facts (design brief §2)                                                                 | This release                                                                                                       | Full implementation                                                             |
| ------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Recruiting and onboarding | HR › Onboarding                                      | Onboarding stage (stored enum)                                                                 | Read view: `GET /hr/onboarding` (`hr.view`). "+ Start Onboarding" is inert.                                        | Onboarding workflow and state machine: Phase 5 follow-up with HR                |
| Employment terms          | HR › Employee Contracts                              | Contract status (stored enum), pay basis                                                       | Read view: `GET /hr/contracts` (`hr.view`). "+ New Contract" is inert.                                             | Contract management: Phase 5 follow-up                                          |
| Qualification             | Safety › Driver Documents; Fleet › Drivers watchlist | Document status per driver (`driver_documents`); compliance reminders (`compliance_reminders`) | Read views: `GET /driver-documents`, `GET /compliance-reminders` (`compliance.view`). "Request document" is inert. | Expiry tracking and reminders through events and notifications: Phases 9 and 14 |
| Active / duty status      | Fleet › Drivers; Dashboard drivers card              | Driver duty status (stored enum), HOS remaining where known                                    | Read view: `GET /drivers` (`drivers.view`, includes pay YTD)                                                       | Live duty status and HOS from ELD: Phase 10                                     |
| Dispatch                  | New Load dialog (driver select)                      | The load's assigned driver                                                                     | Assigning at creation: `POST /loads` (`loads.create` + `loads.assign`)                                             | Availability and compliance checks, and the dispatch workflow: Phase 8          |
| Safety events             | Safety › Violations                                  | Violation status                                                                               | Read view: `GET /violations` (`compliance.view`)                                                                   | Recording violations: Phase 5 follow-up                                         |
| Pay                       | Accounting › Payroll                                 | Settlement status                                                                              | `GET /settlements` (`settlements.view`); approval `POST /settlements/approve` (`settlements.approve`)              | Settlement preparation and deductions: Phase 13                                 |
| Leaving the company       | —                                                    | —                                                                                              | Not built                                                                                                          | Deactivation that blocks assignment: Phase 5 follow-up                          |

The table and column definitions are in [03-database.md](03-database.md). The endpoints are in `docs/api/fleet.md`, `hr.md`, `safety.md` and `settlements.md`.

## 3. Drivers as users (Phase 9)

- A **driver record** (fleet data) is not the same thing as a **user account** (someone who signs in). Today no driver has a user account, and no link between the two exists.
- The default **Driver role** exists (`loads.view`, `documents.view`, `documents.upload`), but it is not usable safely yet:
  - It is not scoped to the driver's own assigned loads.
  - `loads.view` includes load financials.

  Both must change before a driver client ships ([07](07-roles-permissions.md) §7).

- The mobile app needs non-cookie authentication (bearer tokens). The API's Origin rule already leaves room for it ([05](05-authentication.md) §6).

## 4. Open items

- Define the driver status enum and its state machine (onboarding → active → on leave → terminated) in this document when Phase 5 write features begin.
- Decide the driver ↔ user link: a `user_id` on the driver, or a membership attribute.
- Define which compliance items block dispatch. This goes into [09-dispatch-lifecycle.md](09-dispatch-lifecycle.md) with Phase 8.
