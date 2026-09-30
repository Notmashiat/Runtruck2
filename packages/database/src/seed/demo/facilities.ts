import type { DbExecutor } from '../../client.js';
import { facilities } from '../../schema/facilities.js';
import { ORG_TIMEZONE, remember, type DemoRefs } from './refs.js';

// Facilities (§7.5): the places named by Runtruck1's LOADS addresses, the trailer
// yard, the MAINTENANCE shops and the CLAIMS claimant. No postal codes (Runtruck1 has none).

type Kind = (typeof facilities.$inferInsert)['kind'];

export interface FacilitySeed {
  name: string;
  kind: Kind;
  addressLine1: string | null;
  city: string;
  state: string;
  timezone: string;
  marketCity?: string;
  marketState?: string;
  marketShort?: string;
}

const LA = ORG_TIMEZONE;

export const DEMO_FACILITIES: readonly FacilitySeed[] = [
  { name: 'Northgate Cold Storage', kind: 'shipper', addressLine1: '4120 S Golden State Blvd', city: 'Fresno', state: 'CA', timezone: LA },
  { name: 'Reno Grocers DC', kind: 'consignee', addressLine1: '1855 E Greg St', city: 'Sparks', state: 'NV', timezone: LA, marketCity: 'Reno', marketState: 'NV' },
  { name: 'Bayline DC 4', kind: 'shipper', addressLine1: '2900 Navy Dr', city: 'Stockton', state: 'CA', timezone: LA },
  { name: 'Wasatch Crossdock', kind: 'crossdock', addressLine1: '1740 S 4130 W', city: 'Salt Lake City', state: 'UT', timezone: 'America/Denver', marketShort: 'SLC' },
  { name: 'Cascade Yard 2', kind: 'shipper', addressLine1: '8300 Elder Creek Rd', city: 'Sacramento', state: 'CA', timezone: LA },
  { name: 'Boise Builders Depot', kind: 'consignee', addressLine1: '440 E Corporate Dr', city: 'Meridian', state: 'ID', timezone: 'America/Boise', marketCity: 'Boise', marketState: 'ID' },
  { name: 'Port of Oakland, Berth 22', kind: 'port', addressLine1: '1599 Maritime St', city: 'Oakland', state: 'CA', timezone: LA },
  { name: 'Harbor Point DC', kind: 'consignee', addressLine1: '6200 N Basin Ave', city: 'Portland', state: 'OR', timezone: LA },
  { name: 'Northgate Creamery', kind: 'shipper', addressLine1: '3011 Buck Owens Blvd', city: 'Bakersfield', state: 'CA', timezone: LA },
  { name: 'Valley Foods DC', kind: 'consignee', addressLine1: '2240 W Buckeye Rd', city: 'Phoenix', state: 'AZ', timezone: 'America/Phoenix' },
  { name: 'Bayline LA Annex', kind: 'shipper', addressLine1: '5200 S Boyle Ave', city: 'Vernon', state: 'CA', timezone: LA, marketCity: 'Los Angeles', marketState: 'CA' },
  { name: 'Sunset Beverage DC', kind: 'consignee', addressLine1: '3900 W Cheyenne Ave', city: 'North Las Vegas', state: 'NV', timezone: LA, marketCity: 'Las Vegas', marketState: 'NV' },
  { name: 'Sierra Ag Huller 3', kind: 'shipper', addressLine1: '1901 Crows Landing Rd', city: 'Modesto', state: 'CA', timezone: LA },
  { name: 'Front Range Foods', kind: 'consignee', addressLine1: '5400 Havana St', city: 'Denver', state: 'CO', timezone: 'America/Denver' },
  { name: 'Cascade Mill', kind: 'shipper', addressLine1: '3400 Airport Rd', city: 'Redding', state: 'CA', timezone: LA },
  { name: 'Duwamish Steel Yard', kind: 'consignee', addressLine1: '8100 E Marginal Way S', city: 'Seattle', state: 'WA', timezone: LA },
  { name: 'Sunridge yard', kind: 'yard', addressLine1: null, city: 'Modesto', state: 'CA', timezone: LA },
  { name: 'Sunridge shop', kind: 'shop', addressLine1: null, city: 'Modesto', state: 'CA', timezone: LA },
  { name: 'Thermo King', kind: 'shop', addressLine1: null, city: 'Fresno', state: 'CA', timezone: LA },
  { name: 'Valley Truck Center', kind: 'shop', addressLine1: null, city: 'Stockton', state: 'CA', timezone: LA },
];

export function demoFacility(name: string): FacilitySeed {
  const facility = DEMO_FACILITIES.find((f) => f.name === name);
  if (!facility) throw new Error(`demo seed: unknown facility "${name}"`);
  return facility;
}

export async function seedFacilities(db: DbExecutor, refs: DemoRefs): Promise<void> {
  const { organizationId } = refs;
  const inserted = await db
    .insert(facilities)
    .values(
      DEMO_FACILITIES.map((f) => ({
        organizationId,
        name: f.name,
        kind: f.kind,
        addressLine1: f.addressLine1,
        city: f.city,
        state: f.state,
        postalCode: null,
        timezone: f.timezone,
        marketCity: f.marketCity ?? null,
        marketState: f.marketState ?? null,
        marketShort: f.marketShort ?? null,
      })),
    )
    .returning({ key: facilities.name, id: facilities.id });
  remember(refs.facilities, inserted);
}
