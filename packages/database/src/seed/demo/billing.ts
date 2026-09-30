import { addDaysIso } from '@runtruck/calculations';
import type { DbExecutor } from '../../client.js';
import { factoringCompanies, invoiceBatches, invoiceBatchItems, invoiceItems, invoices, payments } from '../../schema/billing.js';
import { customerTerms } from './customers.js';
import { day, must, remember, type DemoRefs } from './refs.js';

// Receivables (§7.15, §7.16): Runtruck1 INVOICES + INVOICES_EXTRA, PAYMENTS and BATCHES.
// Totals are never stored: each invoice has one "Line haul" item carrying its amount.

type Invoice = typeof invoices.$inferInsert;
type Terms = Invoice['paymentTerms'];
type Method = (typeof payments.$inferInsert)['method'];
type BatchStatus = (typeof invoiceBatches.$inferInsert)['status'];

export const FACTORING_COMPANY = 'TriPoint Capital';

interface InvoiceSeed {
  invoiceNumber: number;
  customer: string;
  loadNumber: number;
  status: Invoice['status'];
  issuedOn: string | null;
  amountCents: number;
  // Only when the invoice's terms differ from the customer's (C6: INV-8836).
  paymentTerms?: Terms;
}

// Runtruck1 order: INVOICES, then INVOICES_EXTRA.
export const DEMO_INVOICES: readonly InvoiceSeed[] = [
  { invoiceNumber: 8845, customer: 'Northgate Foods', loadNumber: 40218, status: 'draft', issuedOn: null, amountCents: 245_000 },
  { invoiceNumber: 8841, customer: 'Northgate Foods', loadNumber: 40214, status: 'sent', issuedOn: day('09-01'), amountCents: 198_000 },
  { invoiceNumber: 8840, customer: 'Bayline Distribution', loadNumber: 40212, status: 'sent', issuedOn: day('08-31'), amountCents: 164_000 },
  { invoiceNumber: 8829, customer: 'Cascade Building Supply', loadNumber: 40198, status: 'sent', issuedOn: day('08-16'), amountCents: 288_000 },
  { invoiceNumber: 8824, customer: 'Harbor Point Retail', loadNumber: 40191, status: 'paid', issuedOn: day('08-07'), amountCents: 341_000 },
  { invoiceNumber: 8836, customer: 'Sierra Ag Partners', loadNumber: 40210, status: 'overdue', issuedOn: day('07-24'), amountCents: 412_000, paymentTerms: 'net_30' },
  { invoiceNumber: 8844, customer: 'Vantage Home Goods', loadNumber: 40197, status: 'sent', issuedOn: day('09-02'), amountCents: 226_000 },
  { invoiceNumber: 8842, customer: 'Cascade Building Supply', loadNumber: 40196, status: 'sent', issuedOn: day('09-01'), amountCents: 276_000 },
  { invoiceNumber: 8839, customer: 'Sierra Ag Partners', loadNumber: 40190, status: 'paid', issuedOn: day('08-29'), amountCents: 305_000 },
  { invoiceNumber: 8838, customer: 'Vantage Home Goods', loadNumber: 40189, status: 'paid', issuedOn: day('08-28'), amountCents: 189_000 },
  { invoiceNumber: 8830, customer: 'Northgate Foods', loadNumber: 40187, status: 'paid', issuedOn: day('08-18'), amountCents: 245_000 },
  { invoiceNumber: 8823, customer: 'Bayline Distribution', loadNumber: 40183, status: 'paid', issuedOn: day('08-05'), amountCents: 318_000 },
  { invoiceNumber: 8821, customer: 'Harbor Point Retail', loadNumber: 40178, status: 'overdue', issuedOn: day('07-29'), amountCents: 218_000 },
  { invoiceNumber: 8819, customer: 'Cascade Building Supply', loadNumber: 40176, status: 'overdue', issuedOn: day('07-15'), amountCents: 291_000 },
  { invoiceNumber: 8815, customer: 'Vantage Home Goods', loadNumber: 40172, status: 'overdue', issuedOn: day('07-02'), amountCents: 159_000 },
  { invoiceNumber: 8811, customer: 'Sierra Ag Partners', loadNumber: 40168, status: 'overdue', issuedOn: day('06-28'), amountCents: 386_000 },
];

// §6.0.7 net days.
export const NET_DAYS: Record<Terms, number> = { net_15: 15, net_30: 30, net_45: 45, net_60: 60, quick_pay: 0 };

interface PaymentSeed {
  invoiceNumber: number;
  receivedAt: Date;
  method: Method;
}

// Runtruck1 PAYMENTS; the times order the Paid tab like Runtruck1's stable sort (§7.15).
export const DEMO_PAYMENTS: readonly PaymentSeed[] = [
  { invoiceNumber: 8823, receivedAt: new Date('2026-09-03T17:00:00Z'), method: 'check' },
  { invoiceNumber: 8824, receivedAt: new Date('2026-09-02T22:00:00Z'), method: 'ach' },
  { invoiceNumber: 8838, receivedAt: new Date('2026-09-02T16:00:00Z'), method: 'factoring' },
  { invoiceNumber: 8839, receivedAt: new Date('2026-09-01T22:00:00Z'), method: 'factoring' },
  { invoiceNumber: 8830, receivedAt: new Date('2026-09-01T16:00:00Z'), method: 'ach' },
];

interface BatchSeed {
  batchNumber: number;
  createdOn: string;
  // Exactly one recipient (§5.8.5).
  customer?: string;
  factoring?: string;
  status: BatchStatus;
  invoiceNumbers: readonly number[];
}

// Runtruck1 BATCHES with the membership of C5 (§7.16).
export const DEMO_BATCHES: readonly BatchSeed[] = [
  { batchNumber: 2035, createdOn: day('09-03'), customer: 'Northgate Foods', status: 'ready', invoiceNumbers: [8845, 8841] },
  { batchNumber: 2034, createdOn: day('09-02'), customer: 'Cascade Building Supply', status: 'ready', invoiceNumbers: [8829, 8842, 8819] },
  { batchNumber: 2033, createdOn: day('09-01'), factoring: FACTORING_COMPANY, status: 'sent', invoiceNumbers: [8838, 8839] },
  { batchNumber: 2032, createdOn: day('08-29'), customer: 'Bayline Distribution', status: 'sent', invoiceNumbers: [8840, 8823] },
  { batchNumber: 2031, createdOn: day('08-26'), customer: 'Harbor Point Retail', status: 'sent', invoiceNumbers: [8824, 8821] },
  { batchNumber: 2030, createdOn: day('08-22'), factoring: FACTORING_COMPANY, status: 'settled', invoiceNumbers: [] },
  { batchNumber: 2029, createdOn: day('08-19'), customer: 'Northgate Foods', status: 'settled', invoiceNumbers: [8830] },
];

export async function seedBilling(db: DbExecutor, refs: DemoRefs): Promise<void> {
  const { organizationId } = refs;

  const factors = await db
    .insert(factoringCompanies)
    .values({ organizationId, name: FACTORING_COMPANY })
    .returning({ key: factoringCompanies.name, id: factoringCompanies.id });
  remember(refs.factoringCompanies, factors);

  const insertedInvoices = await db
    .insert(invoices)
    .values(
      DEMO_INVOICES.map((inv) => {
        const paymentTerms = inv.paymentTerms ?? customerTerms(inv.customer);
        return {
          organizationId,
          invoiceNumber: inv.invoiceNumber,
          customerId: must(refs.customers, inv.customer, 'customer'),
          status: inv.status,
          paymentTerms,
          issuedOn: inv.issuedOn,
          // §6.0.7: issued_on + net days of the invoice's terms.
          dueOn: inv.issuedOn === null ? null : addDaysIso(inv.issuedOn, NET_DAYS[paymentTerms]),
        };
      }),
    )
    .returning({ key: invoices.invoiceNumber, id: invoices.id });
  remember(refs.invoices, insertedInvoices);
  const invoice = (n: number) => must(refs.invoices, n, 'invoice');

  await db.insert(invoiceItems).values(
    DEMO_INVOICES.map((inv) => ({
      organizationId,
      invoiceId: invoice(inv.invoiceNumber),
      position: 1,
      loadId: must(refs.loads, inv.loadNumber, 'load'),
      description: 'Line haul',
      amountCents: inv.amountCents,
    })),
  );

  const amountOf = (n: number) => DEMO_INVOICES.find((inv) => inv.invoiceNumber === n)?.amountCents ?? 0;
  await db.insert(payments).values(
    DEMO_PAYMENTS.map((p) => ({
      organizationId,
      invoiceId: invoice(p.invoiceNumber),
      receivedAt: p.receivedAt,
      method: p.method,
      factoringCompanyId: p.method === 'factoring' ? must(refs.factoringCompanies, FACTORING_COMPANY, 'factoring company') : null,
      amountCents: amountOf(p.invoiceNumber),
      reference: null,
    })),
  );

  const batches = await db
    .insert(invoiceBatches)
    .values(
      DEMO_BATCHES.map((b) => ({
        organizationId,
        batchNumber: b.batchNumber,
        createdOn: b.createdOn,
        customerId: b.customer ? must(refs.customers, b.customer, 'customer') : null,
        factoringCompanyId: b.factoring ? must(refs.factoringCompanies, b.factoring, 'factoring company') : null,
        status: b.status,
      })),
    )
    .returning({ key: invoiceBatches.batchNumber, id: invoiceBatches.id });
  const batchIds = new Map<number, string>();
  remember(batchIds, batches);

  await db.insert(invoiceBatchItems).values(
    DEMO_BATCHES.flatMap((b) =>
      b.invoiceNumbers.map((n) => ({ organizationId, batchId: must(batchIds, b.batchNumber, 'batch'), invoiceId: invoice(n) })),
    ),
  );
}
