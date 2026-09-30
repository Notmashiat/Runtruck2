import type { ComplianceReminderRow, DriverDocumentKpiEntry, DriverDocumentRow, DriverDocumentsSummary, ViolationRow } from '@runtruck/types';
import type { ComplianceReminderSqlRow, DriverDocumentSqlRow, ViolationSqlRow } from './compliance.repository.js';

// Pure mapping and aggregation for GET /driver-documents, /compliance-reminders and
// /violations (docs/api/safety.md §3–§5, docs/03-database.md §6.9).

const fullName = (r: { first_name: string; last_name: string }) => `${r.first_name} ${r.last_name}`;

export function toDriverDocumentDto(r: DriverDocumentSqlRow): DriverDocumentRow {
  return {
    id: r.id,
    driver: { id: r.driver_id, fullName: fullName(r) },
    documentType: r.document_type,
    expiresOn: r.expires_on,
    expiresPrecision: r.expires_precision,
    status: r.status,
  };
}

function kpiEntry(d: DriverDocumentRow): DriverDocumentKpiEntry {
  return { driverDocumentId: d.id, driverId: d.driver.id, fullName: d.driver.fullName, documentType: d.documentType };
}

// KPI figures over every driver document of the organization, in list order (never filtered
// by q or status). Statuses are stored lifecycle facts, never re-derived (safety.md §1.7).
export function summarizeDriverDocuments(
  documents: readonly DriverDocumentRow[],
  windows: Pick<DriverDocumentsSummary, 'asOf' | 'expiringWindowEnd'>,
): DriverDocumentsSummary {
  return {
    ...windows,
    documentCount: documents.length,
    driverCount: new Set(documents.map((d) => d.driver.id)).size,
    expiringCount: documents.filter((d) => d.status === 'expiring').length,
    expired: documents.filter((d) => d.status === 'expired').map(kpiEntry),
    missing: documents.filter((d) => d.status === 'missing').map(kpiEntry),
  };
}

export function toComplianceReminderDto(r: ComplianceReminderSqlRow): ComplianceReminderRow {
  return {
    id: r.id,
    driver: { id: r.driver_id, fullName: fullName(r) },
    itemLabel: r.item_label,
    dueOn: r.due_on,
    duePrecision: r.due_precision,
  };
}

export function toViolationDto(r: ViolationSqlRow): ViolationRow {
  return {
    id: r.id,
    occurredOn: r.occurred_on,
    driver: { id: r.driver_id, fullName: fullName(r) },
    truck: { id: r.truck_id, unitNumber: r.unit_number },
    violationType: r.violation_type,
    severityPoints: r.severity_points,
    location: r.location,
    status: r.status,
  };
}
