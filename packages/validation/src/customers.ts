import { z } from 'zod';
import { pageQuerySchema } from './common.js';

// Customers (CRM) input schemas — specified in docs/api/customers.md.

// GET /customers — limit, offset, q.
export const customerListQuerySchema = pageQuerySchema;

export type CustomerListQuery = z.output<typeof customerListQuerySchema>;

// GET /customers/options — New Load's select list (docs/api/customers.md §2.8). The web
// requests every option at once, so the default page is the ceiling; `q` matches the name.
export const customerOptionsQuerySchema = pageQuerySchema.extend({
  limit: z.coerce.number().int().min(1).max(500).default(500),
});

export type CustomerOptionsQuery = z.output<typeof customerOptionsQuerySchema>;
