import { z } from 'zod';

export const uuidSchema = z.uuid();

// Earliest and latest business day any input may carry. z.iso.date() accepts every
// real calendar day from 0000-01-01, but PostgreSQL has no year 0 and rejects it with a
// 500; business dates of a TMS never fall outside these bounds (docs/04-api.md §6).
export const BUSINESS_DATE_MIN = '1900-01-01';
export const BUSINESS_DATE_MAX = '2999-12-31';

// A business day as YYYY-MM-DD: a real calendar date (2026-02-31 is refused) within
// BUSINESS_DATE_MIN … BUSINESS_DATE_MAX, so every accepted value is a valid `date`.
// Every date input (query, param or body) uses this schema.
export const businessDateSchema = z.iso
  .date({ error: 'Use a YYYY-MM-DD date.' })
  .refine((d) => d >= BUSINESS_DATE_MIN && d <= BUSINESS_DATE_MAX, 'Use a YYYY-MM-DD date.');

// Former name of the date rule, kept as an alias of businessDateSchema (it used to be a bare
// regex that accepted 2026-02-31); new code uses businessDateSchema.
export const isoDateSchema = businessDateSchema;

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
