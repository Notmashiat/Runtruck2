import { describe, expect, it } from 'vitest';
import { toClaimant, toClaimDto } from './claims.mapper.js';
import type { ClaimSqlRow } from './claims.repository.js';

const row: ClaimSqlRow = {
  id: 'k',
  claim_number: 1108,
  occurred_on: '2026-05-09',
  claim_type: 'bodily_injury',
  claimant_kind: 'third_party',
  claimant_name: 'R. Delgado',
  reserved_cents: 2500000,
  paid_cents: 1850000,
  status: 'settled',
  driver_id: 'a',
  first_name: 'Ana',
  last_name: 'Cortez',
  truck_id: 't',
  truck_unit_number: 'T-109',
  trailer_id: 'r',
  trailer_unit_number: 'FB-04',
  load_id: null,
  load_number: null,
  customer_id: null,
  customer_name: null,
  facility_id: null,
  facility_name: null,
  total_count: 6,
};

describe('toClaimDto', () => {
  it('maps the example item of docs/api/safety.md §6.5', () => {
    expect(toClaimDto(row)).toEqual({
      id: 'k',
      claimNumber: 1108,
      occurredOn: '2026-05-09',
      driver: { id: 'a', fullName: 'Ana Cortez' },
      truck: { id: 't', unitNumber: 'T-109' },
      trailer: { id: 'r', unitNumber: 'FB-04' },
      load: null,
      claimType: 'bodily_injury',
      claimant: { kind: 'third_party', name: 'R. Delgado' },
      reservedCents: 2500000,
      paidCents: 1850000,
      status: 'settled',
    });
  });

  it('maps an optional trailer and load', () => {
    const dto = toClaimDto({ ...row, trailer_id: null, trailer_unit_number: null, load_id: 'l', load_number: 40218 });
    expect([dto.trailer, dto.load]).toEqual([null, { id: 'l', loadNumber: 40218 }]);
  });
});

describe('toClaimant', () => {
  const none = { claimant_name: null, customer_id: null, customer_name: null, facility_id: null, facility_name: null };

  it('reads the column of each claimant kind', () => {
    expect(toClaimant({ ...none, claimant_kind: 'customer', customer_id: 'c', customer_name: 'Northgate Foods' })).toEqual({
      kind: 'customer',
      customerId: 'c',
      name: 'Northgate Foods',
    });
    expect(toClaimant({ ...none, claimant_kind: 'facility', facility_id: 'f', facility_name: 'Wasatch Crossdock' })).toEqual({
      kind: 'facility',
      facilityId: 'f',
      name: 'Wasatch Crossdock',
    });
    expect(toClaimant({ ...none, claimant_kind: 'third_party', claimant_name: 'R. Delgado' })).toEqual({ kind: 'third_party', name: 'R. Delgado' });
  });

  it('refuses a claim whose claimant column is missing', () => {
    expect(() => toClaimant({ ...none, claimant_kind: 'customer' })).toThrow();
  });
});
