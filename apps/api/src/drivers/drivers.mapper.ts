import type { DriverListItem, DriverListSummary } from '@runtruck/types';
import type { DriverSqlRow } from './drivers.repository.js';

// Pure mapping and aggregation for GET /drivers (docs/api/fleet.md §2).

// "Hours at risk": an on-duty driver with less than two hours of drive time left
// (Runtruck1 hoursLeft < 2). A missing HOS reading is never at risk.
export const HOURS_AT_RISK_MINUTES = 120;

// A roster item plus the facts the summary needs but the item does not carry.
export interface DriverRecord {
  item: DriverListItem;
  lastName: string;
}

export function toDriverRecord(row: DriverSqlRow): DriverRecord {
  const currentLoad =
    row.load_id !== null && row.load_number !== null && row.load_status !== null && row.first_pickup_date !== null
      ? {
          id: row.load_id,
          loadNumber: row.load_number,
          status: row.load_status,
          firstPickupDate: row.first_pickup_date,
          originShort: row.origin_short,
          destinationShort: row.destination_short,
        }
      : null;
  return {
    lastName: row.last_name,
    item: {
      id: row.id,
      fullName: `${row.first_name} ${row.last_name}`,
      dutyStatus: row.duty_status,
      hosRemainingMinutes: row.hos_remaining_minutes,
      truck: row.truck_id !== null && row.unit_number !== null ? { id: row.truck_id, unitNumber: row.unit_number } : null,
      currentLoad,
      cdlExpiresOn: row.cdl_expires_on,
      // bigint sums of cents stay far below 2^53.
      payYtdCents: Number(row.pay_ytd),
      weekMiles: row.week_miles,
    },
  };
}

export function isHoursAtRisk(item: Pick<DriverListItem, 'dutyStatus' | 'hosRemainingMinutes'>): boolean {
  return item.dutyStatus === 'on_duty' && item.hosRemainingMinutes !== null && item.hosRemainingMinutes < HOURS_AT_RISK_MINUTES;
}

// KPI figures over every driver of the organization (never filtered by q or dutyStatus).
export function summarizeDrivers(
  records: readonly DriverRecord[],
  period: Pick<DriverListSummary, 'asOf' | 'weekStart' | 'weekEnd' | 'ytdStart'>,
): DriverListSummary {
  const items = records.map((r) => r.item);
  const onDutyCount = items.filter((d) => d.dutyStatus === 'on_duty').length;
  const availableCount = items.filter((d) => d.dutyStatus === 'available').length;
  return {
    ...period,
    rosterCount: items.length,
    onDutyCount,
    availableCount,
    // Runtruck1's formula; equals the home_time count while the enum has three values.
    homeTimeCount: items.length - onDutyCount - availableCount,
    hoursAtRisk: records
      .filter((r) => isHoursAtRisk(r.item))
      .map((r) => ({
        driverId: r.item.id,
        fullName: r.item.fullName,
        lastName: r.lastName,
        hosRemainingMinutes: r.item.hosRemainingMinutes ?? 0,
      })),
    totalWeekMiles: items.reduce((sum, d) => sum + d.weekMiles, 0),
    maxWeekMiles: items.reduce((max, d) => Math.max(max, d.weekMiles), 0),
  };
}
