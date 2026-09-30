import { Injectable } from '@nestjs/common';
import { billCategoryLabel } from '@runtruck/calculations';
import type { DbExecutor } from '@runtruck/database';
import type { BillRow, BillsSummary, BillStatus } from '@runtruck/types';
import { sql } from 'drizzle-orm';
import { toNumber } from '../common/list/list-query.js';

// Vendor bills (docs/api/payables.md §2). Both relations carry the organization predicate.

interface BillDbRow extends Record<string, unknown> {
  id: string;
  vendor_id: string;
  vendor_name: string;
  category: string;
  description: string | null;
  due_on: string;
  amount_cents: number;
  status: BillStatus;
  scheduled_on: string | null;
  paid_on: string | null;
}

interface BillsSummaryDbRow extends Record<string, unknown> {
  row_count: number;
  due_week_count: number;
  due_week_cents: string;
  overdue_count: number;
  overdue_cents: string;
  scheduled_count: number;
  scheduled_cents: string;
  paid_month_count: number;
  paid_month_cents: string;
}

function toBillRow(r: BillDbRow): BillRow {
  return {
    id: r.id,
    vendorId: r.vendor_id,
    vendorName: r.vendor_name,
    category: r.category,
    description: r.description,
    categoryLabel: billCategoryLabel(r.category, r.description),
    dueOn: r.due_on,
    amountCents: r.amount_cents,
    status: r.status,
    scheduledOn: r.scheduled_on,
    paidOn: r.paid_on,
  };
}

@Injectable()
export class PayablesRepository {
  // Bills in list order (due_on ASC, id ASC; = Runtruck1's BILLS order).
  async bills(db: DbExecutor, organizationId: string, page: { limit: number; offset: number }): Promise<BillRow[]> {
    const result = await db.execute<BillDbRow>(sql`SELECT b.id, b.vendor_id, v.name AS vendor_name, b.category, b.description,
             b.due_on::text AS due_on, b.amount_cents, b.status, b.scheduled_on::text AS scheduled_on, b.paid_on::text AS paid_on
      FROM bills b
      JOIN vendors v ON v.organization_id = b.organization_id AND v.id = b.vendor_id
      WHERE b.organization_id = ${organizationId}
      ORDER BY b.due_on ASC, b.id ASC
      LIMIT ${page.limit} OFFSET ${page.offset}`);
    return result.rows.map(toBillRow);
  }

  // KPI figures over every bill (payables.md §2.2). `month` = the current org month [start, next).
  async summary(db: DbExecutor, organizationId: string, args: { today: string; month: { start: string; next: string } }): Promise<{ rowCount: number; summary: BillsSummary }> {
    const { today, month } = args;
    const result = await db.execute<BillsSummaryDbRow>(sql`SELECT count(*)::int AS row_count,
             (count(*) FILTER (WHERE status = 'due' AND due_on - ${today}::date <= 7))::int AS due_week_count,
             coalesce(sum(amount_cents) FILTER (WHERE status = 'due' AND due_on - ${today}::date <= 7), 0)::bigint AS due_week_cents,
             (count(*) FILTER (WHERE status = 'overdue'))::int AS overdue_count,
             coalesce(sum(amount_cents) FILTER (WHERE status = 'overdue'), 0)::bigint AS overdue_cents,
             (count(*) FILTER (WHERE status = 'scheduled'))::int AS scheduled_count,
             coalesce(sum(amount_cents) FILTER (WHERE status = 'scheduled'), 0)::bigint AS scheduled_cents,
             (count(*) FILTER (WHERE status = 'paid' AND paid_on >= ${month.start}::date AND paid_on < ${month.next}::date))::int AS paid_month_count,
             coalesce(sum(amount_cents) FILTER (WHERE status = 'paid' AND paid_on >= ${month.start}::date AND paid_on < ${month.next}::date), 0)::bigint AS paid_month_cents
      FROM bills WHERE organization_id = ${organizationId}`);
    const r = result.rows[0];
    if (!r) throw new Error('Bills summary returned no row');
    return {
      rowCount: r.row_count,
      summary: {
        dueThisWeek: { count: r.due_week_count, amountCents: toNumber(r.due_week_cents) },
        overdue: { count: r.overdue_count, amountCents: toNumber(r.overdue_cents) },
        scheduled: { count: r.scheduled_count, amountCents: toNumber(r.scheduled_cents) },
        paidThisMonth: { count: r.paid_month_count, amountCents: toNumber(r.paid_month_cents) },
      },
    };
  }
}
