import { Injectable } from '@nestjs/common';
import { invoiceBatchSentTo } from '@runtruck/calculations';
import type { DbExecutor } from '@runtruck/database';
import type { InvoiceBatchesSummary, InvoiceBatchRecipientKind, InvoiceBatchRow, InvoiceBatchStatus } from '@runtruck/types';
import { type SQL, sql } from 'drizzle-orm';
import { toNumber } from '../common/list/list-query.js';

// Invoice batches (docs/api/billing.md §5): one row per batch with its computed member
// count and total (Σ member invoice totals, never stored, 03 §1.8). Every relation carries
// the organization predicate.
function batchesRelation(organizationId: string): SQL {
  return sql`SELECT ib.id, ib.batch_number, ib.created_on, ib.status, ib.customer_id, ib.factoring_company_id,
         coalesce(cu.name, fc.name) AS recipient_name,
         coalesce(m.invoice_count, 0)::int AS invoice_count,
         coalesce(m.total_cents, 0)::bigint AS total_cents
  FROM invoice_batches ib
  LEFT JOIN customers cu ON cu.organization_id = ib.organization_id AND cu.id = ib.customer_id
  LEFT JOIN factoring_companies fc ON fc.organization_id = ib.organization_id AND fc.id = ib.factoring_company_id
  LEFT JOIN LATERAL (
    SELECT count(DISTINCT bi.invoice_id) AS invoice_count, sum(ii.amount_cents) AS total_cents
    FROM invoice_batch_items bi
    LEFT JOIN invoice_items ii ON ii.organization_id = bi.organization_id AND ii.invoice_id = bi.invoice_id
    WHERE bi.organization_id = ib.organization_id AND bi.batch_id = ib.id) m ON true
  WHERE ib.organization_id = ${organizationId}`;
}

interface BatchDbRow extends Record<string, unknown> {
  id: string;
  batch_number: number;
  created_on: string;
  status: InvoiceBatchStatus;
  customer_id: string | null;
  factoring_company_id: string | null;
  recipient_name: string;
  invoice_count: number;
  total_cents: string;
}

interface BatchSummaryDbRow extends Record<string, unknown> {
  batch_count: number;
  invoice_count: string;
  ready_count: number;
  ready_total_cents: string;
  sent_this_week_count: number;
  total_cents: string;
}

function toBatchRow(r: BatchDbRow): InvoiceBatchRow {
  const kind: InvoiceBatchRecipientKind = r.customer_id ? 'customer' : 'factoring_company';
  const recipientId = r.customer_id ?? r.factoring_company_id;
  if (!recipientId) throw new Error('Invoice batch without a recipient');
  return {
    id: r.id,
    batchNumber: r.batch_number,
    createdOn: r.created_on,
    status: r.status,
    recipient: { kind, id: recipientId, name: r.recipient_name },
    sentTo: invoiceBatchSentTo(kind, r.recipient_name),
    invoiceCount: r.invoice_count,
    totalCents: toNumber(r.total_cents),
  };
}

@Injectable()
export class BillingRepository {
  // Batches in list order (batch_number DESC; = Runtruck1's order).
  async batches(db: DbExecutor, organizationId: string, page: { limit: number; offset: number }): Promise<InvoiceBatchRow[]> {
    const result = await db.execute<BatchDbRow>(sql`SELECT b.id, b.batch_number, b.created_on::text AS created_on, b.status, b.customer_id,
             b.factoring_company_id, b.recipient_name, b.invoice_count, b.total_cents
      FROM (${batchesRelation(organizationId)}) b
      ORDER BY b.batch_number DESC
      LIMIT ${page.limit} OFFSET ${page.offset}`);
    return result.rows.map(toBatchRow);
  }

  // KPI figures over every batch (billing.md §5.2).
  async batchesSummary(db: DbExecutor, organizationId: string, today: string): Promise<InvoiceBatchesSummary> {
    const result = await db.execute<BatchSummaryDbRow>(sql`SELECT count(*)::int AS batch_count,
             coalesce(sum(b.invoice_count), 0)::bigint AS invoice_count,
             (count(*) FILTER (WHERE b.status = 'ready'))::int AS ready_count,
             coalesce(sum(b.total_cents) FILTER (WHERE b.status = 'ready'), 0)::bigint AS ready_total_cents,
             (count(*) FILTER (WHERE b.status = 'sent' AND ${today}::date - b.created_on < 7))::int AS sent_this_week_count,
             coalesce(sum(b.total_cents), 0)::bigint AS total_cents
      FROM (${batchesRelation(organizationId)}) b`);
    const r = result.rows[0];
    if (!r) throw new Error('Batches summary returned no row');
    return {
      batchCount: r.batch_count,
      invoiceCount: toNumber(r.invoice_count),
      readyCount: r.ready_count,
      readyTotalCents: toNumber(r.ready_total_cents),
      sentThisWeekCount: r.sent_this_week_count,
      totalCents: toNumber(r.total_cents),
    };
  }
}
