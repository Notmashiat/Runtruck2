import { z } from 'zod';

export const uuidSchema = z.uuid();

export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date.');

// HH:MM, 24-hour.
export const timeOfDaySchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a HH:MM time.');

// Pagination for list endpoints (architecture §37). Hard ceiling keeps a single
// request from pulling an unbounded result set.
export const pageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
  q: z.string().trim().max(200).optional(),
});

export type PageQuery = z.output<typeof pageQuerySchema>;
