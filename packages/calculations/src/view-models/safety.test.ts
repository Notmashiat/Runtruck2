import type { ClaimRow, ClaimsSummary, DriverDocumentRow, DriverDocumentsSummary, ViolationRow, ViolationsSummary, WorkOrderRow, WorkOrdersSummary } from '@runtruck/types';
import { describe, expect, it } from 'vitest';
import {
  claimKpis,
  driverDocumentKpis,
  formatClaimant,
  formatClaimUnit,
  formatComplianceDate,
  formatWorkOrderDue,
  toClaimRow,
  toDriverDocumentRow,
  toViolationRow,
  toWorkOrderRow,
  violationKpis,
  workOrderKpis,
} from './safety.js';

// The seed as the safety endpoints return it (docs/api/safety.md §2.5, §3.5, §5.5, §6.5),
// rendered through the builders and compared with Runtruck1's MAINTENANCE,
// DRIVER_DOCUMENTS, VIOLATIONS and CLAIMS (app/src/data/safety.ts) key for key, tagClass
// mapped to its chip tone.

const TAG_TONE = { 'tag-accent': 'blue', 'tag-neutral': 'gray', 'tag-outline': 'amber', 'tag-green': 'green' } as const;
type TagClass = keyof typeof TAG_TONE;

function asRuntruck1<T extends { ref: { tone: string } }>(vm: T): Omit<T, 'ref'> & { tagClass: TagClass } {
  const { ref, ...row } = vm;
  const tagClass = (Object.keys(TAG_TONE) as TagClass[]).find((k) => TAG_TONE[k] === ref.tone);
  if (!tagClass) throw new Error(`no tagClass for ${ref.tone}`);
  return { ...row, tagClass };
}

// ─── Maintenance ─────────────────────────────────────────────────────────

const SUNRIDGE = { facilityId: 'f1', name: 'Sunridge shop', city: 'Modesto' };
const THERMO = { facilityId: 'f2', name: 'Thermo King', city: 'Fresno' };
const VALLEY = { facilityId: 'f3', name: 'Valley Truck Center', city: 'Stockton' };

const WO: [WorkOrderRow['unit']['kind'], string, string, string | null, number | null, WorkOrderRow['shop'], number, WorkOrderRow['status']][] = [
  ['truck', 'T-118', 'Turbocharger replacement', '2026-09-05', null, SUNRIDGE, 485000, 'in_shop'],
  ['trailer', 'FB-12', 'DOT annual inspection', '2026-09-03', null, SUNRIDGE, 15000, 'in_shop'],
  ['truck', 'T-121', 'Brake adjustment', '2026-08-28', null, SUNRIDGE, 42000, 'overdue'],
  ['truck', 'T-114', 'PM service A', null, 529800, SUNRIDGE, 64000, 'due'],
  ['trailer', 'RF-27', 'Reefer unit service', '2026-09-12', null, THERMO, 71000, 'scheduled'],
  ['truck', 'T-107', 'DOT annual inspection', '2026-09-18', null, VALLEY, 18500, 'scheduled'],
  ['truck', 'T-103', 'Tire rotation', null, 342000, SUNRIDGE, 16000, 'scheduled'],
  ['truck', 'T-109', 'DOT annual inspection', '2026-08-22', null, VALLEY, 18500, 'done'],
];

const workOrders: WorkOrderRow[] = WO.map(([kind, unitNumber, item, dueOn, dueOdometer, shop, estimateCents, status], i) => ({
  id: `w${i}`,
  unit: { kind, id: `u${i}`, unitNumber },
  item,
  dueOn,
  dueOdometer,
  shop,
  estimateCents,
  status,
  completedOn: status === 'done' ? '2026-08-22' : null,
}));

const RUNTRUCK1_MAINTENANCE = [
  { unit: 'T-118', item: 'Turbocharger replacement', due: 'Sep 5', shop: 'Sunridge shop · Modesto', estimate: 4850, status: 'In shop', tagClass: 'tag-outline' },
  { unit: 'FB-12', item: 'DOT annual inspection', due: 'Sep 3', shop: 'Sunridge shop · Modesto', estimate: 150, status: 'In shop', tagClass: 'tag-outline' },
  { unit: 'T-121', item: 'Brake adjustment', due: 'Aug 28', shop: 'Sunridge shop · Modesto', estimate: 420, status: 'Overdue', tagClass: 'tag-outline' },
  { unit: 'T-114', item: 'PM service A', due: '529,800 mi', shop: 'Sunridge shop · Modesto', estimate: 640, status: 'Due', tagClass: 'tag-outline' },
  { unit: 'RF-27', item: 'Reefer unit service', due: 'Sep 12', shop: 'Thermo King · Fresno', estimate: 710, status: 'Scheduled', tagClass: 'tag-accent' },
  { unit: 'T-107', item: 'DOT annual inspection', due: 'Sep 18', shop: 'Valley Truck Center · Stockton', estimate: 185, status: 'Scheduled', tagClass: 'tag-accent' },
  { unit: 'T-103', item: 'Tire rotation', due: '342,000 mi', shop: 'Sunridge shop · Modesto', estimate: 160, status: 'Scheduled', tagClass: 'tag-accent' },
  { unit: 'T-109', item: 'DOT annual inspection', due: 'Aug 22', shop: 'Valley Truck Center · Stockton', estimate: 185, status: 'Done', tagClass: 'tag-neutral' },
];

describe('toWorkOrderRow', () => {
  it('reproduces every Runtruck1 MAINTENANCE row; estimate is whole dollars, the cents stay in ref', () => {
    const rows = workOrders.map(toWorkOrderRow);
    expect(rows.map(asRuntruck1)).toEqual(RUNTRUCK1_MAINTENANCE);
    expect(Object.keys(rows[0] ?? {})).toEqual(['unit', 'item', 'due', 'shop', 'estimate', 'status', 'ref']);
    expect(rows[0]?.ref).toEqual({ id: 'w0', tone: 'amber', estimateCents: 485000 });
  });

  it('formats a day, an odometer reading, or neither', () => {
    expect(formatWorkOrderDue('2026-09-05', null)).toBe('Sep 5');
    expect(formatWorkOrderDue(null, 529800)).toBe('529,800 mi');
    expect(formatWorkOrderDue(null, null)).toBe('—');
  });
});

describe('workOrderKpis', () => {
  const summary: WorkOrdersSummary = {
    asOf: '2026-09-03',
    doneWindowStart: '2026-08-04',
    workOrderCount: 8,
    openCount: 7,
    doneLast30dCount: 1,
    inShopCount: 2,
    inShopShops: [SUNRIDGE],
    overdue: [{ workOrderId: 'w2', unitNumber: 'T-121', item: 'Brake adjustment' }],
    openEstimateCents: 711500,
  };

  it('reproduces Runtruck1 KPIs', () => {
    expect(workOrderKpis(summary)).toEqual([
      { label: 'Open work orders', value: '7', note: '1 done · last 30 d' },
      { label: 'In shop', value: '2', note: 'Sunridge shop · Modesto' },
      { label: 'Overdue', value: '1', note: 'T-121 · Brake adjustment' },
      { label: 'Est. cost open', value: '$7,115', note: 'Parts & labor, open orders' },
    ]);
  });

  it('joins several shops and reads "None" for empty lists', () => {
    expect(workOrderKpis({ ...summary, inShopShops: [SUNRIDGE, THERMO] })[1]?.note).toBe('Sunridge shop · Modesto, Thermo King · Fresno');
    const empty = workOrderKpis({ ...summary, inShopCount: 0, inShopShops: [], overdue: [] });
    expect([empty[1]?.note, empty[2]?.note]).toEqual(['None', 'None']);
    expect(workOrderKpis(undefined).every((k) => k.value === '—' && k.note === undefined)).toBe(true);
  });
});

// ─── Driver documents ────────────────────────────────────────────────────

const DOCS: [string, DriverDocumentRow['documentType'], string | null, DriverDocumentRow['expiresPrecision'], DriverDocumentRow['status']][] = [
  ['Marcus Hale', 'cdl', '2028-04-30', 'month', 'valid'],
  ['Marcus Hale', 'medical_card', '2027-03-31', 'month', 'valid'],
  ['Marcus Hale', 'clearinghouse_query', '2026-09-20', 'day', 'expiring'],
  ['Dara Whitfield', 'cdl', '2027-11-30', 'month', 'valid'],
  ['Dara Whitfield', 'medical_card', '2027-06-30', 'month', 'valid'],
  ['Ellis Nakamura', 'cdl', '2027-02-28', 'month', 'valid'],
  ['Ellis Nakamura', 'medical_card', '2026-10-12', 'day', 'expiring'],
  ['Priya Raman', 'cdl', '2026-07-31', 'month', 'expired'],
  ['Priya Raman', 'medical_card', '2028-01-31', 'month', 'valid'],
  ['Ana Cortez', 'cdl', '2029-09-30', 'month', 'valid'],
  ['Ana Cortez', 'mvr', '2026-09-24', 'day', 'expiring'],
  ['Ana Cortez', 'annual_review', '2026-09-24', 'day', 'expiring'],
  ['Tobias Frey', 'cdl', '2028-01-31', 'month', 'valid'],
  ['Tobias Frey', 'medical_card', '2026-12-31', 'month', 'valid'],
  ['Tobias Frey', 'drug_test', null, 'month', 'missing'],
];

const documents: DriverDocumentRow[] = DOCS.map(([fullName, documentType, expiresOn, expiresPrecision, status], i) => ({
  id: `d${i}`,
  driver: { id: fullName, fullName },
  documentType,
  expiresOn,
  expiresPrecision,
  status,
}));

const RUNTRUCK1_DRIVER_DOCUMENTS = [
  { driver: 'Marcus Hale', document: 'CDL', expires: 'Apr 2028', status: 'Valid', tagClass: 'tag-green' },
  { driver: 'Marcus Hale', document: 'Medical card', expires: 'Mar 2027', status: 'Valid', tagClass: 'tag-green' },
  { driver: 'Marcus Hale', document: 'Clearinghouse query', expires: 'Sep 20', status: 'Expiring', tagClass: 'tag-outline' },
  { driver: 'Dara Whitfield', document: 'CDL', expires: 'Nov 2027', status: 'Valid', tagClass: 'tag-green' },
  { driver: 'Dara Whitfield', document: 'Medical card', expires: 'Jun 2027', status: 'Valid', tagClass: 'tag-green' },
  { driver: 'Ellis Nakamura', document: 'CDL', expires: 'Feb 2027', status: 'Valid', tagClass: 'tag-green' },
  { driver: 'Ellis Nakamura', document: 'Medical card', expires: 'Oct 12', status: 'Expiring', tagClass: 'tag-outline' },
  { driver: 'Priya Raman', document: 'CDL', expires: 'Jul 2026', status: 'Expired', tagClass: 'tag-outline' },
  { driver: 'Priya Raman', document: 'Medical card', expires: 'Jan 2028', status: 'Valid', tagClass: 'tag-green' },
  { driver: 'Ana Cortez', document: 'CDL', expires: 'Sep 2029', status: 'Valid', tagClass: 'tag-green' },
  { driver: 'Ana Cortez', document: 'MVR', expires: 'Sep 24', status: 'Expiring', tagClass: 'tag-outline' },
  { driver: 'Ana Cortez', document: 'Annual review', expires: 'Sep 24', status: 'Expiring', tagClass: 'tag-outline' },
  { driver: 'Tobias Frey', document: 'CDL', expires: 'Jan 2028', status: 'Valid', tagClass: 'tag-green' },
  { driver: 'Tobias Frey', document: 'Medical card', expires: 'Dec 2026', status: 'Valid', tagClass: 'tag-green' },
  { driver: 'Tobias Frey', document: 'Drug test', expires: '—', status: 'Missing', tagClass: 'tag-outline' },
];

describe('toDriverDocumentRow', () => {
  it('reproduces every Runtruck1 DRIVER_DOCUMENTS row, key for key', () => {
    const rows = documents.map(toDriverDocumentRow);
    expect(rows.map(asRuntruck1)).toEqual(RUNTRUCK1_DRIVER_DOCUMENTS);
    expect(Object.keys(rows[0] ?? {})).toEqual(['driver', 'document', 'expires', 'status', 'ref']);
  });

  it('formats by precision: a current-year month still shows its year', () => {
    expect(formatComplianceDate('2026-07-31', 'month')).toBe('Jul 2026');
    expect(formatComplianceDate('2026-09-20', 'day')).toBe('Sep 20');
    expect(formatComplianceDate(null, 'day')).toBe('—');
  });
});

describe('driverDocumentKpis', () => {
  const summary: DriverDocumentsSummary = {
    asOf: '2026-09-03',
    expiringWindowEnd: '2026-11-02',
    documentCount: 15,
    driverCount: 6,
    expiringCount: 4,
    expired: [{ driverDocumentId: 'd7', driverId: 'p', fullName: 'Priya Raman', documentType: 'cdl' }],
    missing: [{ driverDocumentId: 'd14', driverId: 't', fullName: 'Tobias Frey', documentType: 'drug_test' }],
  };

  it('reproduces Runtruck1 KPIs', () => {
    expect(driverDocumentKpis(summary)).toEqual([
      { label: 'Documents', value: '15', note: '6 drivers on file' },
      { label: 'Expiring (60 d)', value: '4', note: 'Renew before Nov 2' },
      { label: 'Expired', value: '1', note: 'Priya Raman · CDL' },
      { label: 'Missing', value: '1', note: 'Tobias Frey · Drug test' },
    ]);
  });

  it('reads "None" for empty lists and "—" while pending', () => {
    const empty = driverDocumentKpis({ ...summary, expired: [], missing: [] });
    expect([empty[2]?.note, empty[3]?.note]).toEqual(['None', 'None']);
    expect(driverDocumentKpis(undefined).every((k) => k.value === '—' && k.note === undefined)).toBe(true);
  });
});

// ─── Violations ──────────────────────────────────────────────────────────

const VIOLATION_SEED: [string, string, string, string, number, string, ViolationRow['status']][] = [
  ['2026-08-31', 'Tobias Frey', 'T-118', 'Log form & manner', 1, 'I-70 POE · Loma, CO', 'open'],
  ['2026-08-28', 'Ellis Nakamura', 'T-121', 'Brake adjustment', 4, 'I-5 scale · Cottonwood, CA', 'open'],
  ['2026-08-19', 'Marcus Hale', 'T-114', 'Hours-of-service', 7, 'US-95 POE · Winnemucca, NV', 'contested'],
  ['2026-07-30', 'Dara Whitfield', 'T-107', 'Lighting', 6, 'I-80 scale · Donner Pass, CA', 'closed'],
  ['2026-06-12', 'Tobias Frey', 'T-118', 'Speeding 6–10 over', 4, 'I-70 · Grand Junction, CO', 'closed'],
  ['2026-05-06', 'Ellis Nakamura', 'T-121', 'Log form & manner', 1, 'I-84 POE · Ontario, OR', 'closed'],
  ['2026-03-18', 'Ana Cortez', 'T-109', 'Lighting', 6, 'I-5 scale · Ashland, OR', 'closed'],
];

const violations: ViolationRow[] = VIOLATION_SEED.map(([occurredOn, fullName, unitNumber, violationType, severityPoints, location, status], i) => ({
  id: `v${i}`,
  occurredOn,
  driver: { id: fullName, fullName },
  truck: { id: unitNumber, unitNumber },
  violationType,
  severityPoints,
  location,
  status,
}));

const RUNTRUCK1_VIOLATIONS = [
  { date: 'Aug 31', driver: 'Tobias Frey', unit: 'T-118', type: 'Log form & manner', severityPoints: 1, location: 'I-70 POE · Loma, CO', status: 'Open', tagClass: 'tag-outline' },
  { date: 'Aug 28', driver: 'Ellis Nakamura', unit: 'T-121', type: 'Brake adjustment', severityPoints: 4, location: 'I-5 scale · Cottonwood, CA', status: 'Open', tagClass: 'tag-outline' },
  { date: 'Aug 19', driver: 'Marcus Hale', unit: 'T-114', type: 'Hours-of-service', severityPoints: 7, location: 'US-95 POE · Winnemucca, NV', status: 'Contested', tagClass: 'tag-accent' },
  { date: 'Jul 30', driver: 'Dara Whitfield', unit: 'T-107', type: 'Lighting', severityPoints: 6, location: 'I-80 scale · Donner Pass, CA', status: 'Closed', tagClass: 'tag-neutral' },
  { date: 'Jun 12', driver: 'Tobias Frey', unit: 'T-118', type: 'Speeding 6–10 over', severityPoints: 4, location: 'I-70 · Grand Junction, CO', status: 'Closed', tagClass: 'tag-neutral' },
  { date: 'May 6', driver: 'Ellis Nakamura', unit: 'T-121', type: 'Log form & manner', severityPoints: 1, location: 'I-84 POE · Ontario, OR', status: 'Closed', tagClass: 'tag-neutral' },
  { date: 'Mar 18', driver: 'Ana Cortez', unit: 'T-109', type: 'Lighting', severityPoints: 6, location: 'I-5 scale · Ashland, OR', status: 'Closed', tagClass: 'tag-neutral' },
];

describe('toViolationRow', () => {
  it('reproduces every Runtruck1 VIOLATIONS row, key for key (en dash kept)', () => {
    const rows = violations.map(toViolationRow);
    expect(rows.map(asRuntruck1)).toEqual(RUNTRUCK1_VIOLATIONS);
    expect(Object.keys(rows[0] ?? {})).toEqual(['date', 'driver', 'unit', 'type', 'severityPoints', 'location', 'status', 'ref']);
  });
});

describe('violationKpis', () => {
  const summary: ViolationsSummary = {
    asOf: '2026-09-03',
    pointsWindowStart: '2025-09-04',
    violationCount: 7,
    openCount: 2,
    contestedCount: 1,
    closedCount: 4,
    pointsInWindow: 29,
    violationsInWindowCount: 7,
  };

  it('reproduces Runtruck1 KPIs', () => {
    expect(violationKpis(summary)).toEqual([
      { label: 'Open', value: '2', note: 'Corrective action pending' },
      { label: 'Points (12 mo)', value: '29', note: 'CSA severity · 7 violations' },
      { label: 'Contested', value: '1', note: 'DataQ challenge filed' },
      { label: 'Closed', value: '4', note: 'Resolved, on file' },
    ]);
    expect(violationKpis(undefined).every((k) => k.value === '—' && k.note === undefined)).toBe(true);
  });
});

// ─── Claims ──────────────────────────────────────────────────────────────

const CLAIM_SEED: [number, string, string, string, string, ClaimRow['claimType'], ClaimRow['claimant'], number, number, ClaimRow['status']][] = [
  [1112, '2026-08-26', 'Ellis Nakamura', 'T-121', 'FB-12', 'cargo_damage', { kind: 'customer', customerId: 'c1', name: 'Cascade Building Supply' }, 680000, 0, 'open'],
  [1111, '2026-08-14', 'Marcus Hale', 'T-114', 'RF-88', 'cargo_damage', { kind: 'customer', customerId: 'c2', name: 'Northgate Foods' }, 420000, 0, 'under_review'],
  [1110, '2026-07-22', 'Dara Whitfield', 'T-107', 'DV-51', 'property_damage', { kind: 'facility', facilityId: 'f1', name: 'Wasatch Crossdock' }, 290000, 265000, 'settled'],
  [1109, '2026-06-30', 'Tobias Frey', 'T-118', 'DV-14', 'cargo_shortage', { kind: 'customer', customerId: 'c3', name: 'Sierra Ag Partners' }, 145000, 0, 'denied'],
  [1108, '2026-05-09', 'Ana Cortez', 'T-109', 'FB-04', 'bodily_injury', { kind: 'third_party', name: 'R. Delgado' }, 2500000, 1850000, 'settled'],
  [1107, '2026-03-03', 'Priya Raman', 'T-103', 'RF-27', 'cargo_damage', { kind: 'customer', customerId: 'c2', name: 'Northgate Foods' }, 310000, 287500, 'settled'],
];

const claims: ClaimRow[] = CLAIM_SEED.map(([claimNumber, occurredOn, fullName, truck, trailer, claimType, claimant, reservedCents, paidCents, status], i) => ({
  id: `k${i}`,
  claimNumber,
  occurredOn,
  driver: { id: fullName, fullName },
  truck: { id: truck, unitNumber: truck },
  trailer: { id: trailer, unitNumber: trailer },
  load: null,
  claimType,
  claimant,
  reservedCents,
  paidCents,
  status,
}));

const RUNTRUCK1_CLAIMS = [
  { id: 'CLM-1112', date: 'Aug 26', driver: 'Ellis Nakamura', unit: 'T-121 / FB-12', type: 'Cargo damage', claimant: 'Cascade Building Supply', reserved: 6800, paid: 0, status: 'Open', tagClass: 'tag-outline' },
  { id: 'CLM-1111', date: 'Aug 14', driver: 'Marcus Hale', unit: 'T-114 / RF-88', type: 'Cargo damage', claimant: 'Northgate Foods', reserved: 4200, paid: 0, status: 'Under review', tagClass: 'tag-accent' },
  { id: 'CLM-1110', date: 'Jul 22', driver: 'Dara Whitfield', unit: 'T-107 / DV-51', type: 'Property damage', claimant: 'Wasatch Crossdock', reserved: 2900, paid: 2650, status: 'Settled', tagClass: 'tag-green' },
  { id: 'CLM-1109', date: 'Jun 30', driver: 'Tobias Frey', unit: 'T-118 / DV-14', type: 'Cargo shortage', claimant: 'Sierra Ag Partners', reserved: 1450, paid: 0, status: 'Denied', tagClass: 'tag-neutral' },
  { id: 'CLM-1108', date: 'May 9', driver: 'Ana Cortez', unit: 'T-109 / FB-04', type: 'Bodily injury', claimant: 'Third party · R. Delgado', reserved: 25000, paid: 18500, status: 'Settled', tagClass: 'tag-green' },
  { id: 'CLM-1107', date: 'Mar 3', driver: 'Priya Raman', unit: 'T-103 / RF-27', type: 'Cargo damage', claimant: 'Northgate Foods', reserved: 3100, paid: 2875, status: 'Settled', tagClass: 'tag-green' },
];

describe('toClaimRow', () => {
  it('reproduces every Runtruck1 CLAIMS row; money is whole dollars, the cents stay in ref', () => {
    const rows = claims.map(toClaimRow);
    expect(rows.map(asRuntruck1)).toEqual(RUNTRUCK1_CLAIMS);
    expect(Object.keys(rows[0] ?? {})).toEqual(['id', 'date', 'driver', 'unit', 'type', 'claimant', 'reserved', 'paid', 'status', 'ref']);
    expect(rows[4]?.ref).toEqual({ id: 'k4', tone: 'green', reservedCents: 2500000, paidCents: 1850000 });
  });

  it('labels each claimant kind and a claim without a trailer', () => {
    expect(formatClaimant({ kind: 'customer', customerId: 'c', name: 'Northgate Foods' })).toBe('Northgate Foods');
    expect(formatClaimant({ kind: 'facility', facilityId: 'f', name: 'Wasatch Crossdock' })).toBe('Wasatch Crossdock');
    expect(formatClaimant({ kind: 'third_party', name: 'R. Delgado' })).toBe('Third party · R. Delgado');
    expect(formatClaimUnit({ id: 't', unitNumber: 'T-121' }, null)).toBe('T-121');
    expect(formatClaimUnit({ id: 't', unitNumber: 'T-121' }, { id: 'r', unitNumber: 'FB-12' })).toBe('T-121 / FB-12');
  });
});

describe('claimKpis', () => {
  const summary: ClaimsSummary = {
    asOf: '2026-09-03',
    ytdStart: '2026-01-01',
    claimCount: 6,
    openCount: 2,
    underReviewCount: 1,
    openReservedCents: 1100000,
    paidYtdCents: 2402500,
    paidYtdCount: 3,
    settledCount: 3,
    deniedCount: 1,
  };

  it('reproduces Runtruck1 KPIs', () => {
    expect(claimKpis(summary)).toEqual([
      { label: 'Open claims', value: '2', note: '1 under review' },
      { label: 'Reserved', value: '$11,000', note: 'On open claims' },
      { label: 'Paid YTD', value: '$24,025', note: '3 settlements' },
      { label: 'Settled', value: '3', note: '1 denied' },
    ]);
    expect(claimKpis(undefined).every((k) => k.value === '—' && k.note === undefined)).toBe(true);
  });
});
