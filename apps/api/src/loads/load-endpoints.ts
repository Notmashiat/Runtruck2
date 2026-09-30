import { type DbExecutor, schema } from '@runtruck/database';
import type { LoadStopKind, LoadStopStatus } from '@runtruck/types';
import { and, asc, eq, inArray } from 'drizzle-orm';

// The one place route labels are computed (docs/api/loads.md §8.5, 03 §6.0.3), shared
// with the dashboard, planner and fleet modules so that every "Fresno, CA → Reno, NV" is
// byte-identical. One statement per call (no N+1): the stops of the given loads with
// their facilities, reduced in memory.

const { facilities, loadStops } = schema;

// A stop row with the facility columns the labels need. Wall-clock times are HH:MM.
export interface LoadStopRow {
  id: string;
  loadId: string;
  sequence: number;
  kind: LoadStopKind;
  status: LoadStopStatus;
  facilityId: string | null;
  facilityName: string;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  timezone: string;
  appointmentDate: string;
  windowOpen: string | null;
  windowClose: string | null;
  plannedStart: string | null;
  plannedEnd: string | null;
  referenceNumber: string | null;
  siteContact: string | null;
  arrivedAt: Date | null;
  completedAt: Date | null;
  facility: { city: string; state: string; marketCity: string | null; marketState: string | null; marketShort: string | null } | null;
}

export interface LoadEndpointStop {
  stopId: string;
  sequence: number;
  facilityName: string;
  // address_line1, city, state joined ", " — no postal code (Runtruck1 `street()`).
  address: string;
  appointmentDate: string;
  // "Reno, NV": the facility market when the stop is a known facility, else the typed city.
  routeLabel: string;
  // "SLC": coalesce(market_short, market_city, city), else the stop city.
  shortMarket: string;
}

export interface LoadEndpoints {
  firstPickup: LoadEndpointStop | null;
  lastDelivery: LoadEndpointStop | null;
  // `${firstPickup.routeLabel} → ${lastDelivery.routeLabel}` (U+2192); null without stops.
  route: string | null;
}

const hhmm = (t: string | null): string | null => (t === null ? null : t.slice(0, 5));

// Every stop of the given loads, ORDER BY load, sequence (index load_stops_load_sequence_uq).
export async function queryLoadStopRows(db: DbExecutor, organizationId: string, loadIds: readonly string[]): Promise<LoadStopRow[]> {
  if (loadIds.length === 0) return [];
  const rows = await db
    .select({
      id: loadStops.id,
      loadId: loadStops.loadId,
      sequence: loadStops.sequence,
      kind: loadStops.kind,
      status: loadStops.status,
      facilityId: loadStops.facilityId,
      facilityName: loadStops.facilityName,
      addressLine1: loadStops.addressLine1,
      city: loadStops.city,
      state: loadStops.state,
      postalCode: loadStops.postalCode,
      timezone: loadStops.timezone,
      appointmentDate: loadStops.appointmentDate,
      windowOpen: loadStops.windowOpen,
      windowClose: loadStops.windowClose,
      plannedStart: loadStops.plannedStart,
      plannedEnd: loadStops.plannedEnd,
      referenceNumber: loadStops.referenceNumber,
      siteContact: loadStops.siteContact,
      arrivedAt: loadStops.arrivedAt,
      completedAt: loadStops.completedAt,
      fId: facilities.id,
      fCity: facilities.city,
      fState: facilities.state,
      fMarketCity: facilities.marketCity,
      fMarketState: facilities.marketState,
      fMarketShort: facilities.marketShort,
    })
    .from(loadStops)
    .leftJoin(facilities, and(eq(facilities.organizationId, loadStops.organizationId), eq(facilities.id, loadStops.facilityId)))
    .where(and(eq(loadStops.organizationId, organizationId), inArray(loadStops.loadId, [...loadIds])))
    .orderBy(asc(loadStops.loadId), asc(loadStops.sequence));

  return rows.map(({ fId, fCity, fState, fMarketCity, fMarketState, fMarketShort, ...s }) => ({
    ...s,
    windowOpen: hhmm(s.windowOpen),
    windowClose: hhmm(s.windowClose),
    plannedStart: hhmm(s.plannedStart),
    plannedEnd: hhmm(s.plannedEnd),
    facility:
      fId !== null && fCity !== null && fState !== null
        ? { city: fCity, state: fState, marketCity: fMarketCity, marketState: fMarketState, marketShort: fMarketShort }
        : null,
  }));
}

// 03 §6.0.3 "stop route label".
export function stopRouteLabel(stop: Pick<LoadStopRow, 'city' | 'state' | 'facility'>): string {
  if (stop.facility) return `${stop.facility.marketCity ?? stop.facility.city}, ${stop.facility.marketState ?? stop.facility.state}`;
  return `${stop.city ?? ''}, ${stop.state ?? ''}`;
}

// 03 §6.0.3 "stop short market".
export function stopShortMarket(stop: Pick<LoadStopRow, 'city' | 'facility'>): string {
  if (stop.facility) return stop.facility.marketShort ?? stop.facility.marketCity ?? stop.facility.city;
  return stop.city ?? '';
}

// address_line1, city, state joined ", " (Runtruck1 fromAddr / toAddr).
export function stopStreetAddress(stop: Pick<LoadStopRow, 'addressLine1' | 'city' | 'state'>): string {
  return [stop.addressLine1, stop.city, stop.state].filter((p): p is string => p !== null).join(', ');
}

// 03 §6.0.3 "stop address label": the street address, then " " + postal code; null when empty.
export function stopAddressLabel(stop: Pick<LoadStopRow, 'addressLine1' | 'city' | 'state' | 'postalCode'>): string | null {
  const street = stopStreetAddress(stop);
  const label = stop.postalCode ? `${street} ${stop.postalCode}`.trim() : street;
  return label === '' ? null : label;
}

function endpointOf(stop: LoadStopRow): LoadEndpointStop {
  return {
    stopId: stop.id,
    sequence: stop.sequence,
    facilityName: stop.facilityName,
    address: stopStreetAddress(stop),
    appointmentDate: stop.appointmentDate,
    routeLabel: stopRouteLabel(stop),
    shortMarket: stopShortMarket(stop),
  };
}

// First pickup (else the first stop) and last delivery (else the last stop) of one
// load's stops in sequence order (Runtruck1 toLoad).
export function endpointsOf(stops: readonly LoadStopRow[]): LoadEndpoints {
  const first = stops.find((s) => s.kind === 'pickup') ?? stops[0];
  const last = [...stops].reverse().find((s) => s.kind === 'delivery') ?? stops[stops.length - 1];
  const firstPickup = first ? endpointOf(first) : null;
  const lastDelivery = last ? endpointOf(last) : null;
  return {
    firstPickup,
    lastDelivery,
    route: firstPickup && lastDelivery ? `${firstPickup.routeLabel} → ${lastDelivery.routeLabel}` : null,
  };
}

// Groups stop rows (already ordered by load, sequence) per load.
export function groupStopsByLoad(rows: readonly LoadStopRow[]): Map<string, LoadStopRow[]> {
  const byLoad = new Map<string, LoadStopRow[]>();
  for (const row of rows) {
    const list = byLoad.get(row.loadId);
    if (list) list.push(row);
    else byLoad.set(row.loadId, [row]);
  }
  return byLoad;
}

// loadEndpoints(db, organizationId, loadIds) → Map<loadId, {firstPickup, lastDelivery, route}>
// (docs/api/loads.md §8.5). Loads without stops map to nulls.
export async function loadEndpoints(db: DbExecutor, organizationId: string, loadIds: readonly string[]): Promise<Map<string, LoadEndpoints>> {
  const byLoad = groupStopsByLoad(await queryLoadStopRows(db, organizationId, loadIds));
  return new Map(loadIds.map((id) => [id, endpointsOf(byLoad.get(id) ?? [])]));
}
