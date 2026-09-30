import { z } from 'zod';
import { pageQuerySchema } from './common.js';

// Billing (receivables) input schemas — specified in docs/api/billing.md.

export const invoiceStatusSchema = z.enum(['draft', 'sent', 'overdue', 'paid']);

// GET /billing/uninvoiced-loads — limit/offset/q only.
export const listUninvoicedLoadsQuerySchema = pageQuerySchema;

export type ListUninvoicedLoadsQuery = z.output<typeof listUninvoicedLoadsQuerySchema>;

// GET /invoices?status=… — one status per request; the status decides the
// row order and the shape of meta.summary.
export const listInvoicesQuerySchema = pageQuerySchema.extend({
  status: invoiceStatusSchema,
});

export type ListInvoicesQuery = z.output<typeof listInvoicesQuerySchema>;

// GET /invoice-batches — limit/offset/q only.
export const listInvoiceBatchesQuerySchema = pageQuerySchema;

export type ListInvoiceBatchesQuery = z.output<typeof listInvoiceBatchesQuerySchema>;
