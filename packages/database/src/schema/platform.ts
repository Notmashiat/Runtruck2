import { sql } from 'drizzle-orm';
import { bigint, index, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { id, timestamps } from './_columns.js';

// Platform tables: tenants, identity, sessions, access control, audit and the
// domain-event outbox. Specified in docs/03-database.md §2.

// Which calendar "Reset calendar" restores for an organization (D8, docs/03-database.md §2.1,
// §5.12.2): 'standard' = the six default color codes and no events; 'runtruck1_demo' = those
// codes plus Runtruck1's demo events (§7.25), set only by the demo seed. Tenant-specific
// demo content never reaches another organization.
export const plannerDefaultSet = pgEnum('planner_default_set', ['standard', 'runtruck1_demo']);

export const organizations = pgTable(
  'organizations',
  {
    id: id(),
    name: text().notNull(),
    // Short name used in UI copy, e.g. "Sunridge" ("Haul it with the Sunridge fleet").
    shortName: text().notNull(),
    // Human-facing company number shown in Settings › Profile ("30017"). Not a DB key (§8).
    companyNumber: text().notNull(),
    // IANA zone for the organization's office; business "today" is computed in it.
    timezone: text().notNull(),
    // The organization's own operating authority (own-fleet loads are hauled under it).
    mcNumber: text(),
    dotNumber: text(),
    plannerDefaults: plannerDefaultSet().notNull().default('standard'),
    ...timestamps(),
  },
  (t) => [uniqueIndex('organizations_company_number_uq').on(t.companyNumber)],
);

// Every tenant-owned table carries this column (architecture §2 Rule 3, §10).
export const organizationId = () =>
  uuid()
    .notNull()
    .references(() => organizations.id, { onDelete: 'restrict' });

export const userStatus = pgEnum('user_status', ['active', 'disabled']);

// Users are global identities; tenancy comes from organization_members.
export const users = pgTable(
  'users',
  {
    id: id(),
    email: text().notNull(),
    fullName: text().notNull(),
    passwordHash: text().notNull(),
    status: userStatus().notNull().default('active'),
    lastLoginAt: timestamp({ withTimezone: true, mode: 'date' }),
    ...timestamps(),
  },
  (t) => [uniqueIndex('users_email_lower_uq').on(sql`lower(${t.email})`)],
);

export const memberStatus = pgEnum('member_status', ['active', 'suspended']);

export const organizationMembers = pgTable(
  'organization_members',
  {
    id: id(),
    organizationId: organizationId(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    // Human-facing member number shown in Settings › Profile ("100482731").
    memberNumber: text().notNull(),
    // Job title shown next to the name ("Dispatch"). Display only — never used for authorization.
    title: text().notNull(),
    status: memberStatus().notNull().default('active'),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('organization_members_org_user_uq').on(t.organizationId, t.userId),
    uniqueIndex('organization_members_member_number_uq').on(t.memberNumber),
    index('organization_members_user_idx').on(t.userId),
  ],
);

// Server-side sessions. Only a SHA-256 hash of the opaque token is stored, so a
// database leak does not yield usable session cookies (docs/05-authentication.md).
export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    tokenHash: text().notNull(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    organizationId: organizationId(),
    expiresAt: timestamp({ withTimezone: true, mode: 'date' }).notNull(),
    lastSeenAt: timestamp({ withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    revokedAt: timestamp({ withTimezone: true, mode: 'date' }),
    ipAddress: text(),
    userAgent: text(),
    ...timestamps(),
  },
  (t) => [uniqueIndex('sessions_token_hash_uq').on(t.tokenHash), index('sessions_user_idx').on(t.userId)],
);

// Global permission catalog; keys come from @runtruck/permissions (docs/07-roles-permissions.md).
export const permissions = pgTable(
  'permissions',
  {
    id: id(),
    key: text().notNull(),
    description: text().notNull(),
    ...timestamps(),
  },
  (t) => [uniqueIndex('permissions_key_uq').on(t.key)],
);

// Roles are per organization so each tenant can tailor them (Phase 4 permission management).
export const roles = pgTable(
  'roles',
  {
    id: id(),
    organizationId: organizationId(),
    key: text().notNull(),
    name: text().notNull(),
    description: text().notNull().default(''),
    ...timestamps(),
  },
  (t) => [uniqueIndex('roles_org_key_uq').on(t.organizationId, t.key)],
);

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: uuid()
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permissionId: uuid()
      .notNull()
      .references(() => permissions.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionId] })],
);

export const userRoles = pgTable(
  'user_roles',
  {
    id: id(),
    organizationId: organizationId(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleId: uuid()
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('user_roles_org_user_role_uq').on(t.organizationId, t.userId, t.roleId),
    index('user_roles_user_idx').on(t.userId),
  ],
);

// Per-organization sequences for human-facing numbers (load L-40223, invoice INV-8846…).
// Incremented atomically with UPDATE … RETURNING inside the creating transaction.
export const organizationCounters = pgTable(
  'organization_counters',
  {
    organizationId: organizationId(),
    key: text().notNull(),
    nextValue: bigint({ mode: 'number' }).notNull(),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.key] })],
);

// Append-only audit trail (architecture §30). A trigger in the migrations rejects
// UPDATE and DELETE so the application cannot rewrite history.
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: id(),
    organizationId: organizationId(),
    // Null for system actions (seed, background workers).
    actorUserId: uuid().references(() => users.id, { onDelete: 'restrict' }),
    action: text().notNull(),
    entityType: text().notNull(),
    entityId: uuid().notNull(),
    // Human-facing label at the time of the action, e.g. "L-40223".
    entityLabel: text(),
    previous: jsonb(),
    next: jsonb(),
    requestId: text(),
    occurredAt: timestamp({ withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_logs_org_entity_idx').on(t.organizationId, t.entityType, t.entityId, t.occurredAt),
    index('audit_logs_org_occurred_idx').on(t.organizationId, t.occurredAt),
  ],
);

// Transactional outbox for domain events (architecture §23). Written in the same
// transaction as the business change; a worker publishes rows to BullMQ.
export const events = pgTable(
  'events',
  {
    id: id(),
    organizationId: organizationId(),
    type: text().notNull(),
    aggregateType: text().notNull(),
    aggregateId: uuid().notNull(),
    payload: jsonb().notNull(),
    actorUserId: uuid().references(() => users.id, { onDelete: 'restrict' }),
    requestId: text(),
    occurredAt: timestamp({ withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    publishedAt: timestamp({ withTimezone: true, mode: 'date' }),
    publishAttempts: bigint({ mode: 'number' }).notNull().default(0),
    lastError: text(),
    // Publisher lease: a worker claims a batch by setting this in a short statement, then
    // enqueues outside any transaction; other workers skip the row until the lease ends
    // (docs/17-event-architecture.md §2, migration 0004).
    claimedUntil: timestamp({ withTimezone: true, mode: 'date' }),
  },
  (t) => [
    index('events_unpublished_idx')
      .on(t.occurredAt)
      .where(sql`${t.publishedAt} is null`),
    index('events_org_aggregate_idx').on(t.organizationId, t.aggregateType, t.aggregateId),
  ],
);
