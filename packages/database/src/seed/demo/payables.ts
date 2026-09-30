import type { DbExecutor } from '../../client.js';
import { bills, vendors } from '../../schema/payables.js';
import { day, must, remember, type DemoRefs } from './refs.js';

// Payables (§7.17): Runtruck1 BILLS, one vendor per bill named as Runtruck1's vendor.

type Bill = typeof bills.$inferInsert;

type BillSeed = Pick<Bill, 'category' | 'dueOn' | 'amountCents' | 'status'> & {
  vendor: string;
  description?: string;
};

// Runtruck1 order (also the due-date order).
export const DEMO_BILLS: readonly BillSeed[] = [
  { vendor: 'Verizon Connect ELD', category: 'Telematics', dueOn: day('08-28'), amountCents: 48_600, status: 'overdue' },
  { vendor: 'Modesto Yard — Lease', category: 'Facilities', dueOn: day('09-01'), amountCents: 390_000, status: 'paid' },
  { vendor: 'Comdata', category: 'Fuel card fees', dueOn: day('09-02'), amountCents: 21_500, status: 'paid' },
  { vendor: 'Bridgestone Commercial', category: 'Tires', dueOn: day('09-04'), amountCents: 238_000, status: 'due' },
  { vendor: 'Pilot Flying J', category: 'Fuel', dueOn: day('09-05'), amountCents: 864_000, status: 'due' },
  { vendor: 'Valley Diesel & Turbo', category: 'Parts', description: 'T-118 turbo', dueOn: day('09-08'), amountCents: 398_000, status: 'due' },
  { vendor: 'Great West Casualty', category: 'Insurance', dueOn: day('09-10'), amountCents: 621_000, status: 'scheduled' },
  { vendor: 'Ryder Trailer Lease', category: 'Equipment lease', dueOn: day('09-15'), amountCents: 415_000, status: 'scheduled' },
];

export async function seedPayables(db: DbExecutor, refs: DemoRefs): Promise<void> {
  const { organizationId } = refs;
  const inserted = await db
    .insert(vendors)
    .values(DEMO_BILLS.map((b) => ({ organizationId, name: b.vendor })))
    .returning({ key: vendors.name, id: vendors.id });
  const vendorIds = new Map<string, string>();
  remember(vendorIds, inserted);

  await db.insert(bills).values(
    DEMO_BILLS.map((b) => ({
      organizationId,
      vendorId: must(vendorIds, b.vendor, 'vendor'),
      category: b.category,
      description: b.description ?? null,
      dueOn: b.dueOn,
      amountCents: b.amountCents,
      status: b.status,
      // Scheduled bills auto-pay on their due date (§7.17); paid bills were paid on it (C4).
      scheduledOn: b.status === 'scheduled' ? b.dueOn : null,
      paidOn: b.status === 'paid' ? b.dueOn : null,
    })),
  );
}
