import type { DbExecutor } from '../../client.js';
import { customerContacts, customers } from '../../schema/customers.js';
import { must, remember, type DemoRefs } from './refs.js';

// Customers with their primary contact (§7.3, Runtruck1 CUSTOMERS + TOP_ACCOUNTS).
// Runtruck1's loads, revenue, onTime and ar are computed by the API (§6.5), never stored.

type Standing = (typeof customers.$inferInsert)['standing'];
type Terms = (typeof customers.$inferInsert)['paymentTerms'];

interface CustomerSeed {
  name: string;
  standing: Standing;
  paymentTerms: Terms;
  contact: string;
  email: string | null;
}

// In position order (1-based).
export const DEMO_CUSTOMERS: readonly CustomerSeed[] = [
  { name: 'Northgate Foods', standing: 'key_account', paymentTerms: 'net_30', contact: 'Dana Ruiz', email: 'dana@northgate.com' },
  { name: 'Bayline Distribution', standing: 'key_account', paymentTerms: 'net_30', contact: 'Owen Petrakis', email: 'ops@bayline.co' },
  { name: 'Cascade Building Supply', standing: 'growing', paymentTerms: 'net_45', contact: 'Marta Lind', email: null },
  { name: 'Harbor Point Retail', standing: 'growing', paymentTerms: 'net_30', contact: 'Jules Amari', email: null },
  { name: 'Sierra Ag Partners', standing: 'at_risk', paymentTerms: 'net_60', contact: 'Ben Okafor', email: 'ben@sierraag.com' },
  { name: 'Vantage Home Goods', standing: 'growing', paymentTerms: 'net_30', contact: 'Iris Chen', email: null },
];

// The customer's default terms, copied onto its seeded loads and invoices (§7.12–§7.15).
export function customerTerms(name: string): Terms {
  const customer = DEMO_CUSTOMERS.find((c) => c.name === name);
  if (!customer) throw new Error(`demo seed: unknown customer "${name}"`);
  return customer.paymentTerms;
}

export async function seedCustomers(db: DbExecutor, refs: DemoRefs): Promise<void> {
  const { organizationId } = refs;
  const inserted = await db
    .insert(customers)
    .values(DEMO_CUSTOMERS.map((c, i) => ({ organizationId, name: c.name, standing: c.standing, paymentTerms: c.paymentTerms, position: i + 1 })))
    .returning({ key: customers.name, id: customers.id });
  remember(refs.customers, inserted);

  // One primary contact per customer, position 1, no phone (§7.3).
  await db.insert(customerContacts).values(
    DEMO_CUSTOMERS.map((c) => ({
      organizationId,
      customerId: must(refs.customers, c.name, 'customer'),
      fullName: c.contact,
      email: c.email,
      isPrimary: true,
      position: 1,
    })),
  );
}
