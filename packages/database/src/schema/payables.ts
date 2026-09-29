import { sql } from 'drizzle-orm';
import { check, date, index, integer, pgEnum, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { id, timestamps } from './_columns.js';
import { tenantFk, tenantKey } from './_tenant.js';
import { organizationId } from './platform.js';

// Payables: vendors and their bills. Specified in docs/03-database.md §5.9.

// Runtruck1: Due / Overdue / Scheduled / Paid (stored, design brief §2).
export const billStatus = pgEnum('bill_status', ['due', 'overdue', 'scheduled', 'paid']);

export const vendors = pgTable(
  'vendors',
  {
    id: id(),
    organizationId: organizationId(),
    name: text().notNull(),
    ...timestamps(),
  },
  (t) => [tenantKey('vendors', t), uniqueIndex('vendors_org_name_uq').on(t.organizationId, sql`lower(${t.name})`)],
);

export const bills = pgTable(
  'bills',
  {
    id: id(),
    organizationId: organizationId(),
    vendorId: uuid().notNull(),
    // "Telematics", "Parts", …; the Category column shows "<category> · <description>" when a description is set.
    category: text().notNull(),
    description: text(),
    dueOn: date({ mode: 'string' }).notNull(),
    amountCents: integer().notNull(),
    status: billStatus().notNull(),
    // Auto-pay date of a scheduled bill.
    scheduledOn: date({ mode: 'string' }),
    paidOn: date({ mode: 'string' }),
    ...timestamps(),
  },
  (t) => [
    tenantKey('bills', t),
    tenantFk('bills_vendor_fk', t.organizationId, t.vendorId, vendors).onDelete('restrict'),
    index('bills_org_due_idx').on(t.organizationId, t.dueOn),
    index('bills_org_status_idx').on(t.organizationId, t.status),
    check('bills_amount_ck', sql`${t.amountCents} > 0`),
    check('bills_paid_ck', sql`(${t.status} = 'paid') = (${t.paidOn} is not null)`),
    check('bills_scheduled_ck', sql`${t.status} <> 'scheduled' or ${t.scheduledOn} is not null`),
  ],
);
