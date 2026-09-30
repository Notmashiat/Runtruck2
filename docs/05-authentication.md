# 05 — Authentication

Authentication answers _who is the user?_ (architecture §11). Authorization is covered in [07-roles-permissions.md](07-roles-permissions.md) and tenancy in [06-multi-tenancy.md](06-multi-tenancy.md).

This document describes the code as it exists on branch `feature/phase-1-foundation` (2026-09-29). Anything not built is listed in §9 and is never reported as done.

| Concern                               | Code                                                                                                   |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Session store and resolution          | `apps/api/src/auth/session.service.ts`                                                                 |
| Sign-in and sign-out                  | `apps/api/src/auth/auth.service.ts`, `auth.controller.ts`                                              |
| Authentication guard and Origin check | `apps/api/src/auth/session.guard.ts`                                                                   |
| Route decorators                      | `apps/api/src/auth/decorators.ts`                                                                      |
| Password hashing                      | `packages/database/src/security/password.ts`                                                           |
| Login input schema                    | `packages/validation/src/auth.ts`                                                                      |
| Rate limiter                          | `apps/api/src/common/rate-limit/rate-limiter.service.ts`                                               |
| Tables                                | `users`, `organization_members`, `sessions` in `packages/database/src/schema/platform.ts`              |
| Web                                   | `apps/web/src/proxy.ts`, `lib/api/server.ts`, `lib/api/client.ts`, `app/login/*`, `app/app/layout.tsx` |

## 1. Session model

Runtruck uses **opaque server-side sessions**, not JWTs. A session can be revoked immediately, and the token carries no claims a client could tamper with.

| Property       | Value                                                                                                                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Token          | 32 random bytes from `crypto.randomBytes` (256 bits of entropy), encoded base64url (43 characters).                                                                                                    |
| What is stored | Only `SHA-256(token)` as hex, in `sessions.token_hash` (unique index `sessions_token_hash_uq`). A database leak does not yield usable cookies.                                                         |
| Cookie         | `rt_session`, `HttpOnly`, `SameSite=Lax`, `Path=/`, `Expires` = the session's expiry. `Secure` is set when `NODE_ENV` is `production` or `staging`, and not in development (plain `http://localhost`). |
| Lifetime       | **Absolute.** `expires_at = sign-in time + SESSION_TTL_HOURS` (default **12**, `packages/config/src/env.ts`). It is never extended.                                                                    |
| `last_seen_at` | Refreshed on use, at most once every **5 minutes** (`TOUCH_INTERVAL_MS`), so reads do not write on every request. It is informational: there is **no idle timeout** and no sliding expiry today.       |
| Bound to       | One user **and one organization** (`sessions.organization_id`), chosen at sign-in (§4).                                                                                                                |
| Also recorded  | `ip_address`, `user_agent` (truncated to 512 characters).                                                                                                                                              |

### 1.1 Resolving a request

`SessionGuard` (global guard #1) runs on every request:

1. Unsafe methods get the Origin check (§6).
2. It reads the `rt_session` cookie. A token that is missing, empty or longer than 128 characters is ignored, so the request is treated as anonymous.
3. `SessionService.resolve(token)` hashes the token and loads the session joined to `users`, `organizations` and `organization_members`. The session is valid only when **all** of these hold:
   - `revoked_at IS NULL`
   - `expires_at > now()`
   - `users.status = 'active'`
   - the membership (`organization_members` for this user and organization) has `status = 'active'`
4. The permissions are recomputed **on every request** from `user_roles → roles (same organization) → role_permissions → permissions` and filtered to keys in the catalog. A role change therefore takes effect on the member's next request. There is no permission cache.
5. The result is `req.auth: AuthContext = { userId, organizationId, sessionId, timezone, permissions }`. It is built only from the database, never from anything the client sends (architecture Rule 4).
6. Routes marked `@Public()` proceed either way. Any other route without `req.auth` gets **401 `UNAUTHORIZED`** ("Sign in to continue.").

Controllers receive the context with `@Auth() ctx: AuthContext`.

## 2. Sign-in: `POST /api/v1/auth/login` (`@Public`)

```
Browser ──POST /api/v1/auth/login {email, password}──▶ Next.js (rewrite) ──▶ API
  1  SessionGuard: Origin must be WEB_ORIGIN when present (§6)
  2  ZodValidationPipe(loginSchema)          → 400 VALIDATION_ERROR
  3  Rate limits: per email, per IP          → 429 RATE_LIMITED
  4  SELECT user WHERE lower(email) = email
  5  verifyPassword(password, user.hash ?? DUMMY_PASSWORD_HASH)
  6  unknown user | wrong password | user disabled
                                             → 401 INVALID_CREDENTIALS
  7  first active membership (oldest)        → 403 NO_ACTIVE_MEMBERSHIP
  8  INSERT sessions; reset the email counter, release one IP hit; users.last_login_at = now()
  9  audit USER_SIGNED_IN {ipAddress}
 10  Set-Cookie rt_session=…; body = MeResponse (same as GET /me)
```

Details:

- **Input** (`loginSchema`): `email` is trimmed, lower-cased, at most 254 characters and must be a valid email. `password` is 1–256 characters. The cap stops a huge body from being used to burn CPU in the hash.
- **Timing-safe lookup.** A password hash is always verified, against `DUMMY_PASSWORD_HASH` when the email is unknown. The dummy uses the same scrypt parameters as real hashes, so the three failure cases (unknown email, wrong password, disabled user) cost the same and return the same `401 INVALID_CREDENTIALS` "Email or password is incorrect.". The dummy hash can never match.
- **Rate limits** (fixed windows in Redis, shared by every API instance):

  | Key                                 | Limit        | Window     |
  | ----------------------------------- | ------------ | ---------- |
  | `rl:login:email:<normalized email>` | 10 attempts  | 15 minutes |
  | `rl:login:ip:<req.ip>`              | 100 attempts | 15 minutes |

  Every attempt that passes validation counts, before the credentials are checked, so parallel guesses cannot overshoot a limit. Attempt 11 for an email inside the window is refused with `429 RATE_LIMITED` "Too many sign-in attempts. Try again in 15 minutes.". A successful sign-in resets the email counter and **takes its own hit back from the IP counter** (`RateLimiterService.release`, never below zero): only failed attempts use up an address's budget, so members behind one address cannot lock each other out by signing in (01 C80). If Redis is down, sign-in fails closed with `500 INTERNAL_ERROR`.

- **Client IP (`req.ip`).** Express derives it from `X-Forwarded-For` through the hops `TRUST_PROXY` trusts (`app.set('trust proxy', env.TRUST_PROXY)` in `create-app.ts`). `@runtruck/config` parses the variable into what Express expects: digits are a hop count (`"1"`), `false` trusts nothing, anything else is a comma-separated list of addresses, subnets or `loopback`/`linklocal`/`uniquelocal`; `true` and malformed entries are refused at boot. Unset, it is `loopback` in development and test; staging and production must set it. The Next.js rewrite forwards the browser's `X-Forwarded-For` **exactly as received and never adds its peer**, so the web tier cannot vouch for the client IP: the API must trust exactly the web-tier hop, and an edge proxy in front of the web tier must set `X-Forwarded-For` from its peer address ([21 §2](21-deployment.md)). The rightmost entry is then the edge's view of the client. `req.ip` keys the IP counter and is stored in `sessions.ip_address` and the `USER_SIGNED_IN` audit row. In local development there is no edge: a request without the header counts against the loopback address shared by every browser, and a client-sent header is believed ([19](19-security.md) G4).

- **Response.** The body is `{ data: MeResponse, meta: {} }`, exactly what `GET /me` returns (§5).
- **An earlier session is not revoked** when the same browser signs in again. It stays valid until it expires.

## 3. Sign-out: `POST /api/v1/auth/logout` (`@AuthenticatedOnly`)

- It sets `revoked_at` on the **current** session only, audits `USER_SIGNED_OUT`, clears the cookie (same attributes as when it was set) and sends `Clear-Site-Data: "cache"`, so the browser drops what it cached for the origin while the member was signed in (01 C82; API responses themselves are `Cache-Control: no-store`, [04 §1](04-api.md)). It returns `{ data: null, meta: {} }`.
- There is no "sign out everywhere".
- The web keeps Runtruck1's "Log out" markup (`<a class="ui-nav-item" href="/">`) and fails closed (`components/shell/Sidebar.tsx`, [01 C78](01-product-requirements.md)). The click calls the endpoint and navigates to `/` only when it succeeded or answered 401 (the session had already ended). On any other failure (network error, the Next proxy's 502, a 5xx) the member stays on the page, still signed in, and a confirm offers **OK** to try again or **Cancel** to sign out of this browser only. Cancel posts to the web origin's `POST /sign-out` (`app/sign-out/route.ts`), which expires the `rt_session` cookie with the attributes of §1 and, like the endpoint, sends `Clear-Site-Data: "cache"` (same-origin requests only, by `Sec-Fetch-Site` or `Origin`); the server session is then left to expire. If that also fails, an alert says the member is still signed in and the page stays. `GET /sign-out` goes to `/` like any unknown path.
- If the session had already expired, the call returns 401 and the stale cookie stays in the browser. It is harmless, because every protected page re-checks the session with the API (§7).

## 4. Membership selection

- Users are global identities (`users`). Tenancy comes from `organization_members` (details in [06](06-multi-tenancy.md)).
- At sign-in the session is bound to the user's **oldest active membership** (`ORDER BY organization_members.created_at ASC`).
- A user with no active membership gets `403 NO_ACTIVE_MEMBERSHIP` "Your account is not a member of an active organization." This answer is only reachable with a correct password.
- There is **no organization switcher**. A user who belongs to several organizations always lands in the oldest one. Switching is a Phase 3 follow-up (§9).
- Suspending a membership or disabling a user takes effect on the next request, because `resolve()` checks both statuses every time.

## 5. `GET /api/v1/me` (`@AuthenticatedOnly`)

It returns `MeResponse` (`packages/types/src/session.ts`):

- `user`: `{id, fullName, email, memberNumber, title}`
- `organization`: `{id, name, shortName, companyNumber, timezone}`
- `permissions`: sorted permission keys
- `today`: the organization's business date from `ClockService.today(timezone)`, which `DEMO_TODAY` pins (docs/01 D4)

`title` ("Dispatch") is display text from `organization_members.title`. It is **never** used for authorization.

## 6. Cross-site request protection

There are two layers:

1. **`SameSite=Lax`.** Browsers do not attach the cookie to cross-site `POST`/`PATCH`/`DELETE` requests or to cross-site sub-resource requests. They do attach it to cross-site top-level `GET` navigations, so **`GET` handlers must never change state**. The only write on a `GET` today is the throttled `last_seen_at` touch.
2. **Origin check** (`SessionGuard.assertSameOrigin`). For every method other than `GET`/`HEAD`/`OPTIONS`, including the public sign-in, a request whose `Origin` header is present and differs from `WEB_ORIGIN` is refused with `403 CROSS_ORIGIN_REJECTED`.
   - A request **without** an `Origin` header is allowed. Browsers always send `Origin` on these methods. Non-browser clients (tests, a future mobile app) do not carry the cookie risk.

The browser only ever talks to the web origin. `next.config.ts` rewrites `/api/v1/*` to `API_ORIGIN`, so the cookie is first-party and no CORS is configured or needed.

## 7. Web: route protection (UX only; the API is the authority)

| Layer                                   | What it does                                                                                                                                                                                                                                    | Authority            |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `apps/web/src/proxy.ts` (Next 16 proxy) | Routes on the lower-cased static path segments with a rewrite (Runtruck1's case-insensitive routes; the address bar keeps the URL as typed, trailing slash included, as in Runtruck1). It then does an **optimistic redirect**: a request for `/app` or `/app/*` without an `rt_session` cookie goes to `/login`. It only checks that the cookie _exists_. It also sets each page's Content-Security-Policy with a fresh nonce ([19 §2](19-security.md), 01 C79). | None: UX only        |
| `app/app/layout.tsx` (server component) | Calls `getMe()`, which forwards the cookie to `API_ORIGIN/api/v1/me` with `cache: 'no-store'`. On 401 it redirects to `/login` **before any HTML of the app is sent**. Any other non-OK status throws and shows the error page.                 | Delegates to the API |
| `app/login/page.tsx`                    | If `getMe()` already succeeds, it redirects to `/app/dashboard`.                                                                                                                                                                                | Delegates to the API |
| `app/login/LoginForm.tsx`               | Validates with the same `loginSchema` to save a round trip. It posts to `/auth/login`, then `router.replace('/app/dashboard')`. It shows the API's `error.message` as it arrives.                                                               | None                 |
| `lib/api/client.ts`                     | On any 401 (except `/auth/*` calls) the browser goes to `/login`.                                                                                                                                                                               | None                 |

The marketing "Log in" link points to `/app/dashboard`, as in Runtruck1. Without a session, the proxy turns that into `/login` (docs/01 D2).

Every API call is still authenticated and authorized by the API guards.

## 8. Password hashing

`packages/database/src/security/password.ts` uses Node's built-in `crypto.scrypt`, a memory-hard algorithm from the OWASP list, so no native dependency is needed (architecture §40).

| Parameter       | Value                                            |
| --------------- | ------------------------------------------------ |
| N (cost)        | 2^15 = 32768                                     |
| r (block size)  | 8                                                |
| p (parallelism) | 1                                                |
| Key length      | 64 bytes                                         |
| Salt            | 16 random bytes per hash                         |
| `maxmem`        | 256·N·r = 64 MiB (scrypt needs 128·N·r = 32 MiB) |
| Normalisation   | The password is NFKC-normalised before hashing   |
| Comparison      | `crypto.timingSafeEqual` after a length check    |

Stored format:

```
scrypt$<N>$<r>$<p>$<salt base64>$<hash base64>
```

For example, `scrypt$32768$8$1$…$…`. Verification reads the parameters from the stored string, so the cost can be raised later without breaking existing hashes. Anything that is not in this format verifies as `false`.

Rehash-on-login (upgrading old parameters) is **not implemented**.

The seeded demo password comes from `SEED_DEMO_PASSWORD` in `.env`. The seed refuses to run when `NODE_ENV=production` (docs/01 §4).

## 9. Not built (tracked, never reported as done)

| Item                                    | Why not / when                                                                                                                                               |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Password and account recovery           | Needs an email provider. Explicitly out of this release (docs/01 §5). Phase 2 follow-up.                                                                     |
| Multi-factor authentication             | Not in the architecture's phase list for this release. Candidate for Phase 16 hardening.                                                                     |
| Sign-up, invitations, user creation     | Users come only from the seed and test fixtures. `users.manage` exists in the catalog, but no endpoint uses it (Phase 4 permission management).              |
| Password change                         | No endpoint.                                                                                                                                                 |
| Organization switcher                   | Sign-in picks the oldest active membership (§4). Phase 3 follow-up.                                                                                          |
| Idle timeout / sliding expiry           | Only the absolute TTL is enforced. `last_seen_at` is recorded but not used.                                                                                  |
| "Sign out everywhere" and session list  | Only the current session can be revoked.                                                                                                                     |
| Expired-session cleanup                 | `SessionService.purgeStale()` exists but **nothing schedules it**, so the `sessions` table keeps expired and revoked rows (see [18](18-background-jobs.md)). |
| Bearer tokens for the mobile driver app | Phase 9. The Origin rule in §6 already leaves room for non-browser clients.                                                                                  |
| Account lockout beyond rate limiting    | The per-email limit doubles as a 15-minute lockout, which someone who knows a victim's email can trigger (see [19](19-security.md) §4).                      |

## 10. Known implementation notes

- Sign-in writes three things: the session row, `users.last_login_at` and the `USER_SIGNED_IN` audit row. They are **separate statements, not one transaction**. Sign-out works the same way (revoke plus audit). A crash between them can leave a session without its audit row. Wrapping each in `db.transaction` would satisfy the "every write in a transaction" rule of [04-api.md](04-api.md) §7.
- `auth.controller.ts` resolves the new session a second time right after creating it, to build the response. That costs one extra query per sign-in.
