// The top-bar search box filters whichever table is on screen: a row matches
// when any of its string or number fields contains the query (Runtruck1
// lib/search.ts, reproduced exactly). tagClass-like presentation keys are skipped.
export function matchesQuery(row: object, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return Object.entries(row).some(
    ([key, v]) => key !== 'tagClass' && key !== 'tone' && (typeof v === 'string' || typeof v === 'number') && String(v).toLowerCase().includes(q),
  );
}
