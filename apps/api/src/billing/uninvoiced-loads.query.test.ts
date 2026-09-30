import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { uninvoicedLoadPredicate } from './uninvoiced-loads.query.js';

// The shared uninvoiced rule (03 §6.0.4) the Dashboard's "Unbilled loads" reuses.
describe('uninvoicedLoadPredicate', () => {
  const dialect = new PgDialect();

  it('selects delivered-status loads that no invoice item references, tenant-correlated', () => {
    const { sql: text, params } = dialect.sqlToQuery(uninvoicedLoadPredicate('ld'));
    expect(text).toContain("ld.status IN ('needs_pod', 'delivered')");
    expect(text).toContain('NOT EXISTS (SELECT 1 FROM invoice_items ii WHERE ii.organization_id = ld.organization_id AND ii.load_id = ld.id)');
    expect(params).toEqual([]);
  });

  it('refuses anything but a plain identifier as the alias', () => {
    expect(() => uninvoicedLoadPredicate('l; drop table loads')).toThrow();
    expect(() => uninvoicedLoadPredicate('L')).toThrow();
  });
});
