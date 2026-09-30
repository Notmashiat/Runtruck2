import { sql } from 'drizzle-orm';
import { boolean, index, integer, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { id, timestamps } from './_columns.js';
import { tenantKey } from './_tenant.js';
import { organizationId } from './platform.js';

// Carriers: the organization's own authority (is_own_fleet) and partner carriers
// that brokered loads are tendered to. Specified in docs/03-database.md §5.2.

export const carriers = pgTable(
  'carriers',
  {
    id: id(),
    organizationId: organizationId(),
    // Stored without the " (own fleet)" suffix; the web appends it when is_own_fleet.
    name: text().notNull(),
    // Digits only ("812044"); the web renders "MC 812044" / "DOT 2291176".
    mcNumber: text(),
    dotNumber: text(),
    isOwnFleet: boolean().notNull().default(false),
    position: integer().notNull(),
    ...timestamps(),
  },
  (t) => [
    tenantKey('carriers', t),
    uniqueIndex('carriers_org_name_uq').on(t.organizationId, sql`lower(${t.name})`),
    // Exactly one own-fleet row per organization.
    uniqueIndex('carriers_own_fleet_uq')
      .on(t.organizationId)
      .where(sql`${t.isOwnFleet}`),
    index('carriers_org_position_idx').on(t.organizationId, t.position),
  ],
);
