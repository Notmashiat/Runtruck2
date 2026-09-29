# 14 — Notification System

Notifications tell people that something happened: a load was assigned, a document is missing, an invoice is past due. The architecture requires in-app, push, email and SMS channels, created from **events and background jobs rather than inside the API request** (architecture §22).

**Status (2026-09-29): nothing is built.** There are no notification tables, endpoints, providers or UI. Runtruck1 has no notifications either, so parity does not need them.

## 1. What exists that notifications will build on

| Building block                                                | Status                        | Reference                                            |
| ------------------------------------------------------------- | ----------------------------- | ---------------------------------------------------- |
| Domain events written through the transactional outbox        | Built (no events emitted yet) | [17-event-architecture.md](17-event-architecture.md) |
| Worker process with a handler registry (`DomainEventHandler`) | Built; one logging handler    | [18-background-jobs.md](18-background-jobs.md)       |
| Retries with exponential backoff; job id = event id           | Built                         | [18](18-background-jobs.md) §3                       |
| Tenant id on every event                                      | Built                         | [06](06-multi-tenancy.md)                            |

## 2. Target design

```
Business change ──tx──▶ events (outbox) ──worker──▶ domain-events queue
                                                      │
                                   NotificationHandler (idempotent on eventId)
                                                      │
                             notifications row (in-app)  +  enqueue channel jobs
                                                      │
                          push / email / sms queues ──▶ provider adapters
```

- **Recipients** are resolved in the handler from the organization's members and their permissions. Example: `LoadAssigned` goes to the assigned driver's user and to the dispatchers who follow the load. A notification must never reach a member who could not read the underlying record.
- **In-app notifications** are rows in `notifications` (architecture §7). Each row carries `organization_id`, the recipient user, the type, the entity reference and `read_at`. The API serves them with the usual tenant and permission rules.
- **Channels** (push, email, SMS) are separate queues. A slow or failing email provider then never delays in-app delivery. Every provider sits behind an adapter ([15](15-integration-architecture.md)).
- **Idempotency.** Each (event, recipient, channel) is delivered at most once. Enforce this with a unique key, because events are delivered at least once.
- **Preferences.** Per-user channel preferences are stored in PostgreSQL, never only in the browser.
- **Content.** Messages contain no secrets and the minimum personal data needed. Deep links point into the web or mobile app, which re-checks authorization when opened.

## 3. Phases

| Capability                                                                           | Phase        |
| ------------------------------------------------------------------------------------ | ------------ |
| Transactional email for password recovery (first email use; needs an email provider) | 2 follow-up  |
| In-app notifications and driver push (Expo)                                          | 9            |
| Document reminders (missing POD, expiring driver documents)                          | 11 / 9       |
| Billing reminders ("Send reminders" on Past Due is inert today)                      | 12 follow-up |
| SMS (e.g. Twilio) and email provider integrations                                    | 14           |
