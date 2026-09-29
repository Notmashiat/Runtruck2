# 04 — API Specification

REST, JSON, versioned under **`/api/v1`** (architecture §14). This file holds the conventions every endpoint follows. The endpoints themselves are specified per domain in [`docs/api/`](api/) (index in §9). Wire types are in `packages/types`, and input schemas in `packages/validation`. The code must match these documents.

## 1. Transport and base URL

- The browser calls `/api/v1/*` on the web origin. The Next.js server proxies it to the NestJS API (`API_ORIGIN`), so the session cookie is first-party and no CORS is involved.
- Request bodies are JSON (`content-type: application/json`), except document uploads (`multipart/form-data`).
- Every response carries `x-request-id`. The API accepts a well-formed incoming `x-request-id`; otherwise it mints one.

## 2. Envelopes (architecture §15)

Success:

```json
{ "data": <resource or array>, "meta": { } }
```

Lists return `meta: { "total": n, "limit": n, "offset": n, "summary": { … } }`. `summary` carries the screen's KPI figures, computed server-side.

Errors:

```json
{ "error": { "code": "LOAD_NOT_FOUND", "message": "Load was not found.", "requestId": "…", "issues": [{ "path": "stops.0.date", "message": "…" }] } }
```

`issues` is present only for validation errors. Messages are safe to show to users. Internal details are never returned (§29).

## 3. Status codes and error categories (architecture §29)

| HTTP | `code` (category, or a specific code within it) | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Body, query or params fail the Zod schema, or a business rule rejects the input. |
| 401 | `UNAUTHORIZED`, `INVALID_CREDENTIALS` | No or invalid session; failed sign-in. |
| 403 | `FORBIDDEN`, `CROSS_ORIGIN_REJECTED`, `NO_ACTIVE_MEMBERSHIP` | Missing permission; cross-site write; account without an organization. |
| 404 | `NOT_FOUND`, `<ENTITY>_NOT_FOUND` | Unknown id **or an id that belongs to another organization**. Tenancy is never revealed. |
| 409 | `CONFLICT`, `<SPECIFIC>` | Illegal state transition, uniqueness race. |
| 429 | `RATE_LIMITED` | Sign-in throttling. |
| 502 | `INTEGRATION_ERROR`, `DEPENDENCY_UNAVAILABLE` | Object storage, Redis or another dependency failed. |
| 500 | `INTERNAL_ERROR` | Anything unexpected. It is logged with the request id. |

## 4. Authentication and authorization

- The session is an httpOnly cookie `rt_session` (details: [05-authentication.md](05-authentication.md)).
- Every route is **deny by default**. It must declare `@RequirePermissions(...)`, `@AuthenticatedOnly()` or `@Public()`.
- The organization always comes from the session. No endpoint accepts an `organizationId` input (architecture Rule 4). An id belonging to another tenant behaves exactly like a missing one (404).
- Unsafe methods must come from the web origin when sent by a browser, i.e. an `Origin` header check.

## 5. Lists, pagination, search, ordering (architecture §37)

- `limit` (1–500, default 100), `offset` (≥ 0) and `q` (case-insensitive substring over the row's searchable fields, as listed per endpoint).
- The default order is specified per endpoint. It reproduces Runtruck1's row order for the seed.
- The web requests one bounded page and applies the live top-bar filter locally (Runtruck1 parity, [01](01-product-requirements.md) §3).

## 6. Data formats

| Kind | Wire format | Example |
|---|---|---|
| id | UUID string | `"5b1c…"` |
| human number | integer, formatted by the web | `40218` → `L-40218` |
| money | integer cents, field suffix `Cents` | `245000` → `$2,450` |
| business date | `YYYY-MM-DD` | `"2026-09-03"` |
| instant | ISO-8601 UTC | `"2026-09-03T15:12:00.000Z"` |
| wall-clock time | `HH:MM` plus the timezone it belongs to (a field or documented context) | `"08:00"` |
| enum | lower_snake_case string | `"in_transit"` |

The web maps enums to Runtruck1's labels and chip tones. Formatting helpers live in `@runtruck/calculations`.

## 7. Writes

Every write is one database transaction. It (1) validates, (2) checks the business rule / state machine, (3) changes the rows, (4) writes `audit_logs`, and (5) emits the domain event to the outbox. The response returns the updated resource.

## 8. Platform endpoints (implemented)

| Method & path | Auth | Purpose | `data` |
|---|---|---|---|
| `POST /auth/login` | public | Body `{email, password}` (`loginSchema`). Sets the `rt_session` cookie. Throttled per email and per IP. Audited `USER_SIGNED_IN`. | `MeResponse` |
| `POST /auth/logout` | authenticated | Revokes the session and clears the cookie. Audited `USER_SIGNED_OUT`. | `null` |
| `GET /me` | authenticated | The signed-in user, organization, permission keys and org business date. | `MeResponse` |
| `GET /health` | public | Readiness: database and Redis reachable. | `{status, database, redis}` |

## 9. Domain endpoint specifications

| Domain | Document |
|---|---|
| Dashboard | [api/dashboard.md](api/dashboard.md) |
| Loads, stops, dispatch assignment, activity | [api/loads.md](api/loads.md) |
| Documents (load paperwork, object storage) | [api/documents.md](api/documents.md) |
| Planner (events, color codes, reset) | [api/planner.md](api/planner.md) |
| Billing (uninvoiced, invoices, batches, payments) | [api/billing.md](api/billing.md) |
| Payables (bills) | [api/payables.md](api/payables.md) |
| Settlements (driver payroll) | [api/settlements.md](api/settlements.md) |
| Fleet (drivers, trucks, trailers) | [api/fleet.md](api/fleet.md) |
| Customers (CRM) | [api/customers.md](api/customers.md) |
| Carriers | [api/carriers.md](api/carriers.md) |
| Facilities | [api/facilities.md](api/facilities.md) |
| HR (contracts, onboarding) | [api/hr.md](api/hr.md) |
| Safety (work orders, driver documents, reminders, violations, claims) | [api/safety.md](api/safety.md) |
