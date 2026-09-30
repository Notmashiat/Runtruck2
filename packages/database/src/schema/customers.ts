import { sql } from 'drizzle-orm';
import { boolean, index, integer, pgEnum, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { id, timestamps } from './_columns.js';
import { tenantFk, tenantKey } from './_tenant.js';
import { organizationId } from './platform.js';

// Customers (CRM) and their contacts. Specified in docs/03-database.md §5.1.

// Runtruck1 "tier": Key account / Growing / At risk.
export const customerStanding = pgEnum('customer_standing', ['key_account', 'growing', 'at_risk']);

// Runtruck1 terms: Net 15 / Net 30 / Net 45 / Net 60 / Quick pay. Used by customers, loads and invoices.
export const paymentTerms = pgEnum('payment_terms', ['net_15', 'net_30', 'net_45', 'net_60', 'quick_pay']);

export const customers = pgTable(
  'customers',
  {
    id: id(),
    organizationId: organizationId(),
    name: text().notNull(),
    standing: customerStanding().notNull(),
    // Default terms, copied onto new loads (New Load pre-fills "Payment terms").
    paymentTerms: paymentTerms().notNull(),
    // Hand-authored list order (CRM table, New Load customer select).
    position: integer().notNull(),
    ...timestamps(),
  },
  (t) => [
    tenantKey('customers', t),
    uniqueIndex('customers_org_name_uq').on(t.organizationId, sql`lower(${t.name})`),
    index('customers_org_position_idx').on(t.organizationId, t.position),
  ],
);

export const customerContacts = pgTable(
  'customer_contacts',
  {
    id: id(),
    organizationId: organizationId(),
    customerId: uuid().notNull(),
    fullName: text().notNull(),
    email: text(),
    phone: text(),
    // The contact shown in the CRM table and on the account cards.
    isPrimary: boolean().notNull().default(false),
    position: integer().notNull(),
    ...timestamps(),
  },
  (t) => [
    tenantKey('customer_contacts', t),
    tenantFk('customer_contacts_customer_fk', t.organizationId, t.customerId, customers).onDelete('cascade'),
    uniqueIndex('customer_contacts_primary_uq')
      .on(t.organizationId, t.customerId)
      .where(sql`${t.isPrimary}`),
    index('customer_contacts_org_customer_idx').on(t.organizationId, t.customerId, t.position),
  ],
);
