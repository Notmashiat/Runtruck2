# 15 — Integration Architecture

External systems are isolated behind **integration adapters**, so providers can be replaced and the core domain holds no provider-specific logic (architecture §25). No integration is assumed to exist until its API has been verified and implemented (§25, §43).

**Status (2026-09-29): no external business integration is built.** `packages/integrations` does not exist yet. Tracking/ELD and every external integration are explicitly out of this release (docs/01 §5).

## 1. External services used in this release

| Service                                                                   | Use                                                                               | How                                                                                                           | Status                                                                                                                   |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| PostgreSQL 17                                                             | Source of truth                                                                   | `pg` pool + Drizzle (`packages/database`)                                                                     | Built                                                                                                                    |
| Redis 8                                                                   | BullMQ queues, sign-in rate limits                                                | `ioredis` (`apps/api/src/redis`)                                                                              | Built                                                                                                                    |
| S3-compatible object storage (SeaweedFS locally; bucket `runtruck-documents`) | Load documents (binaries). Metadata lives in `documents` and `document_versions`. | Owned by the documents module; see [13-document-system.md](13-document-system.md) and `docs/api/documents.md` | In progress (the parity slice). The `S3_*` variables are in `.env.example` but not yet in the `@runtruck/config` schema. |
| Google Fonts                                                              | Runtruck1's stylesheet link, loaded by the browser                                | `<link>` in `apps/web/src/app/layout.tsx`                                                                     | Built (parity)                                                                                                           |

## 2. Adapter pattern (for every future provider)

```
Domain service (e.g. TrackingService)
        │ depends on a port (TypeScript interface, provider-neutral types)
        ▼
TrackingProvider  ◀── implemented by ── SamsaraAdapter | FutureProviderAdapter
        │
        ▼
Provider HTTP API (credentials from env / secrets manager)
```

Rules:

- **Ports** (interfaces and provider-neutral DTOs) go in `packages/integrations`. The adapters go there too, or in `apps/api/src/integrations/<provider>`. Domain modules depend only on the port.
- **Validate every response** with Zod before it enters the domain (architecture §16). Never trust provider data.
- **Credentials per organization:** stored in `integration_accounts` (architecture §7), encrypted, scoped by `organization_id` and never returned to the browser. Platform-level keys come from environment variables and a secrets manager (§34).
- **Run in the background.** Synchronisation runs in worker jobs (`integration-sync`, `tracking-sync`) with retries, backoff and idempotency ([18](18-background-jobs.md)), not inside user requests. Webhooks from providers are verified (signature, timestamp) before they are accepted.
- **Errors:** provider failures surface to users as `502 INTEGRATION_ERROR` with a safe message. Details are logged with the request id ([19](19-security.md)).
- **Tests:** contract tests against recorded responses. An adapter counts as done only after it has been verified against the real provider sandbox.

## 3. Planned integrations

| Provider (architecture §25)                                   | Area                                                 | Phase                |
| ------------------------------------------------------------- | ---------------------------------------------------- | -------------------- |
| Samsara (and other ELD/GPS)                                   | Tracking, HOS, location history, ETA                 | 10                   |
| Email provider                                                | Password recovery, notifications                     | 2 follow-up / 14     |
| Twilio                                                        | SMS                                                  | 14                   |
| DAT, Truckstop                                                | Load boards                                          | 14                   |
| PC*Miler                                                      | Mileage and routing                                  | 14                   |
| WEX                                                           | Fuel cards                                           | 14                   |
| QuickBooks                                                    | Accounting sync (invoices, bills, payments)          | 14                   |
| Toll providers                                                | Tolls                                                | 14                   |
| Factoring companies (e.g. the "TriPoint Capital" seed record) | Receivables. Runtruck1 shows factoring only as data. | 14 (to be specified) |

Each integration is built on its own, with its own specification, as a Phase 14 item.
