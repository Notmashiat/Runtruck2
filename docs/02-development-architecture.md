# Runtruck TMS — DEVELOPMENT ARCHITECTURE

- **Document Type:** Master Development Architecture
- **Project:** Runtruck TMS
- **Architecture Style:** Modular Monolith + Event-Driven Background Processing
- **Primary Language:** TypeScript
- **Database:** PostgreSQL
- **Frontend:** Next.js + React
- **Backend:** NestJS
- **ORM:** Drizzle
- **Mobile:** React Native + Expo
- **Package Manager:** pnpm
- **Monorepo:** Turborepo

> This is the master rule set for Runtruck development. Every change must comply with it.
> Detailed specifications live in the other documents in `docs/` (see section 48).

---

## 1. PURPOSE

Runtruck is a multi-tenant Transportation Management System (TMS) designed for trucking companies, carriers, dispatchers, drivers, accounting teams, managers, and administrators.

The system must support:

- Load management
- Dispatching
- Drivers
- Trucks
- Trailers
- Customers
- Carriers
- Tracking
- Documents
- Billing
- Settlements
- Notifications
- Integrations
- AI-assisted operations
- Reporting
- Multi-company SaaS functionality

The architecture must be designed from the beginning to support growth from small trucking companies to a large SaaS platform with millions of records.

---

## 2. CORE ARCHITECTURE PRINCIPLES

Claude must follow these principles throughout development.

### Rule 1 — PostgreSQL is the source of truth

Business data must ultimately be stored in PostgreSQL.

Do not use frontend state, Redis, browser storage, or AI memory as the authoritative source of business data.

### Rule 2 — Backend owns business logic

The frontend should display information and request actions.

The backend must enforce:

- Authentication
- Authorization
- Tenant isolation
- Validation
- Business rules
- Database operations
- Financial rules
- Security rules

Never rely on frontend checks for security.

### Rule 3 — Every tenant-owned record must be isolated

Company A must never be able to access Company B's data.

Tenant ownership must be enforced server-side.

Example: `organization_id` must exist on appropriate tenant-owned records.

Every query involving tenant-owned data must respect organization boundaries.

### Rule 4 — Never trust the client

The frontend can send `organization_id`, `user_id`, `role`, `permissions`, `load_id`, but the backend must never blindly trust these values.

The backend must determine the authenticated user's organization and permissions from the authenticated session.

### Rule 5 — Business logic must not live only in React

Important business rules must exist in backend/domain services.

Example: A dispatcher cannot assign an inactive driver. This rule must be enforced by the backend even if the frontend already disables the button.

### Rule 6 — Use TypeScript throughout

Use TypeScript for:

- Web
- API
- Shared packages
- Database layer
- Validation
- Business logic
- Mobile
- Tests
- Scripts

Avoid JavaScript unless there is a specific technical reason.

### Rule 7 — Prefer simple architecture over unnecessary complexity

Do not introduce microservices just because they are popular.

Runtruck should initially use a **Modular Monolith** with:

- NestJS modules
- PostgreSQL
- Redis
- Background workers
- Event-driven internal communication

The architecture must allow future services to be extracted if scale requires it.

---

## 3. SYSTEM ARCHITECTURE

High-level architecture:

```
                         Runtruck TMS
                              │
              ┌───────────────┴───────────────┐
              │                               │
          Web App                         Mobile App
        Next.js/React                 React Native/Expo
              │                               │
              └───────────────┬───────────────┘
                              │
                         HTTPS / API
                              │
                        NestJS Backend
                              │
       ┌──────────────────────┼──────────────────────┐
       │                      │                      │
   Domain Modules       Authentication           API Layer
       │                      │                      │
       └──────────────────────┼──────────────────────┘
                              │
                     PostgreSQL Database
                              │
                    ┌─────────┴─────────┐
                    │                   │
                  Redis           Object Storage
                    │                   │
              Background Jobs       Documents
                    │
              External APIs
```

---

## 4. MONOREPO STRUCTURE

Use a pnpm + Turborepo monorepo.

```
Runtruck/
│
├── apps/
│   ├── web/
│   │   └── Next.js application
│   │
│   ├── api/
│   │   └── NestJS backend
│   │
│   └── mobile/
│       └── React Native / Expo
│
├── packages/
│   ├── database/
│   ├── types/
│   ├── validation/
│   ├── permissions/
│   ├── ui/
│   ├── calculations/
│   ├── integrations/
│   ├── config/
│   └── eslint-config/
│
├── infrastructure/
│   ├── docker/
│   ├── terraform/
│   └── deployment/
│
├── docs/
│
├── tests/
│
├── package.json
├── pnpm-workspace.yaml
└── turbo.json
```

---

## 5. FRONTEND ARCHITECTURE

Use Next.js, React, TypeScript.

Frontend responsibilities:

- User interface
- Navigation
- Forms
- Tables
- Dashboards
- Maps
- Load boards
- Dispatch boards
- Driver interfaces
- API communication
- Client-side presentation state

Frontend must NOT be responsible for:

- Tenant security
- Permission enforcement
- Financial calculations that require authoritative results
- Direct database access
- Direct access to secret API keys

---

## 6. BACKEND ARCHITECTURE

Use NestJS. Organize backend by business domain.

```
apps/api/src/
├── auth/
├── organizations/
├── users/
├── roles/
├── permissions/
│
├── customers/
├── carriers/
├── drivers/
├── trucks/
├── trailers/
├── locations/
│
├── loads/
├── stops/
├── appointments/
├── dispatch/
├── tracking/
│
├── documents/
├── notifications/
├── messaging/
│
├── billing/
├── invoices/
├── settlements/
├── payments/
│
├── fuel/
├── tolls/
├── maintenance/
├── compliance/
│
├── integrations/
├── ai/
├── audit/
│
└── common/
```

Each domain should be independently organized. Example:

```
loads/
├── loads.controller.ts
├── loads.service.ts
├── loads.repository.ts
├── loads.schema.ts
├── loads.types.ts
├── loads.events.ts
├── loads.module.ts
└── tests/
```

---

## 7. DATABASE ARCHITECTURE

Use PostgreSQL + Drizzle ORM.

The database must be relational and normalized appropriately.

Important core tables will include:

```
organizations
users
roles
permissions
user_roles

customers
carriers
drivers
trucks
trailers

loads
load_stops
appointments
dispatches

documents
document_versions

invoices
invoice_items
payments

settlements
settlement_items

notifications
messages

integrations
integration_accounts

audit_logs

events
background_jobs
```

The complete database specification must be maintained separately in `docs/database.md`.

Claude must not invent database structures that contradict that document.

---

## 8. DATABASE ID POLICY

Use UUIDs for public/application identifiers unless a specific domain requires another strategy.

```
id: UUID
organization_id: UUID
created_at: timestamp
updated_at: timestamp
```

Do not expose sequential database IDs unnecessarily.

---

## 9. TIMESTAMP POLICY

All database timestamps should be stored consistently in UTC.

The frontend may convert timestamps into the user's local timezone.

```
Database:            2026-09-28T18:00:00Z
User in New York:    2:00 PM
```

Never store ambiguous local times without timezone information when timezone matters.

---

## 10. MULTI-TENANCY

Runtruck is a multi-tenant SaaS. The primary tenant is **Organization**.

```
Organization A
├── Users
├── Drivers
├── Trucks
├── Loads
└── Customers

Organization B
├── Users
├── Drivers
├── Trucks
├── Loads
└── Customers
```

The backend must automatically determine the authenticated user's organization.

Do not allow users to select arbitrary organization IDs to access data.

---

## 11. AUTHENTICATION

Authentication establishes: *Who is the user?*

Authorization establishes: *What is the user allowed to do?*

These must remain separate concepts.

Authentication must provide an authenticated user context containing at minimum:

- `user_id`
- `organization_id`
- session information

---

## 12. AUTHORIZATION

Every protected operation must verify:

```
Authenticated?
↓
Correct organization?
↓
Required permission?
↓
Business rule satisfied?
↓
Perform operation
```

Example: `PATCH /loads/:id` must verify:

1. User is authenticated.
2. Load belongs to user's organization.
3. User has `loads.update`.
4. Load is in a state that allows the requested change.
5. Update is valid.

---

## 13. ROLES AND PERMISSIONS

Roles are collections of permissions.

Example roles: Owner, Admin, Dispatcher, Driver, Accounting, Manager, Maintenance.

Permissions should be granular. Examples:

```
loads.view
loads.create
loads.update
loads.delete
loads.assign

drivers.view
drivers.create
drivers.update

billing.view
billing.create
billing.approve

settlements.view
settlements.create
settlements.approve
```

Do not use only frontend role checks. Authorization must be enforced in the backend.

---

## 14. API ARCHITECTURE

Use REST APIs initially.

```
GET    /api/v1/loads
GET    /api/v1/loads/:id
POST   /api/v1/loads
PATCH  /api/v1/loads/:id
DELETE /api/v1/loads/:id

POST   /api/v1/loads/:id/assign
POST   /api/v1/loads/:id/cancel
POST   /api/v1/loads/:id/complete
```

Use API versioning: `/api/v1/`

Do not make breaking API changes without versioning or a documented migration strategy.

---

## 15. API RESPONSE STANDARD

Use consistent response structures.

Success:

```json
{
  "data": {},
  "meta": {}
}
```

Error:

```json
{
  "error": {
    "code": "LOAD_NOT_FOUND",
    "message": "Load was not found.",
    "requestId": "..."
  }
}
```

Do not expose sensitive internal errors to users.

---

## 16. VALIDATION

Use Zod or an equivalent centralized validation strategy.

Validate:

- API input
- Forms
- Query parameters
- File metadata
- Integration responses where appropriate
- AI tool inputs

Never assume external data is valid.

---

## 17. LOAD DOMAIN

A load represents transportation work Runtruck is managing.

```
Load
├── Customer
├── Origin
├── Destination
├── Stops
├── Appointment
├── Rate
├── Driver
├── Truck
├── Trailer
├── Documents
└── Status
```

Example lifecycle:

```
DRAFT → BOOKED → DISPATCHED → AT_PICKUP → LOADED → IN_TRANSIT → AT_DELIVERY
→ DELIVERED → POD_RECEIVED → READY_FOR_BILLING → INVOICED → PAID
```

Actual statuses must be defined in the business-domain specification.

---

## 18. DOMAIN STATE MACHINES

Important entities must use controlled state transitions.

`DRAFT → DISPATCHED` may be valid. But `PAID → DRAFT` should not happen through a normal user action.

Every state transition should have:

- Allowed previous states
- New state
- Required permissions
- Required data
- Audit event

---

## 19. DISPATCH ARCHITECTURE

Dispatching connects Load + Driver + Truck + Trailer.

Before assignment, the system should be able to evaluate:

- Driver availability
- Truck availability
- Trailer availability
- Current location
- Load timing
- Appointment requirements
- Relevant compliance constraints
- Other configured business rules

Dispatch assignment must happen through backend business logic.

---

## 20. DRIVER APPLICATION

The mobile application will allow drivers to:

- Login
- View assigned loads
- View stops
- Navigate to stops
- Update status
- Upload documents
- Take photos
- Send messages
- Receive notifications
- Share location when authorized
- View relevant load information

The driver application must communicate with the same backend API.

---

## 21. DOCUMENT ARCHITECTURE

Binary files must not be stored directly inside PostgreSQL unless specifically required.

Use object storage such as S3-compatible storage.

PostgreSQL stores metadata:

```
document_id
organization_id
load_id
document_type
file_name
storage_key
mime_type
file_size
uploaded_by
created_at
```

Example:

```
Load
├── Rate Confirmation
├── BOL
├── POD
└── Lumper Receipt
```

Documents must have permission checks.

---

## 22. NOTIFICATION ARCHITECTURE

Notifications should support: In-app, Push, Email, SMS.

Notification creation should normally occur through events/background jobs rather than blocking the main API request.

```
LoadAssigned
↓
Notification Job
↓
Driver Push Notification
```

---

## 23. EVENT ARCHITECTURE

Important business actions should produce domain events. Examples:

```
LoadCreated
LoadAssigned
LoadDispatched
LoadPickedUp
LoadDelivered
PODUploaded
InvoiceCreated
InvoicePaid
SettlementApproved
```

Events may trigger:

- Notifications
- Background processing
- AI processing
- Analytics
- Integration synchronization

Events must be idempotent where necessary.

---

## 24. BACKGROUND JOB ARCHITECTURE

Use Redis + BullMQ for asynchronous work. Examples:

```
document-processing
email
sms
notifications
tracking-sync
integration-sync
invoice-generation
AI-processing
route-calculation
```

Jobs must support:

- Retries
- Backoff
- Failure handling
- Logging
- Idempotency where appropriate

---

## 25. INTEGRATION ARCHITECTURE

External integrations must be isolated behind integration adapters.

```
Runtruck
  ↓
TrackingService
  ↓
SamsaraAdapter
```

The core Runtruck domain should not contain provider-specific logic everywhere.

```
TrackingProvider
├── SamsaraAdapter
└── FutureProviderAdapter
```

This makes providers replaceable.

Potential integrations include: Samsara, DAT, Truckstop, PC*Miler, WEX, QuickBooks, Toll providers, Twilio, Email provider.

Do not assume an integration exists until its API has been verified and implemented.

---

## 26. AI ARCHITECTURE

AI must operate through controlled tools.

AI must NOT receive unrestricted production database access.

```
AI Assistant
     ↓
Tool
     ↓
Backend Service
     ↓
Authorization
     ↓
Database
```

Example AI tools:

```
findAvailableTrucks()
findAvailableDrivers()
getLoad()
getDriverLocation()
calculateRoute()
getLoadRevenue()
createDraftLoad()
draftMessage()
```

AI actions should be classified:

- **Read** — Usually safe to execute automatically.
- **Suggest** — AI proposes an action but does not execute it.
- **Write** — Requires appropriate authorization.
- **Sensitive** — Requires explicit human confirmation.

Examples of sensitive actions: Send financial payment, Approve settlement, Delete load, Cancel major transaction, Change company settings.

---

## 27. AI SAFETY RULE

AI must never bypass:

- Authentication
- Authorization
- Tenant isolation
- Validation
- Business rules
- Audit logging

AI is another client of the backend. It must obey the same rules as a normal user.

---

## 28. CACHING

Redis may be used for:

- Frequently accessed data
- Sessions where appropriate
- Rate limiting
- Temporary state
- Job queues
- Short-lived external API responses

Redis must not become the authoritative source of permanent business data.

---

## 29. ERROR HANDLING

All errors must be categorized:

```
VALIDATION_ERROR
UNAUTHORIZED
FORBIDDEN
NOT_FOUND
CONFLICT
RATE_LIMITED
INTEGRATION_ERROR
INTERNAL_ERROR
```

Every unexpected error must be logged with a request ID/correlation ID.

Never expose database stack traces, secrets, API keys, or internal infrastructure details to end users.

---

## 30. AUDIT LOGGING

Important actions must be auditable.

```
User:       John
Action:     LOAD_ASSIGNED
Object:     Load 12345
Previous:   Unassigned
New:        Driver 567
Timestamp:  2026-09-28T18:00:00Z
```

Audit logs should be append-only from the application's normal perspective.

---

## 31. TESTING ARCHITECTURE

Every feature must have tests appropriate to its risk.

- **Unit tests** — Test individual functions/services.
- **Integration tests** — Test database/API interactions.
- **End-to-end tests** — Test real user workflows.

```
Login → Create Load → Assign Driver → Driver Accepts → Driver Delivers → Upload POD → Create Invoice
```

Critical business workflows must have end-to-end coverage.

---

## 32. CI/CD

Every pull request should automatically run:

```
Install dependencies → Lint → Type check → Unit tests → Integration tests → Build
```

Production deployment must require successful checks.

---

## 33. ENVIRONMENTS

Maintain separate environments: Development, Staging, Production.

Never use production credentials locally.

Never test destructive migrations against production.

---

## 34. SECRETS

Secrets must never be committed to Git. Examples:

```
DATABASE_URL
REDIS_URL
S3_SECRET
SAMSARA_API_KEY
OPENAI_API_KEY
ANTHROPIC_API_KEY
```

Use environment variables and a proper secrets-management system.

---

## 35. OBSERVABILITY

Production systems must provide:

- Application logs
- Error tracking
- Performance monitoring
- Database monitoring
- Background job monitoring
- Integration monitoring

Monitor:

- API latency
- Error rates
- Database performance
- Queue failures
- Integration failures
- CPU/memory
- Storage
- Request volume

---

## 36. DISASTER RECOVERY

PostgreSQL must have automated backups.

Define:

- Backup frequency
- Backup retention
- Recovery procedure
- Recovery Point Objective (RPO)
- Recovery Time Objective (RTO)

Production recovery procedures must be documented and tested.

---

## 37. SCALABILITY

The system must support growth through:

- Database indexes
- Efficient queries
- Pagination
- Caching
- Background jobs
- Connection pooling
- Object storage
- Horizontal API scaling
- Worker scaling

Never load millions of database records into a browser.

All large datasets must use pagination, filtering, sorting, and search.

---

## 38. PERFORMANCE RULES

API endpoints must avoid unnecessary database queries.

Avoid N+1 queries. Use appropriate indexes. Large operations should use background jobs.

Bad:

```
Generate 500,000 invoices during HTTP request
```

Good:

```
Create job → Queue → Worker processes invoices → Track progress
```

---

## 39. CODE QUALITY

Claude must:

- Use strict TypeScript.
- Avoid `any` unless explicitly justified.
- Keep functions reasonably small.
- Use clear naming.
- Avoid duplicated business logic.
- Prefer reusable services.
- Add tests for business-critical logic.
- Document complex logic.
- Avoid unnecessary abstractions.

---

## 40. DEPENDENCY POLICY

Before adding a new dependency, Claude must determine:

1. Why it is needed.
2. Whether existing dependencies can solve the problem.
3. Whether it is actively maintained.
4. Whether it introduces security or licensing concerns.
5. Whether it creates unnecessary architectural complexity.

Do not add dependencies simply for convenience.

---

## 41. GIT POLICY

Use Git for all development.

Branches should follow a predictable structure:

```
main
develop
feature/*
fix/*
```

Examples:

```
feature/load-creation
feature/driver-mobile-login
fix/load-assignment-permission
```

Commits should clearly describe the change. Examples:

```
feat: add load creation API
fix: enforce tenant isolation on loads
test: add load assignment tests
```

---

## 42. DEVELOPMENT WORKFLOW FOR CLAUDE

Claude must follow this process for every feature.

1. Read relevant documentation.
2. Understand existing architecture.
3. Inspect existing code.
4. Identify affected modules.
5. Create implementation plan.
6. Implement smallest correct change.
7. Run type checking.
8. Run linting.
9. Run relevant tests.
10. Run broader tests when appropriate.
11. Review security implications.
12. Review tenant isolation.
13. Review permissions.
14. Review database impact.
15. Report what changed.
16. Report tests performed.
17. Report any remaining issues.

Claude must not skip directly from Request → Code without understanding the existing architecture.

---

## 43. CLAUDE MUST NOT DO THESE THINGS

Claude must NOT:

- Rewrite the entire application unnecessarily.
- Change the technology stack without approval.
- Replace PostgreSQL without approval.
- Introduce microservices without approval.
- Delete working functionality without approval.
- Modify unrelated modules.
- Disable security checks to make tests pass.
- Bypass tenant isolation.
- Give AI direct unrestricted database access.
- Store secrets in source code.
- Ignore failing tests.
- Hide errors.
- Mark incomplete work as complete.
- Invent external API behavior.
- Assume an integration works without verification.
- Make destructive production changes without explicit approval.

---

## 44. FEATURE DEVELOPMENT TEMPLATE

Every new feature must be defined using:

```
FEATURE:
PURPOSE:
USERS:
PERMISSIONS:
DATABASE TABLES:
DATABASE CHANGES:
API ENDPOINTS:
BUSINESS RULES:
STATE CHANGES:
EVENTS:
BACKGROUND JOBS:
NOTIFICATIONS:
INTEGRATIONS:
AI:
SECURITY REQUIREMENTS:
ERROR CASES:
TESTS:
ACCEPTANCE CRITERIA:
```

---

## 45. ACCEPTANCE CRITERIA

A feature is not complete merely because the code exists.

A feature is complete only when:

```
Requirements implemented
+ Security implemented
+ Tenant isolation verified
+ Permissions verified
+ Validation implemented
+ Tests passing
+ Build passing
+ No known critical errors
+ Acceptance criteria satisfied
```

---

## 46. EXAMPLE FEATURE

### Create Load

**Purpose:** Allow an authorized dispatcher to create a new transportation load.

**Permissions:** `loads.create`

**Required information:** Customer, Pickup location, Delivery location, Pickup date/time, Delivery date/time, Rate.

**Backend behavior:**

```
Authenticate user
↓
Determine organization
↓
Verify loads.create permission
↓
Validate request
↓
Create load
↓
Create stops
↓
Create audit record
↓
Emit LoadCreated event
↓
Return load
```

**Security:** The created load must belong to the authenticated user's organization.

**Acceptance tests:**

1. Authorized dispatcher can create a load.
2. Unauthorized user cannot create a load.
3. User cannot create a load for another organization.
4. Missing required information is rejected.
5. Invalid rate is rejected.
6. LoadCreated event is emitted.
7. Audit log is created.
8. API tests pass.
9. Unit tests pass.
10. End-to-end test passes.

---

## 47. DEVELOPMENT PHASES

Claude should build Runtruck in controlled phases.

- **Phase 1 — Foundation:** Monorepo, TypeScript, Next.js, NestJS, PostgreSQL, Drizzle, Redis, Testing, CI, Environment configuration
- **Phase 2 — Authentication:** Users, Sessions, Login, Logout, Password/account recovery, Organization membership
- **Phase 3 — Multi-Tenancy:** Organizations, Tenant isolation, Organization settings, Tenant-aware database access
- **Phase 4 — Roles & Permissions:** Roles, Permissions, Authorization guards, Permission management
- **Phase 5 — Fleet:** Drivers, Trucks, Trailers, Carriers
- **Phase 6 — Customers & Locations:** Customers, Contacts, Locations, Addresses
- **Phase 7 — Loads:** Load creation, Stops, Appointments, Rates, Load statuses, Load search/filtering
- **Phase 8 — Dispatch:** Driver assignment, Truck assignment, Trailer assignment, Dispatch board, Dispatch workflow
- **Phase 9 — Driver Mobile App:** Driver login, Assigned loads, Status updates, Stop workflow, Documents, Notifications
- **Phase 10 — Tracking:** GPS, Samsara integration, Location history, ETA, Tracking events
- **Phase 11 — Documents:** Upload, Storage, Permissions, POD, BOL, Rate confirmations, Document processing
- **Phase 12 — Billing:** Invoices, Invoice items, Payments, Customer billing
- **Phase 13 — Settlements:** Driver pay, Carrier pay, Deductions, Settlement approval, Settlement history
- **Phase 14 — External Integrations:** Implement integrations individually.
- **Phase 15 — AI:** Implement controlled AI tools and workflows.
- **Phase 16 — Production Hardening:** Security review, Performance testing, Load testing, Disaster recovery testing, Monitoring, Backup verification

---

## 48. DOCUMENTATION HIERARCHY

The repository should contain:

```
docs/
01-product-requirements.md
02-development-architecture.md
03-database.md
04-api.md
05-authentication.md
06-multi-tenancy.md
07-roles-permissions.md
08-load-lifecycle.md
09-dispatch-lifecycle.md
10-driver-lifecycle.md
11-billing-lifecycle.md
12-settlement-lifecycle.md
13-document-system.md
14-notification-system.md
15-integration-architecture.md
16-ai-architecture.md
17-event-architecture.md
18-background-jobs.md
19-security.md
20-testing.md
21-deployment.md
22-monitoring.md
23-disaster-recovery.md
24-development-phases.md
25-claude-development-rules.md
```

The master architecture document establishes the rules. The individual documents contain the detailed specifications.

---

## 49. SOURCE OF TRUTH HIERARCHY

When documentation conflicts, use this priority:

1. Explicit approved product requirements
2. Security requirements
3. Database specification
4. Development architecture
5. API specification
6. Domain specifications
7. Existing implementation
8. Claude's assumptions

Claude must never silently choose an assumption when requirements conflict. Instead, Claude should identify the conflict.

---

## 50. FINAL RULE FOR CLAUDE

Runtruck is intended to become a real production SaaS platform.

Therefore, do not optimize for generating the most code. Optimize for:

- Correctness
- Security
- Maintainability
- Tenant isolation
- Testability
- Performance
- Reliability
- Scalability
- Clear architecture

Before implementing a feature, understand the architecture.

Before changing the architecture, explain why.

Before making a destructive change, ask for approval.

Before declaring a feature complete, verify its acceptance criteria.

The goal is not simply to make Runtruck work today. The goal is to build Runtruck so that it can continue working as the number of companies, users, loads, documents, integrations, and transactions grows.
