import { foreignKey, unique, type AnyPgColumn } from 'drizzle-orm/pg-core';

// Tenant-safe references (docs/03-database.md §1.3). Every tenant table exposes
// UNIQUE (organization_id, id), and every reference between two tenant tables is a
// composite foreign key (organization_id, <x>_id) → (organization_id, id), so a row
// can never point at a row of another organization, whatever the application does.

interface TenantTable {
  organizationId: AnyPgColumn;
  id: AnyPgColumn;
}

// UNIQUE (organization_id, id): the target of every composite tenant FK.
export const tenantKey = (table: string, t: TenantTable) => unique(`${table}_org_id_uq`).on(t.organizationId, t.id);

// (organization_id, column) → target (organization_id, id). The caller adds .onDelete(...).
export const tenantFk = (name: string, organizationId: AnyPgColumn, column: AnyPgColumn, target: TenantTable) =>
  foreignKey({ name, columns: [organizationId, column], foreignColumns: [target.organizationId, target.id] });
