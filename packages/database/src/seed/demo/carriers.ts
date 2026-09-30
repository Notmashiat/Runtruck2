import type { DbExecutor } from '../../client.js';
import { carriers } from '../../schema/carriers.js';
import { remember, type DemoRefs } from './refs.js';

// Carriers (§7.4, Runtruck1 CARRIERS): the own authority and the partner carriers.

interface CarrierSeed {
  name: string;
  mcNumber: string;
  dotNumber: string;
  isOwnFleet: boolean;
}

// In position order; the own authority is position 1. Stored without " (own fleet)" and
// with digits-only MC/DOT numbers (§5.2.1).
export const DEMO_CARRIERS: readonly CarrierSeed[] = [
  { name: 'Sunridge Freight', mcNumber: '812044', dotNumber: '2291176', isOwnFleet: true },
  { name: 'Valley Line Transport', mcNumber: '604117', dotNumber: '1780342', isOwnFleet: false },
  { name: 'Cascade Reefer Express', mcNumber: '733905', dotNumber: '2014588', isOwnFleet: false },
  { name: 'High Desert Hauling', mcNumber: '581230', dotNumber: '1655901', isOwnFleet: false },
  { name: 'Golden State Flatbed', mcNumber: '690452', dotNumber: '1893027', isOwnFleet: false },
];

export const OWN_FLEET_CARRIER = 'Sunridge Freight';

export async function seedCarriers(db: DbExecutor, refs: DemoRefs): Promise<void> {
  const { organizationId } = refs;
  const inserted = await db
    .insert(carriers)
    .values(DEMO_CARRIERS.map((c, i) => ({ organizationId, ...c, position: i + 1 })))
    .returning({ key: carriers.name, id: carriers.id });
  remember(refs.carriers, inserted);
}
