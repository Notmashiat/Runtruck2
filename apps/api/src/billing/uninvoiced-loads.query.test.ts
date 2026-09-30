import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { uninvoicedLoadPredicate } from './uninvoiced-loads.query.js';

// The shared uninvoiced rule (03 §6.0.4) the Dashboard's "Unbilled loads" reuses.
describe('uninvoicedLoadPredicate', () => {
  const dialect = new PgDialect();

  it('selects delivered-status loads not yet on an invoice, via the trigger-maintained marker', () => {
    const { sql: text, params } = dialect.sqlToQuery(uninvoicedLoadPredicate('ld'));
    // loads.invoiced_at mirrors "an invoice item references the load" (migration 0006, 01 C86);
    // its trigger behaviour is proven in test/uninvoiced-marker.int.test.ts.
    expect(text).toBe("ld.invoiced_at IS NULL AND ld.status IN ('needs_pod', 'delivered')");
    expect(text).not.toContain('invoice_items');
    expect(params).toEqual([]);
  });

  it('refuses anything but a plain identifier as the alias', () => {
    expect(() => uninvoicedLoadPredicate('l; drop table loads')).toThrow();
    expect(() => uninvoicedLoadPredicate('L')).toThrow();
  });
});
