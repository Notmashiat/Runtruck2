import { sql } from 'drizzle-orm';
import { timestamp, uuid } from 'drizzle-orm/pg-core';

// Shared column builders (architecture §8 UUID ids, §9 UTC timestamps).
// `timestamptz` stores an instant; Postgres always keeps it in UTC.

export const id = () =>
  uuid()
    .primaryKey()
    .default(sql`gen_random_uuid()`);

export const createdAt = () => timestamp({ withTimezone: true, mode: 'date' }).notNull().defaultNow();

export const updatedAt = () =>
  timestamp({ withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const timestamps = () => ({ createdAt: createdAt(), updatedAt: updatedAt() });
