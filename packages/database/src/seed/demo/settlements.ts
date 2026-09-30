import type { DbExecutor } from '../../client.js';
import { settlementItems, settlements } from '../../schema/settlements.js';
import { day, must, type DemoRefs } from './refs.js';

// Driver settlements (§7.18): Runtruck1 SETTLEMENTS. Runtruck1 gives per-driver totals,
// so the line-pay items split them evenly (the remainder on the first items, C4) and
// one deduction item carries `ded`. Amounts are Runtruck1's, not recomputed from the rate.

type Settlement = typeof settlements.$inferInsert;

type SettlementSeed = Pick<Settlement, 'payBasis' | 'status'> & {
  driver: string;
  payRateCents?: number;
  payPercentBp?: number;
  holdReason?: string;
  loads: number;
  miles: number;
  grossCents: number;
  // Positive cents deducted (Runtruck1 "-$142" → 14200); 0 = none ("—").
  deductionCents: number;
};

export const SETTLEMENT_PERIOD = { periodStart: day('09-01'), periodEnd: day('09-07') } as const;

// In Runtruck1 order (the drivers' roster order).
export const DEMO_SETTLEMENTS: readonly SettlementSeed[] = [
  { driver: 'Marcus Hale', payBasis: 'per_mile', payRateCents: 62, status: 'ready', loads: 4, miles: 2140, grossCents: 132_600, deductionCents: 14_200 },
  { driver: 'Dara Whitfield', payBasis: 'per_mile', payRateCents: 60, status: 'ready', loads: 3, miles: 1980, grossCents: 118_800, deductionCents: 9_600 },
  { driver: 'Ellis Nakamura', payBasis: 'percent_of_line_haul', payPercentBp: 2500, status: 'on_hold', holdReason: 'fuel', loads: 3, miles: 1760, grossCents: 145_500, deductionCents: 21_000 },
  { driver: 'Priya Raman', payBasis: 'per_mile', payRateCents: 58, status: 'ready', loads: 2, miles: 1420, grossCents: 82_400, deductionCents: 6_400 },
  { driver: 'Ana Cortez', payBasis: 'per_mile', payRateCents: 58, status: 'paid', loads: 2, miles: 1180, grossCents: 68_400, deductionCents: 0 },
];

// Splits a total into n near-equal integer parts, the remainder going to the first parts.
export function splitEvenly(total: number, n: number): number[] {
  const base = Math.floor(total / n);
  const remainder = total - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < remainder ? 1 : 0));
}

export async function seedSettlements(db: DbExecutor, refs: DemoRefs): Promise<void> {
  const { organizationId } = refs;
  const inserted = await db
    .insert(settlements)
    .values(
      DEMO_SETTLEMENTS.map((s) => ({
        organizationId,
        driverId: must(refs.drivers, s.driver, 'driver'),
        ...SETTLEMENT_PERIOD,
        payBasis: s.payBasis,
        payRateCents: s.payRateCents ?? null,
        payPercentBp: s.payPercentBp ?? null,
        status: s.status,
        holdReason: s.holdReason ?? null,
        approvedAt: null,
        approvedByUserId: null,
      })),
    )
    .returning({ id: settlements.id, driverId: settlements.driverId });
  const settlementByDriver = new Map(inserted.map((s) => [s.driverId, s.id]));

  const items = DEMO_SETTLEMENTS.flatMap((s) => {
    const settlementId = must(settlementByDriver, must(refs.drivers, s.driver, 'driver'), 'settlement');
    const miles = splitEvenly(s.miles, s.loads);
    const amounts = splitEvenly(s.grossCents, s.loads);
    const linePay = amounts.map((amountCents, i) => ({
      organizationId,
      settlementId,
      position: i + 1,
      kind: 'line_pay' as const,
      loadId: null,
      miles: miles[i] ?? 0,
      description: null,
      amountCents,
    }));
    const deduction =
      s.deductionCents > 0
        ? [{ organizationId, settlementId, position: s.loads + 1, kind: 'deduction' as const, loadId: null, miles: null, description: null, amountCents: -s.deductionCents }]
        : [];
    return [...linePay, ...deduction];
  });
  await db.insert(settlementItems).values(items);
}
