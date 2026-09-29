# 16 — AI Architecture

AI in Runtruck is **another client of the backend**. It works only through controlled tools that call the same services, with the same authentication, authorization, tenant isolation, validation, business rules and audit as a human user (architecture §26, §27).

**Status (2026-09-29): nothing is built, and nothing is planned for this release** (docs/01 §5: AI is Phase 15). The repository has no AI dependency, no model provider configuration and no AI keys in `.env.example`.

## 1. Non-negotiable rules

- AI never gets direct or unrestricted database access. There is no SQL tool and no raw read-only connection.
- Every tool call runs **as a specific user in a specific organization**, with that member's permissions (`AuthContext`). The AI can never do more than the person using it could do by hand.
- Tool inputs are validated with Zod schemas from `@runtruck/validation`, exactly like HTTP input (§16).
- Every AI write goes through the domain service, so it produces the same `audit_logs` rows and domain events. The audit entry records that the action was AI-initiated and which user approved it.
- AI output is never the source of truth (Rule 1). What persists is what the service wrote to PostgreSQL.
- Provider keys (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, …) live in environment variables and a secrets manager only (§34). They never reach the browser.
- Tenant data sent to a model provider must respect the organization's data-processing terms. Send the minimum necessary, and no secrets.

## 2. Action classes (architecture §26)

| Class     | Behaviour                                                  | Examples                                                                                             |
| --------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Read      | May run automatically, within the member's permissions     | `getLoad`, `findAvailableDrivers`, `findAvailableTrucks`, `getLoadRevenue`                           |
| Suggest   | Produces a proposal. Nothing is executed.                  | `draftMessage`, a suggested driver for a load                                                        |
| Write     | Requires the member's permission for the underlying action | `createDraftLoad`                                                                                    |
| Sensitive | Requires explicit human confirmation in the UI, every time | Approve settlement, send payment, delete a load, cancel a major transaction, change company settings |

## 3. Target shape

```
User (web / mobile) ──▶ AI endpoint (/api/v1/ai/…, authenticated, permission-checked)
                           │  conversation + member context (ids only)
                           ▼
                        Model provider (adapter, see 15)
                           │  tool call request
                           ▼
                        Tool registry: Zod input schema + required permission + action class
                           │  sensitive → return a confirmation request to the user
                           ▼
                        Domain service (same code path as the REST endpoint)
                           │
                        PostgreSQL + audit + outbox event
```

Long-running AI work, such as document classification or bulk suggestions, runs as `ai-processing` jobs in the worker ([18](18-background-jobs.md)).

## 4. Before Phase 15 starts

- Choose the provider and record the §40 dependency justification.
- Define the tool catalogue with an action class and a permission for each tool.
- Decide whether AI features get their own permission (for example `ai.use`) in [07](07-roles-permissions.md).
- Decide data retention for prompts and responses.
