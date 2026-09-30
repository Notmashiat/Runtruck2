import { Inject, Injectable } from '@nestjs/common';
import type { WorkOrderOverdueEntry, WorkOrderShop, WorkOrderStatus } from '@runtruck/types';
import { sql } from 'drizzle-orm';
import { toNumber } from '../common/list/list-query.js';
import { type Database, DB } from '../database/database.module.js';

// Maintenance work orders (docs/api/safety.md §2). Work orders grow with the business, so a
// request pages in SQL and computes its summary with one aggregate statement (safety.md
// §1.2, docs/04-api.md §5.1). Every table read and every join is scoped to the organization.

export interface WorkOrderSqlRow extends Record<string, unknown> {
  id: string;
  item: string;
  due_on: string | null;
  due_odometer: number | null;
  estimate_cents: number;
  status: WorkOrderStatus;
  completed_on: string | null;
  truck_id: string | null;
  truck_unit_number: string | null;
  trailer_id: string | null;
  trailer_unit_number: string | null;
  shop_id: string;
  shop_name: string;
  shop_city: string;
  // count(*) OVER (): rows of the filter, before LIMIT/OFFSET.
  total_count: number;
}

interface WorkOrdersSummarySqlRow extends Record<string, unknown> {
  work_order_count: number;
  open_count: number;
  done_last_30d_count: number;
  in_shop_count: number;
  open_estimate_cents: string;
  in_shop_shops: WorkOrderShop[];
  overdue: WorkOrderOverdueEntry[];
}

export interface WorkOrdersSummaryFigures {
  workOrderCount: number;
  openCount: number;
  doneLast30dCount: number;
  inShopCount: number;
  inShopShops: WorkOrderShop[];
  overdue: WorkOrderOverdueEntry[];
  openEstimateCents: number;
}

export interface WorkOrderPageParams {
  status?: WorkOrderStatus | undefined;
  limit: number;
  offset: number;
}

@Injectable()
export class MaintenanceRepository {
  constructor(@Inject(DB) private readonly db: Database) {}

  // One page of the organization's work orders in list order (position, id; safety.md §2.2, §2.6).
  async page(organizationId: string, p: WorkOrderPageParams): Promise<WorkOrderSqlRow[]> {
    const result = await this.db.execute<WorkOrderSqlRow>(sql`
      SELECT w.id, w.item, w.due_on::text AS due_on, w.due_odometer, w.estimate_cents, w.status, w.completed_on::text AS completed_on,
             t.id AS truck_id, t.unit_number AS truck_unit_number,
             tr.id AS trailer_id, tr.unit_number AS trailer_unit_number,
             f.id AS shop_id, f.name AS shop_name, f.city AS shop_city,
             (count(*) OVER ())::int AS total_count
      FROM work_orders w
      LEFT JOIN trucks t ON t.organization_id = w.organization_id AND t.id = w.truck_id
      LEFT JOIN trailers tr ON tr.organization_id = w.organization_id AND tr.id = w.trailer_id
      JOIN facilities f ON f.organization_id = w.organization_id AND f.id = w.shop_facility_id
      WHERE w.organization_id = ${organizationId}${p.status ? sql` AND w.status = ${p.status}` : sql``}
      ORDER BY w.position, w.id
      LIMIT ${p.limit} OFFSET ${p.offset}`);
    return result.rows;
  }

  // Rows of the filter, for a page requested beyond its end (count(*) OVER () has no row to ride on).
  async count(organizationId: string, status: WorkOrderStatus | undefined): Promise<number> {
    const result = await this.db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM work_orders
      WHERE organization_id = ${organizationId}${status ? sql` AND status = ${status}` : sql``}`);
    return result.rows[0]?.n ?? 0;
  }

  // meta.summary in one statement over the organization's work orders (safety.md §2.4):
  // counts by status, the done window, the open estimate, and the two note lists (in-shop
  // shops distinct by facility and overdue orders, each in list order).
  async summary(organizationId: string, doneWindowStart: string): Promise<WorkOrdersSummaryFigures> {
    const result = await this.db.execute<WorkOrdersSummarySqlRow>(sql`
      SELECT count(*)::int AS work_order_count,
             (count(*) FILTER (WHERE w.status <> 'done'))::int AS open_count,
             (count(*) FILTER (WHERE w.status = 'done' AND w.completed_on >= ${doneWindowStart}::date))::int AS done_last_30d_count,
             (count(*) FILTER (WHERE w.status = 'in_shop'))::int AS in_shop_count,
             coalesce(sum(w.estimate_cents) FILTER (WHERE w.status <> 'done'), 0)::bigint AS open_estimate_cents,
             (SELECT coalesce(json_agg(json_build_object('facilityId', s.id, 'name', s.name, 'city', s.city) ORDER BY s.position, s.work_order_id), '[]'::json)
              FROM (SELECT DISTINCT ON (f.id) f.id, f.name, f.city, iw.position, iw.id AS work_order_id
                    FROM work_orders iw
                    JOIN facilities f ON f.organization_id = iw.organization_id AND f.id = iw.shop_facility_id
                    WHERE iw.organization_id = ${organizationId} AND iw.status = 'in_shop'
                    ORDER BY f.id, iw.position, iw.id) s) AS in_shop_shops,
             (SELECT coalesce(json_agg(json_build_object('workOrderId', ow.id, 'unitNumber', coalesce(t.unit_number, tr.unit_number), 'item', ow.item)
                                       ORDER BY ow.position, ow.id), '[]'::json)
              FROM work_orders ow
              LEFT JOIN trucks t ON t.organization_id = ow.organization_id AND t.id = ow.truck_id
              LEFT JOIN trailers tr ON tr.organization_id = ow.organization_id AND tr.id = ow.trailer_id
              WHERE ow.organization_id = ${organizationId} AND ow.status = 'overdue') AS overdue
      FROM work_orders w
      WHERE w.organization_id = ${organizationId}`);
    const r = result.rows[0];
    if (!r) throw new Error('Work-order summary returned no row');
    return {
      workOrderCount: r.work_order_count,
      openCount: r.open_count,
      doneLast30dCount: r.done_last_30d_count,
      inShopCount: r.in_shop_count,
      inShopShops: r.in_shop_shops,
      overdue: r.overdue,
      openEstimateCents: toNumber(r.open_estimate_cents),
    };
  }
}
