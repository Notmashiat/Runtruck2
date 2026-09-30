import { Inject, Injectable } from '@nestjs/common';
import type { ComplianceDatePrecision, DriverDocumentStatus, DriverDocumentType, ViolationStatus } from '@runtruck/types';
import { sql } from 'drizzle-orm';
import { type Database, DB } from '../database/database.module.js';

// Compliance reads (docs/api/safety.md §3–§5). Driver documents and compliance reminders are
// reference-size (a few rows per driver): one statement reads every row of the organization.
// Violations grow with the business: they page in SQL and summarize with one aggregate.
// Every table read and every join is scoped to the organization.

export interface DriverDocumentSqlRow extends Record<string, unknown> {
  id: string;
  document_type: DriverDocumentType;
  expires_on: string | null;
  expires_precision: ComplianceDatePrecision;
  status: DriverDocumentStatus;
  driver_id: string;
  first_name: string;
  last_name: string;
}

export interface ComplianceReminderSqlRow extends Record<string, unknown> {
  id: string;
  item_label: string;
  due_on: string;
  due_precision: ComplianceDatePrecision;
  driver_id: string;
  first_name: string;
  last_name: string;
}

export interface ViolationSqlRow extends Record<string, unknown> {
  id: string;
  occurred_on: string;
  violation_type: string;
  severity_points: number;
  location: string;
  status: ViolationStatus;
  driver_id: string;
  first_name: string;
  last_name: string;
  truck_id: string;
  unit_number: string;
  // count(*) OVER (): rows of the filter, before LIMIT/OFFSET.
  total_count: number;
}

export interface ViolationsSummaryFigures {
  violationCount: number;
  openCount: number;
  contestedCount: number;
  closedCount: number;
  pointsInWindow: number;
  violationsInWindowCount: number;
}

@Injectable()
export class ComplianceRepository {
  constructor(@Inject(DB) private readonly db: Database) {}

  // Every driver document of the organization with its driver's name, in list order
  // (position, id: roster order, then the order within each file; safety.md §3.2, §3.6).
  async driverDocuments(organizationId: string): Promise<DriverDocumentSqlRow[]> {
    const result = await this.db.execute<DriverDocumentSqlRow>(sql`
      SELECT dd.id, dd.document_type, dd.expires_on::text AS expires_on, dd.expires_precision, dd.status,
             d.id AS driver_id, e.first_name, e.last_name
      FROM driver_documents dd
      JOIN drivers d ON d.organization_id = dd.organization_id AND d.id = dd.driver_id
      JOIN employees e ON e.organization_id = d.organization_id AND e.id = d.employee_id
      WHERE dd.organization_id = ${organizationId}
      ORDER BY dd.position, dd.id`);
    return result.rows;
  }

  // Every compliance reminder (the Drivers-tab watchlist), in its hand-authored order (safety.md §4.2, §4.6).
  async complianceReminders(organizationId: string): Promise<ComplianceReminderSqlRow[]> {
    const result = await this.db.execute<ComplianceReminderSqlRow>(sql`
      SELECT cr.id, cr.item_label, cr.due_on::text AS due_on, cr.due_precision, d.id AS driver_id, e.first_name, e.last_name
      FROM compliance_reminders cr
      JOIN drivers d ON d.organization_id = cr.organization_id AND d.id = cr.driver_id
      JOIN employees e ON e.organization_id = d.organization_id AND e.id = d.employee_id
      WHERE cr.organization_id = ${organizationId}
      ORDER BY cr.position, cr.id`);
    return result.rows;
  }

  // One page of violations, newest first (occurred_on DESC, id; safety.md §5.2, §5.6).
  async violationsPage(organizationId: string, p: { status?: ViolationStatus | undefined; limit: number; offset: number }): Promise<ViolationSqlRow[]> {
    const result = await this.db.execute<ViolationSqlRow>(sql`
      SELECT v.id, v.occurred_on::text AS occurred_on, v.violation_type, v.severity_points, v.location, v.status,
             d.id AS driver_id, e.first_name, e.last_name, t.id AS truck_id, t.unit_number,
             (count(*) OVER ())::int AS total_count
      FROM violations v
      JOIN drivers d ON d.organization_id = v.organization_id AND d.id = v.driver_id
      JOIN employees e ON e.organization_id = d.organization_id AND e.id = d.employee_id
      JOIN trucks t ON t.organization_id = v.organization_id AND t.id = v.truck_id
      WHERE v.organization_id = ${organizationId}${p.status ? sql` AND v.status = ${p.status}` : sql``}
      ORDER BY v.occurred_on DESC, v.id
      LIMIT ${p.limit} OFFSET ${p.offset}`);
    return result.rows;
  }

  // Rows of the filter, for a page requested beyond its end.
  async violationsCount(organizationId: string, status: ViolationStatus | undefined): Promise<number> {
    const result = await this.db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM violations
      WHERE organization_id = ${organizationId}${status ? sql` AND status = ${status}` : sql``}`);
    return result.rows[0]?.n ?? 0;
  }

  // meta.summary in one aggregate over the organization's violations (safety.md §5.4): counts
  // by status, and points and count within the 12-month window (any status).
  async violationsSummary(organizationId: string, pointsWindowStart: string): Promise<ViolationsSummaryFigures> {
    const result = await this.db.execute<{
      violation_count: number;
      open_count: number;
      contested_count: number;
      closed_count: number;
      points_in_window: number;
      violations_in_window_count: number;
    }>(sql`
      SELECT count(*)::int AS violation_count,
             (count(*) FILTER (WHERE status = 'open'))::int AS open_count,
             (count(*) FILTER (WHERE status = 'contested'))::int AS contested_count,
             (count(*) FILTER (WHERE status = 'closed'))::int AS closed_count,
             (coalesce(sum(severity_points) FILTER (WHERE occurred_on >= ${pointsWindowStart}::date), 0))::int AS points_in_window,
             (count(*) FILTER (WHERE occurred_on >= ${pointsWindowStart}::date))::int AS violations_in_window_count
      FROM violations
      WHERE organization_id = ${organizationId}`);
    const r = result.rows[0];
    if (!r) throw new Error('Violations summary returned no row');
    return {
      violationCount: r.violation_count,
      openCount: r.open_count,
      contestedCount: r.contested_count,
      closedCount: r.closed_count,
      pointsInWindow: r.points_in_window,
      violationsInWindowCount: r.violations_in_window_count,
    };
  }
}
