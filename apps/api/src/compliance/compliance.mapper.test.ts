import { describe, expect, it } from 'vitest';
import { summarizeDriverDocuments, toComplianceReminderDto, toDriverDocumentDto, toViolationDto } from './compliance.mapper.js';
import type { DriverDocumentSqlRow } from './compliance.repository.js';

const doc = (over: Partial<DriverDocumentSqlRow>): DriverDocumentSqlRow => ({
  id: 'd',
  document_type: 'cdl',
  expires_on: '2028-04-30',
  expires_precision: 'month',
  status: 'valid',
  driver_id: 'marcus',
  first_name: 'Marcus',
  last_name: 'Hale',
  ...over,
});

describe('toDriverDocumentDto', () => {
  it('maps the row and the driver name', () => {
    expect(toDriverDocumentDto(doc({ status: 'missing', expires_on: null }))).toEqual({
      id: 'd',
      driver: { id: 'marcus', fullName: 'Marcus Hale' },
      documentType: 'cdl',
      expiresOn: null,
      expiresPrecision: 'month',
      status: 'missing',
    });
  });
});

describe('summarizeDriverDocuments', () => {
  const windows = { asOf: '2026-09-03', expiringWindowEnd: '2026-11-02' };

  it('counts documents and distinct drivers, and lists expired and missing ones in list order', () => {
    const documents = [
      doc({ id: 'a', status: 'expiring' }),
      doc({ id: 'b', status: 'expired', driver_id: 'priya', first_name: 'Priya', last_name: 'Raman' }),
      doc({ id: 'c', status: 'missing', document_type: 'drug_test', driver_id: 'tobias', first_name: 'Tobias', last_name: 'Frey' }),
      doc({ id: 'd', status: 'expired', document_type: 'medical_card', driver_id: 'marcus' }),
    ].map(toDriverDocumentDto);
    expect(summarizeDriverDocuments(documents, windows)).toEqual({
      ...windows,
      documentCount: 4,
      driverCount: 3,
      expiringCount: 1,
      expired: [
        { driverDocumentId: 'b', driverId: 'priya', fullName: 'Priya Raman', documentType: 'cdl' },
        { driverDocumentId: 'd', driverId: 'marcus', fullName: 'Marcus Hale', documentType: 'medical_card' },
      ],
      missing: [{ driverDocumentId: 'c', driverId: 'tobias', fullName: 'Tobias Frey', documentType: 'drug_test' }],
    });
  });

  it('is all zero without documents', () => {
    expect(summarizeDriverDocuments([], windows)).toEqual({ ...windows, documentCount: 0, driverCount: 0, expiringCount: 0, expired: [], missing: [] });
  });
});

describe('reminder and violation rows', () => {
  it('map the driver and truck references', () => {
    expect(
      toComplianceReminderDto({ id: 'r', item_label: 'CDL renewal', due_on: '2026-07-31', due_precision: 'month', driver_id: 'p', first_name: 'Priya', last_name: 'Raman' }),
    ).toEqual({ id: 'r', driver: { id: 'p', fullName: 'Priya Raman' }, itemLabel: 'CDL renewal', dueOn: '2026-07-31', duePrecision: 'month' });
    expect(
      toViolationDto({
        id: 'v',
        occurred_on: '2026-08-31',
        violation_type: 'Log form & manner',
        severity_points: 1,
        location: 'I-70 POE · Loma, CO',
        status: 'open',
        driver_id: 't',
        first_name: 'Tobias',
        last_name: 'Frey',
        truck_id: 'k',
        unit_number: 'T-118',
        total_count: 7,
      }),
    ).toEqual({
      id: 'v',
      occurredOn: '2026-08-31',
      driver: { id: 't', fullName: 'Tobias Frey' },
      truck: { id: 'k', unitNumber: 'T-118' },
      violationType: 'Log form & manner',
      severityPoints: 1,
      location: 'I-70 POE · Loma, CO',
      status: 'open',
    });
  });
});
