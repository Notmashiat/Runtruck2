// fleet view-model builders and label/tone maps: turn API DTOs into Runtruck1-shaped
// display rows. Shared by the web (rendering + live search) and the API (server-side q)
// so both match identically (docs/03-database.md §1.11). Specified in docs/api/fleet.md.
//
// Row convention (fleet.md §5): every table row has exactly the Runtruck1 mock row's keys
// (minus tagClass) with the same display strings, plus `ref`, an object that matchesQuery
// never searches (ids, enum values and tones can therefore never match a query).

import type {
  ComplianceReminderRow,
  DriverCurrentLoad,
  DriverDutyStatus,
  DriverListItem,
  DriverListSummary,
  TrailerListItem,
  TrailerListSummary,
  TrailerLocation,
  TrailerStatus,
  TrailerType,
  TruckListItem,
  TruckListSummary,
  TruckStatus,
} from '@runtruck/types';
import { EM_DASH, formatHos, formatInt, formatLoadNumber, formatMmYyyy, formatMoney, formatMonthYear, formatShortDate } from '../format.js';

// Chip tones of @runtruck/ui's Tag (presentation only).
type Tone = 'blue' | 'gray' | 'amber' | 'green';

// One KPI card (@runtruck/ui Kpi without onClick). While the data is pending or refused
// the value is "—" and there is no note (implementation-brief §4).
interface KpiVm {
  label: string;
  value: string;
  note?: string;
}

// ---------------------------------------------------------------------------
// Label and tone maps (fleet.md §5)

export const DUTY_LABEL: Record<DriverDutyStatus, string> = { on_duty: 'On duty', available: 'Available', home_time: 'Home time' };
export const DUTY_TONE: Record<DriverDutyStatus, Tone> = { on_duty: 'blue', available: 'gray', home_time: 'gray' };

export const TRUCK_STATUS_LABEL: Record<TruckStatus, string> = { in_service: 'In service', service_due: 'Service due', in_shop: 'In shop' };
export const TRUCK_STATUS_TONE: Record<TruckStatus, Tone> = { in_service: 'blue', service_due: 'amber', in_shop: 'amber' };

export const TRAILER_TYPE_LABEL: Record<TrailerType, string> = { reefer: 'Reefer', dry_van: 'Dry van', flatbed: 'Flatbed' };
export const TRAILER_STATUS_LABEL: Record<TrailerStatus, string> = { loaded: 'Loaded', empty: 'Empty', inspection: 'Inspection' };
export const TRAILER_STATUS_TONE: Record<TrailerStatus, Tone> = { loaded: 'blue', empty: 'gray', inspection: 'amber' };

const PENDING = EM_DASH;

// ---------------------------------------------------------------------------
// Fleet › Drivers (fleet.md §5.1)

/** Runtruck1 `Driver` row. `miles` stays a raw number, searched as its digits. */
export interface DriverRowVm {
  name: string;
  status: string;
  unit: string;
  load: string;
  hos: string;
  cdl: string;
  pay: string;
  miles: number;
  ref: { id: string; dutyStatus: DriverDutyStatus; tone: Tone };
}

// "L-40218 · Fresno → Reno" while in progress; "L-40222 · Sep 5" while only dispatched; "—" without one.
export function formatDriverCurrentLoad(load: DriverCurrentLoad | null): string {
  if (load === null) return EM_DASH;
  const number = formatLoadNumber(load.loadNumber);
  if (load.status === 'dispatched') return `${number} · ${formatShortDate(load.firstPickupDate)}`;
  return `${number} · ${load.originShort ?? EM_DASH} → ${load.destinationShort ?? EM_DASH}`;
}

export function toDriverRow(d: DriverListItem): DriverRowVm {
  return {
    name: d.fullName,
    status: DUTY_LABEL[d.dutyStatus],
    unit: d.truck?.unitNumber ?? EM_DASH,
    load: formatDriverCurrentLoad(d.currentLoad),
    hos: formatHos(d.hosRemainingMinutes),
    cdl: d.cdlExpiresOn ? formatMmYyyy(d.cdlExpiresOn) : EM_DASH,
    pay: formatMoney(d.payYtdCents),
    miles: d.weekMiles,
    ref: { id: d.id, dutyStatus: d.dutyStatus, tone: DUTY_TONE[d.dutyStatus] },
  };
}

// The Drivers KPI row. `remindersTotal` is meta.total of GET /compliance-reminders
// (decision F1); undefined while that read is pending or refused.
export function driverKpis(summary: DriverListSummary | undefined, remindersTotal: number | undefined): KpiVm[] {
  const docs: KpiVm =
    remindersTotal === undefined
      ? { label: 'Docs to renew', value: PENDING }
      : { label: 'Docs to renew', value: String(remindersTotal), note: 'On the watchlist below' };
  if (!summary) {
    return [
      { label: 'On the roster', value: PENDING },
      { label: 'Available now', value: PENDING },
      { label: 'Hours at risk', value: PENDING },
      docs,
    ];
  }
  return [
    {
      label: 'On the roster',
      value: String(summary.rosterCount),
      note: `${summary.onDutyCount} on duty · ${summary.homeTimeCount} home time`,
    },
    { label: 'Available now', value: String(summary.availableCount), note: 'Both reset today' },
    {
      label: 'Hours at risk',
      value: String(summary.hoursAtRisk.length),
      note: summary.hoursAtRisk.map((d) => `${d.lastName} · ${formatHos(d.hosRemainingMinutes)}`).join(', ') || 'Nobody under 2h',
    },
    docs,
  ];
}

/** Runtruck1 `WatchItem` (the Drivers tab "Compliance watchlist"; docs/api/safety.md §7.3). */
export interface DriverWatchlistRowVm {
  name: string;
  item: string;
  due: string;
  ref: { id: string };
}

export function toDriverWatchlistRow(r: ComplianceReminderRow): DriverWatchlistRowVm {
  return {
    name: r.driver.fullName,
    item: r.itemLabel,
    due: r.duePrecision === 'day' ? formatShortDate(r.dueOn) : formatMonthYear(r.dueOn),
    ref: { id: r.id },
  };
}

// ---------------------------------------------------------------------------
// Fleet › Trucks (fleet.md §5.2)

/** Runtruck1 `Truck` row. */
export interface TruckRowVm {
  unit: string;
  make: string;
  plate: string;
  driver: string;
  odo: string;
  service: string;
  status: string;
  ref: { id: string; tone: Tone };
}

export function toTruckRow(t: TruckListItem): TruckRowVm {
  return {
    unit: t.unitNumber,
    make: `${t.make} ${t.model} · ${t.modelYear}`,
    plate: `${t.plateState} ${t.plateNumber}`,
    driver: t.assignedDriver?.fullName ?? EM_DASH,
    odo: formatInt(t.odometerMiles),
    service: t.nextServiceMiles === null ? EM_DASH : formatInt(t.nextServiceMiles),
    status: TRUCK_STATUS_LABEL[t.status],
    ref: { id: t.id, tone: TRUCK_STATUS_TONE[t.status] },
  };
}

// Runtruck1's expressions verbatim, NaN edge cases included (decision F4, D6):
// an empty fleet prints "Avg NaNK mi", a missing next-service reading "T-114 in NaN mi".
export function truckKpis(summary: TruckListSummary | undefined): KpiVm[] {
  if (!summary) {
    return ['Power units', 'In service', 'In shop', 'Service due'].map((label) => ({ label, value: PENDING }));
  }
  const { inShopUnitNumbers: inShop, serviceDue } = summary;
  return [
    {
      label: 'Power units',
      value: String(summary.truckCount),
      note: `Avg ${Math.round((summary.averageOdometerMiles ?? NaN) / 1000)}K mi`,
    },
    { label: 'In service', value: String(summary.inServiceCount), note: `Of ${summary.truckCount} units` },
    { label: 'In shop', value: String(inShop.length), note: inShop.length ? `${inShop.join(', ')} · turbo` : 'Bays clear' },
    {
      label: 'Service due',
      value: String(serviceDue.length),
      note: serviceDue.map((s) => `${s.unitNumber} in ${formatInt(s.milesUntilService ?? NaN)} mi`).join(', ') || 'Nothing due',
    },
  ];
}

// ---------------------------------------------------------------------------
// Fleet › Trailers (fleet.md §5.3)

/** Runtruck1 `Trailer` row. */
export interface TrailerRowVm {
  unit: string;
  kind: string;
  status: string;
  where: string;
  ref: { id: string; tone: Tone };
}

// "Yard · Modesto", "En route · I-80", "Bakersfield, CA".
export function formatTrailerLocation(location: TrailerLocation): string {
  switch (location.kind) {
    case 'yard':
      return `Yard · ${location.city}`;
    case 'en_route':
      return `En route · ${location.route}`;
    case 'city':
      return `${location.city}, ${location.state}`;
  }
}

export function toTrailerRow(t: TrailerListItem): TrailerRowVm {
  return {
    unit: t.unitNumber,
    kind: `${TRAILER_TYPE_LABEL[t.trailerType]} · ${t.lengthFt} ft`,
    status: TRAILER_STATUS_LABEL[t.status],
    where: formatTrailerLocation(t.location),
    ref: { id: t.id, tone: TRAILER_STATUS_TONE[t.status] },
  };
}

export function trailerKpis(summary: TrailerListSummary | undefined): KpiVm[] {
  if (!summary) {
    return ['Trailers', 'Loaded', 'Empty', 'Inspection'].map((label) => ({ label, value: PENDING }));
  }
  const { typeCounts, inspectionUnitNumbers: inspection } = summary;
  return [
    {
      label: 'Trailers',
      value: String(summary.trailerCount),
      note: `${typeCounts.reefer} reefer · ${typeCounts.dry_van} dry van · ${typeCounts.flatbed} flatbed`,
    },
    {
      label: 'Loaded',
      value: String(summary.loadedCount),
      note: `${summary.rollingCount} rolling · ${summary.atShippersCount} at shippers`,
    },
    { label: 'Empty', value: String(summary.emptyCount), note: `${summary.emptyAtYardCount} at the Modesto yard` },
    {
      label: 'Inspection',
      value: String(inspection.length),
      note: inspection.length ? `${inspection.join(', ')} · annual DOT` : 'None pending',
    },
  ];
}
