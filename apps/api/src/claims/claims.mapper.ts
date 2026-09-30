import type { ClaimClaimant, ClaimRow } from '@runtruck/types';
import type { ClaimSqlRow } from './claims.repository.js';

// Pure mapping for GET /claims (docs/api/safety.md §6.1).

// By claimant_kind; claims_claimant_ck guarantees the matching column is set.
export function toClaimant(r: Pick<ClaimSqlRow, 'claimant_kind' | 'claimant_name' | 'customer_id' | 'customer_name' | 'facility_id' | 'facility_name'>): ClaimClaimant {
  switch (r.claimant_kind) {
    case 'customer':
      if (r.customer_id === null || r.customer_name === null) break;
      return { kind: 'customer', customerId: r.customer_id, name: r.customer_name };
    case 'facility':
      if (r.facility_id === null || r.facility_name === null) break;
      return { kind: 'facility', facilityId: r.facility_id, name: r.facility_name };
    case 'third_party':
      if (r.claimant_name === null) break;
      return { kind: 'third_party', name: r.claimant_name };
  }
  throw new Error('Claim without its claimant');
}

export function toClaimDto(r: ClaimSqlRow): ClaimRow {
  return {
    id: r.id,
    claimNumber: r.claim_number,
    occurredOn: r.occurred_on,
    driver: { id: r.driver_id, fullName: `${r.first_name} ${r.last_name}` },
    truck: { id: r.truck_id, unitNumber: r.truck_unit_number },
    trailer: r.trailer_id !== null && r.trailer_unit_number !== null ? { id: r.trailer_id, unitNumber: r.trailer_unit_number } : null,
    load: r.load_id !== null && r.load_number !== null ? { id: r.load_id, loadNumber: r.load_number } : null,
    claimType: r.claim_type,
    claimant: toClaimant(r),
    reservedCents: r.reserved_cents,
    paidCents: r.paid_cents,
    status: r.status,
  };
}
