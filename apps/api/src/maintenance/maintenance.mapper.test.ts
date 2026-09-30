import { describe, expect, it } from 'vitest';
import { toWorkOrderDto, toWorkOrderUnit } from './maintenance.mapper.js';
import type { WorkOrderSqlRow } from './maintenance.repository.js';

const row: WorkOrderSqlRow = {
  id: 'w',
  item: 'PM service A',
  due_on: null,
  due_odometer: 529800,
  estimate_cents: 64000,
  status: 'due',
  completed_on: null,
  truck_id: 't',
  truck_unit_number: 'T-114',
  trailer_id: null,
  trailer_unit_number: null,
  shop_id: 'f',
  shop_name: 'Sunridge shop',
  shop_city: 'Modesto',
  total_count: 8,
};

describe('toWorkOrderDto', () => {
  it('maps a truck work order (docs/api/safety.md §2.1)', () => {
    expect(toWorkOrderDto(row)).toEqual({
      id: 'w',
      unit: { kind: 'truck', id: 't', unitNumber: 'T-114' },
      item: 'PM service A',
      dueOn: null,
      dueOdometer: 529800,
      shop: { facilityId: 'f', name: 'Sunridge shop', city: 'Modesto' },
      estimateCents: 64000,
      status: 'due',
      completedOn: null,
    });
  });

  it('takes the trailer when there is no truck, and refuses a unit-less row', () => {
    expect(toWorkOrderUnit({ truck_id: null, truck_unit_number: null, trailer_id: 'r', trailer_unit_number: 'FB-12' })).toEqual({
      kind: 'trailer',
      id: 'r',
      unitNumber: 'FB-12',
    });
    expect(() => toWorkOrderUnit({ truck_id: null, truck_unit_number: null, trailer_id: null, trailer_unit_number: null })).toThrow();
  });
});
