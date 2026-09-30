import { sql } from 'drizzle-orm';
import { check, date, index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { id, timestamps } from './_columns.js';
import { tenantFk, tenantKey } from './_tenant.js';
import { customers, paymentTerms } from './customers.js';
import { loads } from './loads.js';
import { organizationId } from './platform.js';

// Receivables: invoices, their items, payments, factoring companies and invoice
// batches. Totals are always computed from items (D5). Specified in docs/03-database.md §5.8.

// Runtruck1: Draft / Sent / Overdue / Paid (stored, design brief §2).
export const invoiceStatus = pgEnum('invoice_status', ['draft', 'sent', 'overdue', 'paid']);

// Runtruck1: ACH / Check / Factoring.
export const paymentMethod = pgEnum('payment_method', ['ach', 'check', 'factoring']);

// Runtruck1: Ready / Sent / Settled.
export const invoiceBatchStatus = pgEnum('invoice_batch_status', ['ready', 'sent', 'settled']);

export const factoringCompanies = pgTable(
  'factoring_companies',
  {
    id: id(),
    organizationId: organizationId(),
    name: text().notNull(),
    ...timestamps(),
  },
  (t) => [tenantKey('factoring_companies', t), uniqueIndex('factoring_companies_org_name_uq').on(t.organizationId, sql`lower(${t.name})`)],
);

export const invoices = pgTable(
  'invoices',
  {
    id: id(),
    organizationId: organizationId(),
    // Human number, rendered "INV-8845". Allocated from organization_counters key 'invoice'.
    invoiceNumber: integer().notNull(),
    customerId: uuid().notNull(),
    status: invoiceStatus().notNull(),
    // Terms of this invoice (may differ from the customer's default).
    paymentTerms: paymentTerms().notNull(),
    // Null while draft.
    issuedOn: date({ mode: 'string' }),
    dueOn: date({ mode: 'string' }),
    ...timestamps(),
  },
  (t) => [
    tenantKey('invoices', t),
    tenantFk('invoices_customer_fk', t.organizationId, t.customerId, customers).onDelete('restrict'),
    uniqueIndex('invoices_org_number_uq').on(t.organizationId, t.invoiceNumber),
    index('invoices_org_status_issued_idx').on(t.organizationId, t.status, t.issuedOn),
    // Invoices issued in a date range, any status (CRM YTD candidates, customers.md §2.7).
    index('invoices_org_issued_idx').on(t.organizationId, t.issuedOn),
    index('invoices_org_customer_idx').on(t.organizationId, t.customerId),
    check('invoices_number_ck', sql`${t.invoiceNumber} > 0`),
    check('invoices_issued_ck', sql`(${t.status} = 'draft') = (${t.issuedOn} is null)`),
    check('invoices_due_ck', sql`(${t.issuedOn} is null) = (${t.dueOn} is null) and (${t.dueOn} is null or ${t.dueOn} >= ${t.issuedOn})`),
  ],
);

export const invoiceItems = pgTable(
  'invoice_items',
  {
    id: id(),
    organizationId: organizationId(),
    invoiceId: uuid().notNull(),
    position: integer().notNull(),
    // The invoiced load; the invoice's "Load" column is the load of item 1.
    loadId: uuid(),
    description: text().notNull(),
    amountCents: integer().notNull(),
    ...timestamps(),
  },
  (t) => [
    tenantKey('invoice_items', t),
    tenantFk('invoice_items_invoice_fk', t.organizationId, t.invoiceId, invoices).onDelete('cascade'),
    tenantFk('invoice_items_load_fk', t.organizationId, t.loadId, loads).onDelete('restrict'),
    uniqueIndex('invoice_items_invoice_position_uq').on(t.organizationId, t.invoiceId, t.position),
    index('invoice_items_org_load_idx').on(t.organizationId, t.loadId),
    check('invoice_items_amount_ck', sql`${t.amountCents} >= 0 and ${t.position} >= 1`),
  ],
);

export const payments = pgTable(
  'payments',
  {
    id: id(),
    organizationId: organizationId(),
    invoiceId: uuid().notNull(),
    // Instant the money was received; the Paid tab orders by it (desc).
    receivedAt: timestamp({ withTimezone: true, mode: 'date' }).notNull(),
    method: paymentMethod().notNull(),
    factoringCompanyId: uuid(),
    amountCents: integer().notNull(),
    reference: text(),
    ...timestamps(),
  },
  (t) => [
    tenantKey('payments', t),
    tenantFk('payments_invoice_fk', t.organizationId, t.invoiceId, invoices).onDelete('restrict'),
    tenantFk('payments_factoring_company_fk', t.organizationId, t.factoringCompanyId, factoringCompanies).onDelete('restrict'),
    index('payments_org_invoice_idx').on(t.organizationId, t.invoiceId),
    index('payments_org_received_idx').on(t.organizationId, t.receivedAt),
    check('payments_amount_ck', sql`${t.amountCents} > 0`),
    check('payments_factoring_ck', sql`(${t.method} = 'factoring') = (${t.factoringCompanyId} is not null)`),
  ],
);

export const invoiceBatches = pgTable(
  'invoice_batches',
  {
    id: id(),
    organizationId: organizationId(),
    // Human number, rendered "B-2035". Allocated from organization_counters key 'invoice_batch'.
    batchNumber: integer().notNull(),
    // Business day the batch was created ("Created" column).
    createdOn: date({ mode: 'string' }).notNull(),
    // Exactly one recipient: a customer, or a factoring company ("TriPoint Capital (factoring)").
    customerId: uuid(),
    factoringCompanyId: uuid(),
    status: invoiceBatchStatus().notNull(),
    ...timestamps(),
  },
  (t) => [
    tenantKey('invoice_batches', t),
    tenantFk('invoice_batches_customer_fk', t.organizationId, t.customerId, customers).onDelete('restrict'),
    tenantFk('invoice_batches_factoring_company_fk', t.organizationId, t.factoringCompanyId, factoringCompanies).onDelete('restrict'),
    uniqueIndex('invoice_batches_org_number_uq').on(t.organizationId, t.batchNumber),
    check('invoice_batches_number_ck', sql`${t.batchNumber} > 0`),
    check('invoice_batches_recipient_ck', sql`(${t.customerId} is null) <> (${t.factoringCompanyId} is null)`),
  ],
);

export const invoiceBatchItems = pgTable(
  'invoice_batch_items',
  {
    id: id(),
    organizationId: organizationId(),
    batchId: uuid().notNull(),
    invoiceId: uuid().notNull(),
    ...timestamps(),
  },
  (t) => [
    tenantKey('invoice_batch_items', t),
    tenantFk('invoice_batch_items_batch_fk', t.organizationId, t.batchId, invoiceBatches).onDelete('cascade'),
    tenantFk('invoice_batch_items_invoice_fk', t.organizationId, t.invoiceId, invoices).onDelete('restrict'),
    // An invoice belongs to at most one batch.
    uniqueIndex('invoice_batch_items_org_invoice_uq').on(t.organizationId, t.invoiceId),
    index('invoice_batch_items_org_batch_idx').on(t.organizationId, t.batchId),
  ],
);
