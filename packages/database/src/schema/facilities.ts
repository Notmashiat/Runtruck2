import { sql } from 'drizzle-orm';
import { index, pgEnum, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { id, timestamps } from './_columns.js';
import { tenantKey } from './_tenant.js';
import { organizationId } from './platform.js';

// Facilities: shippers, consignees, yards and shops. Specified in docs/03-database.md §5.3.

export const facilityKind = pgEnum('facility_kind', ['shipper', 'consignee', 'crossdock', 'port', 'yard', 'shop']);

export const facilities = pgTable(
  'facilities',
  {
    id: id(),
    organizationId: organizationId(),
    name: text().notNull(),
    kind: facilityKind().notNull(),
    addressLine1: text(),
    city: text().notNull(),
    state: text().notNull(),
    postalCode: text(),
    // IANA zone; stop windows at this facility are wall-clock times in it.
    timezone: text().notNull(),
    // Market used in route labels when it differs from the address city
    // ("Reno, NV" for a Sparks, NV address). Null → city/state.
    marketCity: text(),
    marketState: text(),
    // Short market label for driver cards ("SLC"). Null → market city, then city.
    marketShort: text(),
    ...timestamps(),
  },
  (t) => [
    tenantKey('facilities', t),
    uniqueIndex('facilities_org_name_uq').on(t.organizationId, sql`lower(${t.name})`),
    index('facilities_org_kind_idx').on(t.organizationId, t.kind),
  ],
);
