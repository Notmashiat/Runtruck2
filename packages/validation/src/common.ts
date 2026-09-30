import { z } from 'zod';

// Zod without its JIT, set before any schema of this package is built: index.ts evaluates
// this module first. It must precede the first object schema, when zod decides. The JIT compiles
// object parsers with `new Function`, and zod probes for it when it builds the first object
// schema: under the web's Content-Security-Policy, which has no 'unsafe-eval' (docs/01 C79),
// the browser reports that probe as a violation on every page load even though zod catches
// it. Parsing results are the same with or without the JIT.
z.config({ jitless: true });

export const uuidSchema = z.uuid();

// A lone UTF-16 surrogate (one half of a pair). It is not Unicode text: PostgreSQL's jsonb
// refuses it (a 500) and its text columns silently store U+FFFD instead.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

export const UNSTORABLE_TEXT_MESSAGE = 'Remove the unsupported characters (NUL or an incomplete character).';

// True when PostgreSQL can store the string as sent: no U+0000 (text and jsonb refuse it)
// and well-formed UTF-16 (no lone surrogate).
export function isStorableText(value: string): boolean {
  return !value.includes('\u0000') && !LONE_SURROGATE.test(value);
}

// The base of every free-text input (architecture §16; docs/04-api.md §3): a string the
// database can store, so NUL or a lone surrogate is a 400 VALIDATION_ERROR, never a 500
// or a silently altered value. Chain trim/max/… after it.
export function storableTextSchema() {
  return z.string().refine(isStorableText, UNSTORABLE_TEXT_MESSAGE);
}

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
  q: storableTextSchema().trim().max(200).optional(),
});

export type PageQuery = z.output<typeof pageQuerySchema>;
