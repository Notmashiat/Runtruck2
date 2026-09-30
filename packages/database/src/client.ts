import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema/index.js';

export type Schema = typeof schema;
export type Database = NodePgDatabase<Schema>;
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
// Repositories accept either, so the same code runs inside or outside a transaction.
export type DbExecutor = Database | Transaction;

export interface DatabaseHandle {
  db: Database;
  pool: pg.Pool;
  close: () => Promise<void>;
}

export interface CreateDatabaseOptions {
  // Connection-pool ceiling per process (architecture §37 connection pooling).
  max?: number;
  applicationName?: string;
  // Server-side idle_in_transaction_session_timeout for this pool's sessions: a transaction
  // left open without activity longer than this is ended by PostgreSQL, releasing its locks
  // and the vacuum horizon. The API and worker set it; unset = the server default (off).
  idleInTransactionTimeoutMs?: number;
}

// Session settings of every connection (docs/03-database.md §9.3). JIT compilation is off:
// Runtruck's statements are short OLTP reads whose estimated cost can still cross
// jit_above_cost, and LLVM compilation then costs more than the query itself.
const SESSION_OPTIONS = '-c jit=off';

export function createDatabase(connectionString: string, options: CreateDatabaseOptions = {}): DatabaseHandle {
  const pool = new pg.Pool({
    connectionString,
    max: options.max ?? 10,
    application_name: options.applicationName ?? 'runtruck',
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    options: SESSION_OPTIONS,
    ...(options.idleInTransactionTimeoutMs === undefined
      ? {}
      : { idle_in_transaction_session_timeout: options.idleInTransactionTimeoutMs }),
  });
  const db = drizzle({ client: pool, schema, casing: 'snake_case' });
  return { db, pool, close: () => pool.end() };
}
