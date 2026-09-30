# 07 — Roles and Permissions

Authorization answers _what may this member do?_ (architecture §12, §13). Roles are named collections of permissions. The **API** checks permissions on every request. The web app only uses them to hide controls.

This document is the specification behind `packages/permissions/src/catalog.ts` and `roles.ts`. Change the code and this document together.

## 1. Model

- **Permission keys** are `<resource>.<action>`, lower case (the unit test enforces `^[a-z]+\.[a-z]+$`). The catalog (`PERMISSIONS` in `catalog.ts`) is the only list of valid keys. The seed copies it into the global `permissions` table.
- **Roles are per organization** (`roles.organization_id`), so each tenant can tailor them later (Phase 4 permission management). Each new organization gets the seven **default roles** of `roles.ts` (§3).
- **A member's permissions** are the union of the permissions of every role they hold in the session's organization (`user_roles` → `roles` → `role_permissions` → `permissions`). The set is recomputed on each request ([05](05-authentication.md) §1.1). Keys that are not in the catalog are dropped (`isPermission`).
- **Job titles are not roles.** Rosa Medina's title "Dispatch" (`organization_members.title`) is display text. Her **role is Admin** (docs/01 §4), which grants every permission except `organization.manage`. That is why she sees every Runtruck1 screen and control, as the prototype showed them.

## 2. Permission catalog and default role matrix

This table was generated from `packages/permissions/src` (catalog and `DEFAULT_ROLES`, as of commit `15094a9`, which emptied the Driver role). There are 57 permissions and 7 roles. Regenerate it whenever `catalog.ts` or `roles.ts` changes.

| Permission            | Description                                                       | Owner  | Admin  | Dispatcher | Driver | Accounting | Manager | Maintenance |
| --------------------- | ----------------------------------------------------------------- | :----: | :----: | :--------: | :----: | :--------: | :-----: | :---------: |
| `organization.view`   | View organization profile and settings                            |   ✓    |   ✓    |            |        |            |    ✓    |             |
| `organization.manage` | Change organization settings                                      |   ✓    |        |            |        |            |         |             |
| `users.view`          | View users and their roles                                        |   ✓    |   ✓    |            |        |            |    ✓    |             |
| `users.manage`        | Invite, suspend and assign roles to users                         |   ✓    |   ✓    |            |        |            |         |             |
| `roles.manage`        | Create and edit roles and their permissions                       |   ✓    |   ✓    |            |        |            |         |             |
| `audit.view`          | Read the audit log                                                |   ✓    |   ✓    |            |        |            |    ✓    |             |
| `dashboard.view`      | View the operations dashboard                                     |   ✓    |   ✓    |     ✓      |        |     ✓      |    ✓    |             |
| `loads.view`          | View loads, stops and load activity                               |   ✓    |   ✓    |     ✓      |        |     ✓      |    ✓    |             |
| `loads.create`        | Create loads                                                      |   ✓    |   ✓    |     ✓      |        |            |         |             |
| `loads.update`        | Edit loads and change load status                                 |   ✓    |   ✓    |     ✓      |        |            |         |             |
| `loads.delete`        | Delete draft loads                                                |   ✓    |   ✓    |            |        |            |         |             |
| `loads.assign`        | Assign drivers, trucks, trailers and carriers to loads            |   ✓    |   ✓    |     ✓      |        |            |         |             |
| `drivers.view`        | View drivers                                                      |   ✓    |   ✓    |     ✓      |        |     ✓      |    ✓    |      ✓      |
| `drivers.create`      | Add drivers                                                       |   ✓    |   ✓    |            |        |            |         |             |
| `drivers.update`      | Edit drivers                                                      |   ✓    |   ✓    |            |        |            |         |             |
| `trucks.view`         | View trucks                                                       |   ✓    |   ✓    |     ✓      |        |            |    ✓    |      ✓      |
| `trucks.create`       | Add trucks                                                        |   ✓    |   ✓    |            |        |            |         |             |
| `trucks.update`       | Edit trucks                                                       |   ✓    |   ✓    |            |        |            |         |      ✓      |
| `trailers.view`       | View trailers                                                     |   ✓    |   ✓    |     ✓      |        |            |    ✓    |      ✓      |
| `trailers.create`     | Add trailers                                                      |   ✓    |   ✓    |            |        |            |         |             |
| `trailers.update`     | Edit trailers                                                     |   ✓    |   ✓    |            |        |            |         |      ✓      |
| `carriers.view`       | View partner carriers                                             |   ✓    |   ✓    |     ✓      |        |     ✓      |    ✓    |             |
| `carriers.create`     | Add partner carriers                                              |   ✓    |   ✓    |            |        |            |         |             |
| `carriers.update`     | Edit partner carriers                                             |   ✓    |   ✓    |            |        |            |         |             |
| `customers.view`      | View customers and contacts                                       |   ✓    |   ✓    |     ✓      |        |     ✓      |    ✓    |             |
| `customers.create`    | Add customers                                                     |   ✓    |   ✓    |            |        |            |         |             |
| `customers.update`    | Edit customers                                                    |   ✓    |   ✓    |            |        |            |         |             |
| `locations.view`      | View facilities and locations                                     |   ✓    |   ✓    |     ✓      |        |            |    ✓    |             |
| `locations.create`    | Add facilities                                                    |   ✓    |   ✓    |            |        |            |         |             |
| `locations.update`    | Edit facilities                                                   |   ✓    |   ✓    |            |        |            |         |             |
| `documents.view`      | View and download load documents                                  |   ✓    |   ✓    |     ✓      |        |     ✓      |    ✓    |             |
| `documents.upload`    | Upload load documents                                             |   ✓    |   ✓    |     ✓      |        |            |         |             |
| `billing.view`        | View invoices, batches and payments                               |   ✓    |   ✓    |            |        |     ✓      |    ✓    |             |
| `billing.create`      | Create invoices and invoice batches                               |   ✓    |   ✓    |            |        |     ✓      |         |             |
| `billing.approve`     | Approve and send invoices, record payments                        |   ✓    |   ✓    |            |        |     ✓      |    ✓    |             |
| `payables.view`       | View vendor bills                                                 |   ✓    |   ✓    |            |        |     ✓      |    ✓    |             |
| `payables.create`     | Enter vendor bills                                                |   ✓    |   ✓    |            |        |     ✓      |         |             |
| `payables.approve`    | Approve and pay vendor bills                                      |   ✓    |   ✓    |            |        |     ✓      |    ✓    |             |
| `settlements.view`    | View driver and carrier settlements                               |   ✓    |   ✓    |            |        |     ✓      |    ✓    |             |
| `settlements.create`  | Prepare settlements                                               |   ✓    |   ✓    |            |        |     ✓      |         |             |
| `settlements.approve` | Approve settlements for payment                                   |   ✓    |   ✓    |            |        |     ✓      |    ✓    |             |
| `maintenance.view`    | View maintenance work orders                                      |   ✓    |   ✓    |     ✓      |        |            |    ✓    |      ✓      |
| `maintenance.create`  | Log maintenance work orders                                       |   ✓    |   ✓    |            |        |            |         |      ✓      |
| `maintenance.update`  | Update maintenance work orders                                    |   ✓    |   ✓    |            |        |            |         |      ✓      |
| `compliance.view`     | View driver qualification documents and violations                |   ✓    |   ✓    |     ✓      |        |            |    ✓    |             |
| `compliance.create`   | Record driver documents and violations                            |   ✓    |   ✓    |            |        |            |         |             |
| `compliance.update`   | Update driver documents and violations                            |   ✓    |   ✓    |            |        |            |         |             |
| `claims.view`         | View cargo and liability claims                                   |   ✓    |   ✓    |            |        |            |    ✓    |             |
| `claims.create`       | Open claims                                                       |   ✓    |   ✓    |            |        |            |         |             |
| `claims.update`       | Update and settle claims                                          |   ✓    |   ✓    |            |        |            |         |             |
| `hr.view`             | View employee contracts and onboarding                            |   ✓    |   ✓    |            |        |            |    ✓    |             |
| `hr.create`           | Create contracts and start onboarding                             |   ✓    |   ✓    |            |        |            |         |             |
| `hr.update`           | Update contracts and onboarding                                   |   ✓    |   ✓    |            |        |            |         |             |
| `planner.view`        | View the planner calendar                                         |   ✓    |   ✓    |     ✓      |        |     ✓      |    ✓    |      ✓      |
| `planner.manage`      | Create, edit and delete planner events                            |   ✓    |   ✓    |     ✓      |        |            |    ✓    |      ✓      |
| `planner.configure`   | Edit the organization's planner color codes                       |   ✓    |   ✓    |            |        |            |         |             |
| `planner.reset`       | Restore the organization's default planner events and color codes |   ✓    |   ✓    |            |        |            |         |             |
| **Total**             |                                                                   | **57** | **56** |   **17**   | **0**  |   **16**   | **24**  |   **10**    |

### 2.1 What some keys cover (design brief §2)

| Key               | Also covers                                                                                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `loads.view`      | The load's financial fields: rate, driver pay, carrier cost, margin and carrier rate. There is no separate financials key.                                               |
| `drivers.view`    | Driver pay, e.g. Pay YTD on the Drivers tab.                                                                                                                             |
| `compliance.view` | Driver documents, violations and compliance reminders (the watchlist).                                                                                                   |
| `billing.view`    | Invoices, batches, payments and uninvoiced loads.                                                                                                                        |
| `payables.view`   | Vendor bills.                                                                                                                                                            |
| `locations.view`  | Facilities.                                                                                                                                                              |
| `claims.*`        | Claims. The Safety tab is called "Settlements" in Runtruck1 (`/app/safety/settlements`), but its data is claims, so the backend names it `claims` (fleet-hr-safety B12). |
| `claims.view`     | Also the claimant's customer or facility name and the claim's load number on its rows ([safety.md](api/safety.md) S2).                                                     |
| `compliance.view` | Also the driver and truck names shown on driver documents, reminders and violations (safety.md S2).                                                                      |
| `maintenance.view`| Also the unit numbers and shop (facility) names on work orders (safety.md S2).                                                                                           |
| `hr.view`         | Also contract pay basis: per-mile and hourly rates, percentages and salaries ([hr.md](api/hr.md) H1). No separate HR-financial key.                                         |
| `drivers.view`    | Also each roster row's unit, current load and CDL expiry month ([fleet.md](api/fleet.md) F2).                                                                            |
| `customers.view`  | Also the CRM aggregates (YTD loads and revenue, on-time rate, AR balances), without `billing.view` ([customers.md](api/customers.md) CU1).                                  |
| `dashboard.view`  | Every figure on the Dashboard, including revenue and unbilled totals (§7).                                                                                               |

## 3. Default roles

| Role (`key`)                | Description (from `roles.ts`)                           | Composition                                                                                                                                                                                                      |
| --------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Owner (`owner`)             | Full access, including organization settings and roles. | Every permission.                                                                                                                                                                                                |
| Admin (`admin`)             | Full operational access; can manage users and roles.    | Everything except `organization.manage`. **Rosa Medina's role.**                                                                                                                                                 |
| Dispatcher (`dispatcher`)   | Plans, creates and assigns loads.                       | `dashboard.view`; `loads.view/create/update/assign`; the `.view` of drivers, trucks, trailers, carriers, customers, locations, documents, maintenance and compliance; `documents.upload`; `planner.view/manage`. |
| Driver (`driver`)           | Driver app access to assigned loads arrives in Phase 9. | **No permissions.** `loads.view` would expose every load's rates and margins, and there is no "assigned loads only" scoping yet, so the role grants nothing until Phase 9 adds driver-scoped endpoints (§7).                 |
| Accounting (`accounting`)   | Invoices, payments, bills and settlements.              | `dashboard.view`; the `.view` of loads, customers, carriers, drivers and documents; `billing.*`, `payables.*`, `settlements.*`; `planner.view`.                                                                  |
| Manager (`manager`)         | Read access across the business plus approvals.         | Every `.view`, plus `billing.approve`, `settlements.approve`, `payables.approve` and `planner.manage`.                                                                                                           |
| Maintenance (`maintenance`) | Fleet upkeep and inspections.                           | The `.view` of trucks, trailers, drivers and maintenance; `trucks.update`, `trailers.update`, `maintenance.create/update`; `planner.view/manage`.                                                                |

D8: `planner.reset` belongs to Owner and Admin only.

## 4. Enforcement in the API (authoritative)

Two global guards are registered in `AuthModule`, and they run in order:

1. `SessionGuard` authenticates the request ([05](05-authentication.md)).
2. `PermissionsGuard` authorizes it. **Deny by default:**
   - `@Public()`: no session needed (sign-in, health).
   - `@RequirePermissions(a, b, …)`: the member must hold **all** listed keys (`hasPermissions`). Otherwise **403 `FORBIDDEN`** "You do not have permission to do that."
   - `@AuthenticatedOnly()`: any signed-in member (`GET /me`, logout).
   - **No decorator:** refused with 403, and the guard logs `<Controller>.<handler> declares no permissions; refusing.`. A forgotten decorator therefore fails closed. The unit test `permissions.guard.test.ts` covers this.

Tenancy is not checked by the guard. Every query checks it ([06](06-multi-tenancy.md) §3). The full order for each request follows architecture §12:

authenticated (SessionGuard) → correct organization (the query filter; 404 when not) → required permission (PermissionsGuard) → business rule (the service; 409/400) → operation (in a transaction, with audit and event).

Rules for endpoint authors:

- Every handler declares exactly one of the three decorators.
- Use the narrowest key that matches the action. If an action needs data from another area (for example assigning a driver while creating a load), the service checks the extra key with `hasPermissions(ctx.permissions, […])` and throws `AppError.forbidden()`.
- Never branch on role names or job titles, only on permission keys.

## 5. Web: hiding controls (never a security boundary)

- `GET /me` returns the member's permission keys. `useSession().can(...keys)` (`apps/web/src/context/SessionContext.tsx`) uses the same `hasPermissions` function as the API.
- **Implemented:** the sidebar shows a section only if the member holds its permission (`apps/web/src/lib/nav.ts`):

  | Section   | Permission       | Section    | Permission         |
  | --------- | ---------------- | ---------- | ------------------ |
  | Dashboard | `dashboard.view` | Facilities | `locations.view`   |
  | Loads     | `loads.view`     | Accounting | `billing.view`     |
  | Planner   | `planner.view`   | HR         | `hr.view`          |
  | Fleet     | `drivers.view`   | Safety     | `maintenance.view` |
  | CRM       | `customers.view` |            |                    |

- **Rule for controls that call the API** (see §6.3): the control is hidden when the member lacks its permission. The one exception is **Reset calendar**, which stays visible for everyone and is refused by the API without `planner.reset` (docs/01 D8). Inert stub controls are always shown, exactly as in Runtruck1, because they call nothing.
- **Status:** the control-level hiding in §6.3 is **not implemented yet**. `components/shell/Header.tsx` does no permission checks.
- For a member with every permission, such as Rosa as Admin, the UI is identical to Runtruck1.
- Hiding is only a convenience. If a control is shown in error, the API still refuses the call.

## 6. Permission matrix for every Runtruck1 screen and action

The per-domain API documents (`docs/api/*.md`) must declare these permissions on their endpoints.

### 6.1 Endpoints

| Endpoint (`/api/v1`)                                                                             | Decorator / permission                                                                                             |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `POST /auth/login`                                                                               | `@Public`                                                                                                          |
| `POST /auth/logout`                                                                              | `@AuthenticatedOnly`                                                                                               |
| `GET /me`                                                                                        | `@AuthenticatedOnly`                                                                                               |
| `GET /health`                                                                                    | `@Public`                                                                                                          |
| `GET /dashboard`                                                                                 | `dashboard.view`                                                                                                   |
| `GET /loads`, `GET /loads/by-number/:loadNumber`, `GET /loads/:id`                               | `loads.view` (includes financial fields). The load's document list requires `documents.view` as well (§8, item 1). |
| `POST /loads`                                                                                    | `loads.create`, plus `loads.assign` when the body sets a driver, truck, trailer or partner carrier (§8, item 2)    |
| `GET /loads/:id/documents`                                                                       | `documents.view`                                                                                                   |
| `POST /loads/:id/documents`                                                                      | `documents.upload`. Moving a `needs_pod` load to `delivered` on a POD upload (08 T12) also needs `loads.update` (§8, item 6). |
| `GET /loads/:id/documents/:documentId/file`                                                      | `documents.view` (contract only, not built in this release)                                                        |
| `GET /planner/events`                                                                            | `planner.view`. Derived load-stop events are included only when the member also has `loads.view` (§8, item 3).     |
| `POST /planner/events`, `PATCH /planner/events/:id`, `DELETE /planner/events/:id`                | `planner.manage`                                                                                                   |
| `GET /planner/color-codes`                                                                       | `planner.view`                                                                                                     |
| `POST /planner/color-codes`, `PATCH /planner/color-codes/:id`, `DELETE /planner/color-codes/:id` | `planner.configure`                                                                                                |
| `GET /planner/stop-values`                                                                       | `planner.view` (non-empty lists only with `loads.view`, §8, item 3)                                                |
| `GET /planner/related-loads`                                                                     | `planner.manage` + `loads.view`; setting or changing an event's related load also needs `loads.view` (§8, item 5)  |
| `POST /planner/reset`                                                                            | `planner.reset`                                                                                                    |
| `GET /customers`, `GET /customers/options`                                                       | `customers.view`                                                                                                   |
| `GET /carriers`                                                                                  | `carriers.view`                                                                                                    |
| `GET /facilities`                                                                                | `locations.view`                                                                                                   |
| `GET /drivers`                                                                                   | `drivers.view` (includes pay)                                                                                      |
| `GET /trucks`                                                                                    | `trucks.view`                                                                                                      |
| `GET /trailers`                                                                                  | `trailers.view`                                                                                                    |
| `GET /billing/uninvoiced-loads`, `GET /invoices`, `GET /invoice-batches`                         | `billing.view`. There is no `GET /payments`: paid invoices and their payments come from `GET /invoices?status=paid` ([billing.md](api/billing.md) §9). |
| `GET /bills`                                                                                     | `payables.view`                                                                                                    |
| `GET /settlements`                                                                               | `settlements.view`                                                                                                 |
| `POST /settlements/approve`                                                                      | `settlements.approve` + `settlements.view` (it returns the list, [settlements.md](api/settlements.md) §3)           |
| `GET /hr/contracts`, `GET /hr/onboarding`                                                        | `hr.view`                                                                                                          |
| `GET /work-orders`                                                                               | `maintenance.view`                                                                                                 |
| `GET /driver-documents`, `GET /violations`, `GET /compliance-reminders`                          | `compliance.view`                                                                                                  |
| `GET /claims`                                                                                    | `claims.view`                                                                                                      |

### 6.2 Screens (reads)

| Screen                                         | Route                          | API reads → permission                                                                                                                                                        |
| ---------------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Marketing                                      | `/`                            | None (public page).                                                                                                                                                           |
| Sign in                                        | `/login`                       | `POST /auth/login` (public).                                                                                                                                                  |
| Shell: sidebar, user block, Settings › Profile | every `/app` route             | `GET /me` (authenticated). Settings › Appearance is browser-only.                                                                                                             |
| Dashboard                                      | `/app/dashboard`               | `GET /dashboard` → `dashboard.view`. If the load table is fetched from `GET /loads`, that call needs `loads.view`.                                                            |
| Loads                                          | `/app/loads`                   | `GET /loads` → `loads.view` (KPIs in `meta.summary`).                                                                                                                         |
| Load detail                                    | `/app/loads/:loadNumber`       | `GET /loads/by-number/:loadNumber` → `loads.view`. The Documents card also needs `documents.view`.                                                                            |
| New Load dialog                                | Dashboard, Loads               | `GET /customers/options` → `customers.view`; `GET /carriers`, `/drivers`, `/trucks`, `/trailers` → their `.view`; `GET /me`.                                                   |
| Planner                                        | `/app/planner`                 | `GET /planner/events`, `GET /planner/color-codes`, `GET /planner/stop-values` → `planner.view` (load stops also need `loads.view`). The EventDialog "Related load" list uses `GET /planner/related-loads` → `planner.manage` + `loads.view`. |
| CRM                                            | `/app/crm`                     | `GET /customers` → `customers.view`.                                                                                                                                          |
| Facilities                                     | `/app/facilities`              | None: the "coming soon" page calls no endpoint ([facilities.md](api/facilities.md)). `GET /facilities` (`locations.view`) exists for future pickers. The sidebar gate stays `locations.view` (§5). |
| Fleet › Drivers                                | `/app/fleet/drivers`           | `GET /drivers` → `drivers.view`. The compliance watchlist uses `GET /compliance-reminders` → `compliance.view`.                                                               |
| Fleet › Trucks                                 | `/app/fleet/trucks`            | `GET /trucks` → `trucks.view`.                                                                                                                                                |
| Fleet › Trailers                               | `/app/fleet/trailers`          | `GET /trailers` → `trailers.view`.                                                                                                                                            |
| Accounting › Uninvoiced                        | `/app/accounting/uninvoiced`   | `GET /billing/uninvoiced-loads` → `billing.view`. The same call supplies the header label "Invoice N loads".                                                                  |
| Accounting › Invoiced                          | `/app/accounting/invoiced`     | `GET /invoices?status=sent` → `billing.view`.                                                                                                                                 |
| Accounting › Batches                           | `/app/accounting/batches`      | `GET /invoice-batches` → `billing.view`.                                                                                                                                      |
| Accounting › Past Due                          | `/app/accounting/past-due`     | `GET /invoices?status=overdue` → `billing.view`.                                                                                                                              |
| Accounting › Paid                              | `/app/accounting/paid`         | `GET /invoices?status=paid` → `billing.view`.                                                                                                                                 |
| Accounting › Payroll                           | `/app/accounting/payroll`      | `GET /settlements?periodStart=…` → `settlements.view`.                                                                                                                        |
| Accounting › Bills                             | `/app/accounting/bills`        | `GET /bills` → `payables.view`.                                                                                                                                               |
| HR › Employee Contracts                        | `/app/hr/employee-contracts`   | `GET /hr/contracts` → `hr.view`.                                                                                                                                              |
| HR › Onboarding                                | `/app/hr/onboarding`           | `GET /hr/onboarding` → `hr.view`.                                                                                                                                             |
| Safety › Maintenance                           | `/app/safety/maintenance`      | `GET /work-orders` → `maintenance.view`.                                                                                                                                      |
| Safety › Driver Documents                      | `/app/safety/driver-documents` | `GET /driver-documents` → `compliance.view`.                                                                                                                                  |
| Safety › Violations                            | `/app/safety/violations`       | `GET /violations` → `compliance.view`.                                                                                                                                        |
| Safety › Settlements (claims)                  | `/app/safety/settlements`      | `GET /claims` → `claims.view`.                                                                                                                                                |

### 6.3 Actions

"Inert" means the control does nothing in Runtruck1 and does nothing in this release (docs/01 §7). The permission named for it is the key its real implementation will use later. Nothing enforces it today, because no endpoint exists.

| Action (Runtruck1 label)                                                                                   | Where                     | Behaviour in this release                                                                               | Permission                                                           |
| ---------------------------------------------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Top-bar Search                                                                                             | every `/app` screen       | Filters the rows on screen, in the browser                                                              | none                                                                 |
| Filters                                                                                                    | 18 table screens          | Inert                                                                                                   | none                                                                 |
| Settings, Profile/Appearance, Dark mode switch                                                             | sidebar                   | Browser-only (theme in `localStorage`)                                                                  | none                                                                 |
| Log out                                                                                                    | sidebar                   | `POST /auth/logout`, then go to `/`                                                                     | authenticated                                                        |
| **+ New Load** (open dialog)                                                                               | Dashboard, Loads          | Opens the dialog. Its dropdowns read `GET /customers/options`, `/carriers`, `/drivers`, `/trucks`, `/trailers`. | `loads.create` (to show the button); each dropdown needs its `.view` |
| New Load › **Create load**                                                                                 | dialog                    | `POST /loads`                                                                                           | `loads.create` (+ `loads.assign` with an assignment)                 |
| New Load › **Attach** / Replace (files)                                                                    | dialog                    | `POST /loads/:id/documents` after the load exists                                                       | `documents.upload`                                                   |
| ← Loads                                                                                                    | load detail               | Navigation                                                                                              | none                                                                 |
| Message driver                                                                                             | load detail               | Inert                                                                                                   | future messaging key (not in the catalog; Phase 9)                   |
| Update status                                                                                              | load detail               | Inert                                                                                                   | `loads.update` (future)                                              |
| Row expand                                                                                                 | Loads                     | Browser-only                                                                                            | none                                                                 |
| Planner: ‹ › Today, Day/Week/Month, legend chips, Customize › Layout, card lines, color-by, value swatches | Planner                   | Browser-only preferences (D8)                                                                           | none                                                                 |
| Planner: **+ Add Event**, empty-slot or month-cell create, EventDialog **Save**                            | Planner                   | `POST` / `PATCH /planner/events`                                                                        | `planner.manage`                                                     |
| Planner: **Delete** (popover or dialog; no confirmation, D6)                                               | Planner                   | `DELETE /planner/events/:id`                                                                            | `planner.manage`                                                     |
| Planner: Open load L-…                                                                                     | popover                   | Navigation                                                                                              | none (the target screen needs `loads.view`)                          |
| Customize › Color codes: **rename, recolour, + Add color code, Delete**                                    | Planner                   | `PATCH` / `POST` / `DELETE /planner/color-codes`                                                        | `planner.configure`                                                  |
| Customize › **Reset calendar** (confirmation)                                                              | Planner                   | `POST /planner/reset`. **Always visible.** Refused without the permission (D8).                         | `planner.reset`                                                      |
| + Add Customer                                                                                             | CRM                       | Inert                                                                                                   | `customers.create` (future)                                          |
| + Add Driver                                                                                               | Fleet › Drivers           | Inert                                                                                                   | `drivers.create` (future)                                            |
| Log service                                                                                                | Fleet › Trucks            | Inert                                                                                                   | `maintenance.create` (future)                                        |
| + Add Unit                                                                                                 | Fleet › Trucks            | Inert                                                                                                   | `trucks.create` (future)                                             |
| + Add Trailer                                                                                              | Fleet › Trailers          | Inert                                                                                                   | `trailers.create` (future)                                           |
| Invoice N loads                                                                                            | Accounting › Uninvoiced   | Only navigates to Invoiced (D6); creates nothing. Hidden without `billing.view` or while the count is unknown ([billing.md](api/billing.md) §7.1) | `billing.view` for the count; `billing.create` when real             |
| Export batch                                                                                               | Accounting › Invoiced     | Inert                                                                                                   | `billing.view` (future)                                              |
| + New Batch                                                                                                | Accounting › Invoiced     | Only navigates to Batches                                                                               | `billing.create` when real                                           |
| + New Batch                                                                                                | Accounting › Batches      | Inert                                                                                                   | `billing.create` (future)                                            |
| Send reminders                                                                                             | Accounting › Past Due     | Inert                                                                                                   | `billing.approve` (future)                                           |
| Export                                                                                                     | Accounting › Paid         | Inert                                                                                                   | `billing.view` (future)                                              |
| **Run settlements** (header) and **Approve all** (card)                                                    | Accounting › Payroll      | `POST /settlements/approve {periodStart}`                                                               | `settlements.approve` + `settlements.view`                           |
| + Add Bill                                                                                                 | Accounting › Bills        | Inert                                                                                                   | `payables.create` (future)                                           |
| + New Contract                                                                                             | HR › Employee Contracts   | Inert                                                                                                   | `hr.create` (future)                                                 |
| + Start Onboarding                                                                                         | HR › Onboarding           | Inert                                                                                                   | `hr.create` (future)                                                 |
| + Log Service                                                                                              | Safety › Maintenance      | Inert                                                                                                   | `maintenance.create` (future)                                        |
| Request document                                                                                           | Safety › Driver Documents | Inert                                                                                                   | `compliance.create` (future)                                         |
| + Log Violation                                                                                            | Safety › Violations       | Inert                                                                                                   | `compliance.create` (future)                                         |
| + New Claim                                                                                                | Safety › Settlements      | Inert                                                                                                   | `claims.create` (future)                                             |

## 7. Known gaps and inconsistencies

- **The Driver role has no permissions (resolved gap).** Earlier it held `loads.view`, which covers load financials (§2.1), so a driver would have seen rates, pay and margin on every load in the organization. Commit `15094a9` emptied the role (`permissions.test.ts` asserts that a driver lacks `loads.view`). A member holding only the Driver role therefore has no web access. Phase 9 must add driver-scoped endpoints ("only my assigned loads", no money) before any driver client ships ([10](10-driver-lifecycle.md) §3).
- **Some roles land on a forbidden page.** After sign-in the web always goes to `/app/dashboard` (`LoginForm.tsx`). Driver and Maintenance have no `dashboard.view`, so the dashboard's API call is refused (the Driver role has no permission at all). There is no "first permitted page" logic yet.
- **Tabs are not gated.** A section is visible when its gate permission is held, but individual tabs are not checked. Examples:
  - Accounting shows for `billing.view`, but Payroll needs `settlements.view` and Bills needs `payables.view`.
  - Safety shows for `maintenance.view`, but Claims needs `claims.view`, which Dispatcher lacks.
  - Accounting can open Fleet (`drivers.view`) but not Trucks or Trailers.

  The API refuses those tabs' data.

- **The dashboard shows figures from other areas.** It combines revenue, unbilled amounts and driver status under `dashboard.view`. A Dispatcher (no `billing.view`) therefore sees billing aggregates there. This is by design brief §2, noted here for review.
- **No permission management.** `users.manage`, `roles.manage`, `users.view`, `audit.view` and `organization.*` have no endpoints yet (Phase 4 follow-up, Phase 3).
- **No catalog sync for existing organizations.** Adding a key to the catalog does not update the `permissions` table or the default roles of existing organizations. Only the seed writes them. A sync step (migration or script) is needed before real tenants exist.

## 8. Decisions made in this document (to be confirmed in docs/01 §6)

1. The load detail's **document list** requires `documents.view` in addition to `loads.view`. Without it, the API omits the list and the web hides the Documents card. `documents.view` also covers any future download endpoint.
2. `POST /loads` with a driver, truck, trailer or partner carrier also requires **`loads.assign`**.
3. Derived **load-stop planner events** are returned only when the member also holds `loads.view`.
4. Web hiding rule (§5): hide API-backed controls without their permission. **Reset calendar** stays visible (D8). Inert stubs stay visible.
5. The planner's "Related load" list (`GET /planner/related-loads`) needs `planner.manage` + `loads.view`, and setting or changing an event's related load needs `loads.view` ([planner.md](api/planner.md) §2.3, P2, P3).
6. A proof-of-delivery upload moves a `needs_pod` load to `delivered` (08 T12) only when the uploader also holds `loads.update`; with `documents.upload` alone the file is attached and the status is unchanged.
7. `POST /settlements/approve` needs `settlements.view` besides `settlements.approve`, because it returns the list.

## 9. Catalog change log

| Date       | Change                                                              | Why                                                              |
| ---------- | ------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 2026-09-29 | Initial catalog (57 keys) and 7 default roles (Phase 1 foundation). | Architecture §13, and design brief §2 for the parity-slice keys. |
| 2026-09-29 | Driver role emptied (`permissions: []`, commit `15094a9`); no key added. | `loads.view` exposed every load's money without assignment scoping (§7). |

Any key added later must be added in `catalog.ts`, `roles.ts`, this table and §2, with the reason.
