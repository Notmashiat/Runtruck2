import { sql } from 'drizzle-orm';
import { check, date, index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { id, timestamps } from './_columns.js';
import { tenantFk, tenantKey } from './_tenant.js';
import { drivers } from './fleet.js';
import { payBasis, payBasisCheck } from './hr.js';
import { loads } from './loads.js';
import { organizationId, users } from './platform.js';

// Driver settlements (payroll) and their line items. Gross, deductions, net,
// loads and miles are computed from items (D5). Specified in docs/03-database.md §5.10.

// Runtruck1: Ready / Approved / Hold · <reason> / Paid (stored, design brief §2).
export const settlementStatus = pgEnum('settlement_status', ['ready', 'approved', 'on_hold', 'paid']);

export const settlementItemKind = pgEnum('settlement_item_kind', ['line_pay', 'deduction']);

export const settlements = pgTable(
  'settlements',
  {
    id: id(),
    organizationId: organizationId(),
    driverId: uuid().notNull(),
    // Pay period ("Week of Sep 1").
    periodStart: date({ mode: 'string' }).notNull(),
    periodEnd: date({ mode: 'string' }).notNull(),
    // Pay basis in force for the period ("$0.62 / mi", "25% of line haul").
    payBasis: payBasis().notNull(),
    payRateCents: integer(),
    payPercentBp: integer(),
    status: settlementStatus().notNull(),
    // "Hold · fuel" → 'fuel'.
    holdReason: text(),
    approvedAt: timestamp({ withTimezone: true, mode: 'date' }),
    approvedByUserId: uuid().references(() => users.id, { onDelete: 'restrict' }),
    ...timestamps(),
  },
  (t) => [
    tenantKey('settlements', t),
    tenantFk('settlements_driver_fk', t.organizationId, t.driverId, drivers).onDelete('restrict'),
    uniqueIndex('settlements_org_driver_period_uq').on(t.organizationId, t.driverId, t.periodStart),
    index('settlements_org_period_idx').on(t.organizationId, t.periodStart),
    check('settlements_period_ck', sql`${t.periodEnd} >= ${t.periodStart}`),
    check('settlements_hold_ck', sql`(${t.status} = 'on_hold') = (${t.holdReason} is not null)`),
    check('settlements_approved_ck', sql`${t.status} <> 'approved' or ${t.approvedAt} is not null`),
    payBasisCheck('settlements_pay_ck', t.payBasis, t.payRateCents, t.payPercentBp),
  ],
);

export const settlementItems = pgTable(
  'settlement_items',
  {
    id: id(),
    organizationId: organizationId(),
    settlementId: uuid().notNull(),
    position: integer().notNull(),
    kind: settlementItemKind().notNull(),
    // The load a line_pay item pays for, when known.
    loadId: uuid(),
    // Paid miles of a line_pay item.
    miles: integer(),
    description: text(),
    // Signed: line pay ≥ 0, deductions ≤ 0.
    amountCents: integer().notNull(),
    ...timestamps(),
  },
  (t) => [
    tenantKey('settlement_items', t),
    tenantFk('settlement_items_settlement_fk', t.organizationId, t.settlementId, settlements).onDelete('cascade'),
    tenantFk('settlement_items_load_fk', t.organizationId, t.loadId, loads).onDelete('restrict'),
    uniqueIndex('settlement_items_settlement_position_uq').on(t.organizationId, t.settlementId, t.position),
    check(
      'settlement_items_amount_ck',
      sql`(${t.kind} = 'line_pay' and ${t.amountCents} >= 0 and (${t.miles} is null or ${t.miles} >= 0))
        or (${t.kind} = 'deduction' and ${t.amountCents} <= 0 and ${t.miles} is null and ${t.loadId} is null)`,
    ),
  ],
);
