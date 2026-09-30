// Shared helpers for the demo seed modules (docs/03-database.md §7).

// The demo organization's zone (§7.1). Stops without a facility (fuel) use it (§7).
export const ORG_TIMEZONE = 'America/Los_Angeles';

// Midnight of the demo day (2026-09-03) in the organization, as a UTC instant:
// the archive instant of every archived load (§7.13, §7.14).
export const DEMO_DAY_START_UTC = new Date('2026-09-03T07:00:00Z');

// Ids of the rows already inserted, by their Runtruck1 natural key, so later
// domains can reference them. Every lookup goes through `must`.
export interface DemoRefs {
  organizationId: string;
  adminUserId: string;
  customers: Map<string, string>;
  carriers: Map<string, string>;
  facilities: Map<string, string>;
  employees: Map<string, string>;
  drivers: Map<string, string>;
  trucks: Map<string, string>;
  trailers: Map<string, string>;
  loads: Map<number, string>;
  invoices: Map<number, string>;
  factoringCompanies: Map<string, string>;
}

export function emptyRefs(organizationId: string, adminUserId: string): DemoRefs {
  return {
    organizationId,
    adminUserId,
    customers: new Map(),
    carriers: new Map(),
    facilities: new Map(),
    employees: new Map(),
    drivers: new Map(),
    trucks: new Map(),
    trailers: new Map(),
    loads: new Map(),
    invoices: new Map(),
    factoringCompanies: new Map(),
  };
}

// Looks a key up and fails loudly: a missing reference is a bug in the seed data.
export function must<K, V>(map: Map<K, V>, key: K, what: string): V {
  const value = map.get(key);
  if (value === undefined) throw new Error(`demo seed: unknown ${what} "${String(key)}"`);
  return value;
}

// Adds the returned rows of a multi-row insert to a lookup map.
export function remember<K, V>(map: Map<K, V>, rows: readonly { key: K; id: V }[]): void {
  for (const row of rows) map.set(row.key, row.id);
}

// '09-03' → '2026-09-03'. Dates in the seed mapping are 2026 unless written in full (§7).
export const day = (monthDay: string): string => `2026-${monthDay}`;
