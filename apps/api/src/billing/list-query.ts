// Accounting-only list helper (docs/api/billing.md §1). The list rules every endpoint
// shares (Q_SCAN_LIMIT, matchesQuery, searchRows, toNumber) live in common/list.

// First day of today's month and of the next month (YYYY-MM-DD), for "this month" figures.
export function monthRange(today: string): { start: string; next: string } {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const pad = (n: number) => String(n).padStart(2, '0');
  return { start: `${year}-${pad(month)}-01`, next: `${String(nextYear).padStart(4, '0')}-${pad(nextMonth)}-01` };
}
