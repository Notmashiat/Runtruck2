import type { WorkOrderRow, WorkOrderUnit } from '@runtruck/types';
import type { WorkOrderSqlRow } from './maintenance.repository.js';

// Pure mapping for GET /work-orders (docs/api/safety.md §2.1).

// The unit is the truck when truck_id is set, else the trailer (work_orders_unit_ck
// guarantees exactly one).
export function toWorkOrderUnit(r: Pick<WorkOrderSqlRow, 'truck_id' | 'truck_unit_number' | 'trailer_id' | 'trailer_unit_number'>): WorkOrderUnit {
  if (r.truck_id !== null && r.truck_unit_number !== null) return { kind: 'truck', id: r.truck_id, unitNumber: r.truck_unit_number };
  if (r.trailer_id !== null && r.trailer_unit_number !== null) return { kind: 'trailer', id: r.trailer_id, unitNumber: r.trailer_unit_number };
  throw new Error('Work order without a unit');
}

export function toWorkOrderDto(r: WorkOrderSqlRow): WorkOrderRow {
  return {
    id: r.id,
    unit: toWorkOrderUnit(r),
    item: r.item,
    dueOn: r.due_on,
    dueOdometer: r.due_odometer,
    shop: { facilityId: r.shop_id, name: r.shop_name, city: r.shop_city },
    estimateCents: r.estimate_cents,
    status: r.status,
    completedOn: r.completed_on,
  };
}
