# Runtruck2 — instructions for Claude

**Every change in this repository MUST follow [docs/02-development-architecture.md](docs/02-development-architecture.md)**, the Runtruck TMS Development Architecture. Read the relevant sections before any work, and never take actions outside it. When a request conflicts with it, name the conflict and ask; never silently pick an assumption (section 49).

## Non-negotiables (summary; the document is authoritative)

- **Stack:** TypeScript everywhere · pnpm + Turborepo monorepo · Next.js + React (`apps/web`) · NestJS (`apps/api`) · PostgreSQL + Drizzle (`packages/database`) · Redis + BullMQ · React Native + Expo (`apps/mobile`). No stack changes or microservices without approval.
- **Source of truth:** PostgreSQL. Browser storage, React state, Redis and AI memory are never authoritative for business data.
- **Backend responsibilities:** the backend owns business logic, validation (Zod), authentication, authorization, and tenant isolation. It derives the user, their `organization_id`, and their permissions from the session, never from the client.
- **Data rules:** every tenant-owned row has `organization_id`. Ids are UUIDs. Timestamps are UTC.
- **API:** REST under `/api/v1/`. Success responses are `{ data, meta }`. Errors are `{ error: { code, message, requestId } }` using categorized codes. No internal details leak to users.
- **Domain behavior:** important entities use state machines, important actions emit domain events, and audit logs are append-only.
- **Secrets:** never in git. Use environment variables and keep `.env.example` files up to date.
- **Process:** build in the phases of section 47. Follow the 17-step workflow of section 42 and the feature template of section 44. A feature is complete only when section 45 is satisfied.
- **Git:** branches are `main`, `develop`, `feature/*`, `fix/*`. Commits use conventional messages (`feat:`, `fix:`, `test:`…).
- **Dependencies:** justify every new one against section 40.

## Reference implementation

The web UI is ported from the Runtruck1 prototype (https://github.com/Notmashiat/Runtruck1, `app/` folder, a Vite + React app running on mock data). The web app must look and behave exactly like it. Its data and business logic must follow the architecture above.
