import { describe, expect, it } from 'vitest';
import { matchesQuery, pageInMemory, Q_SCAN_LIMIT, searchRows, searchText, toNumber } from './list-query.js';

// Cases collected from the accounting, hr-safety and fleet-crm lists that share these helpers.
describe('matchesQuery (Runtruck1 lib/search.ts)', () => {
  const row = {
    name: 'Marcus Hale',
    miles: 2140,
    pay: '$1,326',
    tagClass: 'tag-accent',
    tone: 'blue',
    ref: { id: 'secret-id', dutyStatus: 'on_duty' },
  };

  it('matches trimmed, case-insensitive substrings of string and number values', () => {
    expect(matchesQuery(row, '  marcus ')).toBe(true);
    expect(matchesQuery(row, '2140')).toBe(true);
    expect(matchesQuery(row, '$1,3')).toBe(true);
    expect(matchesQuery(row, 'nobody')).toBe(false);
  });

  it('matches everything for an empty needle', () => {
    expect(matchesQuery(row, '')).toBe(true);
    expect(matchesQuery(row, '   ')).toBe(true);
  });

  it('never searches presentation keys or nested objects (ids, enums)', () => {
    expect(matchesQuery(row, 'tag-accent')).toBe(false);
    expect(matchesQuery(row, 'blue')).toBe(false);
    expect(matchesQuery(row, 'secret')).toBe(false);
    expect(matchesQuery(row, 'on_duty')).toBe(false);
  });
});

describe('pageInMemory', () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({ n: i, label: i % 2 ? 'odd' : 'even' }));
  const toRow = (r: { label: string }) => ({ label: r.label });

  it('pages all rows without q', () => {
    expect(pageInMemory(rows, { limit: 3, offset: 2 }, toRow)).toEqual({ page: rows.slice(2, 5), total: 10 });
    expect(pageInMemory(rows, { q: '', limit: 100, offset: 0 }, toRow).total).toBe(10);
  });

  it('filters by q through the search row, then counts and slices the matches', () => {
    const result = pageInMemory(rows, { q: 'ODD', limit: 2, offset: 1 }, toRow);
    expect(result.total).toBe(5);
    expect(result.page.map((r) => r.n)).toEqual([3, 5]);
  });

  it('returns an empty page past the end but keeps the total', () => {
    expect(pageInMemory(rows, { limit: 5, offset: 50 }, toRow)).toEqual({ page: [], total: 10 });
  });

  it('matches only the first Q_SCAN_LIMIT rows', () => {
    const many = Array.from({ length: Q_SCAN_LIMIT + 3 }, () => ({ label: 'x' }));
    expect(pageInMemory(many, { q: 'x', limit: 1, offset: 0 }, toRow).total).toBe(Q_SCAN_LIMIT);
    expect(pageInMemory(many, { limit: 1, offset: 0 }, toRow).total).toBe(Q_SCAN_LIMIT + 3);
  });
});

describe('matchesQuery', () => {
  const row = { unit: 'T-118', estimate: 4850, docsPending: true, ref: { id: 'abc', tone: 'amber' } };

  it('matches string and number values case-insensitively after trimming', () => {
    expect(matchesQuery(row, '  t-118 ')).toBe(true);
    expect(matchesQuery(row, '4850')).toBe(true);
    expect(matchesQuery(row, '')).toBe(true);
  });

  it('never searches objects, booleans or presentation keys', () => {
    expect(matchesQuery(row, 'abc')).toBe(false);
    expect(matchesQuery(row, 'amber')).toBe(false);
    expect(matchesQuery(row, 'true')).toBe(false);
    expect(matchesQuery({ tagClass: 'tag-green', tone: 'green' }, 'green')).toBe(false);
  });
});

describe('pageInMemory', () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({ n: i }));
  const view = (r: { n: number }) => ({ label: `row ${r.n}` });

  it('pages every row without q', () => {
    expect(pageInMemory(rows, { limit: 3, offset: 2 }, view)).toEqual({ page: [{ n: 2 }, { n: 3 }, { n: 4 }], total: 10 });
    expect(pageInMemory(rows, { q: '   ', limit: 3, offset: 20 }, view)).toEqual({ page: [], total: 10 });
  });

  it('filters by the view row with q and counts the matches', () => {
    expect(pageInMemory(rows, { q: 'ROW 1', limit: 5, offset: 0 }, view)).toEqual({ page: [{ n: 1 }], total: 1 });
  });

  it('searches only the first Q_SCAN_LIMIT rows', () => {
    const many = Array.from({ length: Q_SCAN_LIMIT + 1 }, (_, i) => ({ n: i }));
    expect(pageInMemory(many, { q: `row ${Q_SCAN_LIMIT}`, limit: 5, offset: 0 }, view).total).toBe(0);
  });
});

describe('helpers', () => {
  it('trims search text and converts aggregates', () => {
    expect(searchText('  x ')).toBe('x');
    expect(searchText('   ')).toBeUndefined();
    expect(searchText(undefined)).toBeUndefined();
    expect(toNumber('711500')).toBe(711500);
    expect(toNumber(null)).toBe(0);
    expect(() => toNumber('9007199254740993')).toThrow();
  });
});

describe('matchesQuery (Runtruck1 lib/search.ts)', () => {
  const row = { id: 'INV-8823', amount: '$3,180', days: 29, tone: 'gray', tagClass: 'tag-green' };

  it('matches any string or number field, case-insensitively, trimmed', () => {
    expect(matchesQuery(row, '  inv-88 ')).toBe(true);
    expect(matchesQuery(row, '$3,1')).toBe(true);
    expect(matchesQuery(row, '29')).toBe(true);
    expect(matchesQuery(row, '')).toBe(true);
    expect(matchesQuery(row, 'zzz')).toBe(false);
  });

  it('skips presentation keys', () => {
    expect(matchesQuery(row, 'gray')).toBe(false);
    expect(matchesQuery(row, 'tag-green')).toBe(false);
  });
});

describe('searchRows', () => {
  const rows = [1, 2, 3, 11, 12].map((n) => ({ n }));
  it('counts matches before paging and keeps list order', () => {
    expect(searchRows(rows, (r) => ({ v: String(r.n) }), '1', 2, 1)).toEqual({ rows: [{ n: 11 }, { n: 12 }], total: 3 });
    expect(searchRows(rows, (r) => ({ v: String(r.n) }), '9', 10, 0)).toEqual({ rows: [], total: 0 });
  });
});

describe('helpers', () => {
  it('searchText treats blank as absent', () => {
    expect(searchText(undefined)).toBeUndefined();
    expect(searchText('   ')).toBeUndefined();
    expect(searchText(' sierra ')).toBe('sierra');
  });

  it('toNumber converts bigint strings and refuses unsafe values', () => {
    expect(toNumber('3490000')).toBe(3_490_000);
    expect(toNumber(null)).toBe(0);
    expect(toNumber(-51_200)).toBe(-51_200);
    expect(() => toNumber('9007199254740993')).toThrow();
  });
});
