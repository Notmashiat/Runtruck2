// List evaluation shared by every list endpoint (docs/04-api.md §5.1). Pure, so it is
// unit-tested.
//
// - Without `q` a list pages in SQL, or (reference-size lists) reads every row of the
//   organization, summarizes them and pages in memory.
// - With `q` the service reads at most the first Q_SCAN_LIMIT rows of the list's filter in
//   list order, builds each row's view row with the same @runtruck/calculations builder
//   the web uses, keeps the matches and slices them in memory, so server search matches
//   exactly what the web's search shows.

// At most this many rows (in list order) are matched against `q` (04 §5.1 Q_SCAN_LIMIT).
export const Q_SCAN_LIMIT = 5000;

export interface PageParams {
  q?: string | undefined;
  limit: number;
  offset: number;
}

export interface InMemoryPage<T> {
  page: T[];
  // Rows after `q`, before offset/limit.
  total: number;
}

export interface ListPage<T> {
  rows: T[];
  // Rows after `q`, before offset/limit.
  total: number;
}

// Runtruck1's matchesQuery (apps/web/src/lib/search.ts): a trimmed, lower-cased needle;
// an empty needle matches everything; otherwise any string or number value (never an
// object such as `ref`, never a boolean such as `docsPending`, never the presentation keys
// tagClass/tone) must contain it.
export function matchesQuery(row: object, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return Object.entries(row).some(
    ([key, v]) =>
      key !== 'tagClass' && key !== 'tone' && (typeof v === 'string' || typeof v === 'number') && String(v).toLowerCase().includes(q),
  );
}

// The trimmed search text, or undefined when there is none (then the list pages in SQL).
export function searchText(q: string | undefined): string | undefined {
  const trimmed = q?.trim();
  return trimmed ? trimmed : undefined;
}

// Applies `q` over the view-model row of each item, then pages. Without `q` every row
// counts; with it only the first Q_SCAN_LIMIT rows are searched and `total` counts the
// matches among them.
export function pageInMemory<T>(rows: readonly T[], params: PageParams, toSearchRow: (row: T) => object): InMemoryPage<T> {
  const needle = searchText(params.q);
  const matched = needle ? rows.slice(0, Q_SCAN_LIMIT).filter((row) => matchesQuery(toSearchRow(row), needle)) : [...rows];
  return { page: matched.slice(params.offset, params.offset + params.limit), total: matched.length };
}

// Filters already-fetched rows (≤ Q_SCAN_LIMIT, in list order) by their view rows and pages them.
export function searchRows<T>(rows: readonly T[], toView: (row: T) => object, q: string, limit: number, offset: number): ListPage<T> {
  const matched = rows.filter((row) => matchesQuery(toView(row), q));
  return { rows: matched.slice(offset, offset + limit), total: matched.length };
}

// bigint/numeric aggregates arrive from node-postgres as strings; cents stay far below 2^53.
export function toNumber(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new Error('Aggregate out of the safe integer range');
  return n;
}
