import { Inject, Injectable } from '@nestjs/common';
import type { DriverCurrentLoadStatus, DriverDutyStatus } from '@runtruck/types';
import { sql } from 'drizzle-orm';
import { type Database, DB } from '../database/database.module.js';

// One roster row as read from PostgreSQL (docs/api/fleet.md §2.7). Sums arrive as
// bigint strings from node-postgres; dates as YYYY-MM-DD strings.
export type DriverSqlRow = {
  id: string;
  first_name: string;
  last_name: string;
  duty_status: DriverDutyStatus;
  hos_remaining_minutes: number | null;
  truck_id: string | null;
  unit_number: string | null;
  cdl_expires_on: string | null;
  pay_ytd: string | number;
  week_miles: number;
  load_id: string | null;
  load_number: number | null;
  load_status: DriverCurrentLoadStatus | null;
  first_pickup_date: string | null;
  origin_short: string | null;
  destination_short: string | null;
};

export interface DriverWindows {
  today: string;
  weekStart: string;
  weekEnd: string;
  ytdStart: string;
}

@Injectable()
export class DriversRepository {
  constructor(@Inject(DB) private readonly db: Database) {}

  // Every driver of the organization with its roster facts, in one statement whatever the
  // number of drivers (fleet.md §2.7). Every table read and every join is scoped to the
  // organization. The current-load candidates are only live dispatches of board loads in
  // an in-progress or dispatched status, and their stops are read per candidate load
  // (LATERAL … LIMIT 1), never across the organization's stop history (04 §5.1).
  // Current-load choice (fleet.md §2.2): in-progress before dispatched, then the earliest
  // first pickup, then the lowest load number.
  async listAll(organizationId: string, w: DriverWindows): Promise<DriverSqlRow[]> {
    const result = await this.db.execute<DriverSqlRow>(sql`
      WITH miles AS (
        SELECT driver_id, sum(miles)::int AS week_miles
        FROM driver_mileage_entries
        WHERE organization_id = ${organizationId} AND recorded_on BETWEEN ${w.weekStart}::date AND ${w.weekEnd}::date
        GROUP BY driver_id),
      pay AS (
        SELECT s.driver_id, sum(si.amount_cents)::bigint AS pay_ytd
        FROM settlements s
        JOIN settlement_items si ON si.organization_id = s.organization_id AND si.settlement_id = s.id AND si.kind = 'line_pay'
        WHERE s.organization_id = ${organizationId} AND s.period_start BETWEEN ${w.ytdStart}::date AND ${w.today}::date
        GROUP BY s.driver_id),
      cur AS (
        SELECT DISTINCT ON (d.driver_id) d.driver_id, l.id AS load_id, l.load_number, l.status AS load_status,
               fp.appointment_date AS first_pickup_date,
               coalesce(ff.market_short, ff.market_city, ff.city, fp.city) AS origin_short,
               coalesce(lf.market_short, lf.market_city, lf.city, ld.city) AS destination_short
        FROM dispatches d
        JOIN loads l ON l.organization_id = d.organization_id AND l.id = d.load_id
         AND l.archived_at IS NULL AND l.status IN ('at_pickup', 'in_transit', 'delayed', 'dispatched')
        JOIN LATERAL (SELECT s.organization_id, s.appointment_date, s.city, s.facility_id FROM load_stops s
                      WHERE s.organization_id = l.organization_id AND s.load_id = l.id
                      ORDER BY (s.kind <> 'pickup'), s.sequence LIMIT 1) fp ON true
        JOIN LATERAL (SELECT s.organization_id, s.city, s.facility_id FROM load_stops s
                      WHERE s.organization_id = l.organization_id AND s.load_id = l.id
                      ORDER BY (s.kind <> 'delivery'), s.sequence DESC LIMIT 1) ld ON true
        LEFT JOIN facilities ff ON ff.organization_id = fp.organization_id AND ff.id = fp.facility_id
        LEFT JOIN facilities lf ON lf.organization_id = ld.organization_id AND lf.id = ld.facility_id
        WHERE d.organization_id = ${organizationId} AND d.status <> 'cancelled' AND d.driver_id IS NOT NULL
        ORDER BY d.driver_id, (l.status = 'dispatched'), fp.appointment_date, l.load_number)
      SELECT dr.id, e.first_name, e.last_name, dr.duty_status, dr.hos_remaining_minutes,
             t.id AS truck_id, t.unit_number, cdl.expires_on AS cdl_expires_on,
             coalesce(pay.pay_ytd, 0) AS pay_ytd, coalesce(miles.week_miles, 0) AS week_miles,
             cur.load_id, cur.load_number, cur.load_status, cur.first_pickup_date, cur.origin_short, cur.destination_short
      FROM drivers dr
      JOIN employees e ON e.organization_id = dr.organization_id AND e.id = dr.employee_id
      LEFT JOIN trucks t ON t.organization_id = dr.organization_id AND t.assigned_driver_id = dr.id
      LEFT JOIN driver_documents cdl ON cdl.organization_id = dr.organization_id AND cdl.driver_id = dr.id AND cdl.document_type = 'cdl'
      LEFT JOIN miles ON miles.driver_id = dr.id
      LEFT JOIN pay ON pay.driver_id = dr.id
      LEFT JOIN cur ON cur.driver_id = dr.id
      WHERE dr.organization_id = ${organizationId}
      ORDER BY dr.position, dr.id`);
    return result.rows;
  }
}
