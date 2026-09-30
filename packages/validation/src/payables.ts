import { z } from 'zod';
import { pageQuerySchema } from './common.js';

// Payables (vendor bills) input schemas — specified in docs/api/payables.md.

export const billStatusSchema = z.enum(['due', 'overdue', 'scheduled', 'paid']);

// GET /bills — limit/offset/q only.
export const listBillsQuerySchema = pageQuerySchema;

export type ListBillsQuery = z.output<typeof listBillsQuerySchema>;
