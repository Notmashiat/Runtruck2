import type {
  LoadActivityEntry,
  LoadActivityKind,
  LoadBoardSummary,
  LoadDetail,
  LoadDispatch,
  LoadDispatchStatus,
  LoadDocument,
  LoadEquipmentType,
  LoadFreightClass,
  LoadListItem,
  LoadLtlService,
  LoadMode,
  LoadPackaging,
  LoadPaymentTerms,
  LoadStatus,
  LoadStop,
  LoadStopSummary,
} from '@runtruck/types';
import { LOAD_BOARD_VIEW_STATUSES, LOAD_BOARD_VIEWS } from '@runtruck/validation';
import { endpointsOf, stopAddressLabel, type LoadStopRow } from './load-endpoints.js';

// Row → DTO mapping for GET /loads and the load detail (docs/api/loads.md §1, §2, §4.1).
// Pure functions over the repository's rows, so every derived value (total, rate per
// mile, pay, margin, route, driver and unit labels) has one unit-tested definition (D5).

export interface LoadListRow {
  id: string;
  loadNumber: number;
  status: LoadStatus;
  customerId: string;
  customerName: string;
  tenderRef: string | null;
  customerPo: string | null;
  mode: LoadMode | null;
  equipmentType: LoadEquipmentType | null;
  commodity: string | null;
  weightLb: number | null;
  // numeric(4,1) arrives as a string ("-10.0").
  temperatureF: string | null;
  freightClass: string | null;
  handlingUnits: number | null;
  packaging: LoadPackaging | null;
  ltlServices: LoadLtlService[];
  lineHaulCents: number;
  fuelSurchargeCents: number;
  accessorialCents: number;
  loadedMiles: number | null;
  driverPayCents: number | null;
  carrierRateCents: number | null;
  operatingCostCents: number | null;
  driverInstructions: string | null;
  carrierId: string | null;
  carrierName: string | null;
  carrierMcNumber: string | null;
  carrierDotNumber: string | null;
  carrierIsOwnFleet: boolean | null;
  createdActivityAt: Date | null;
}

export interface LoadDetailRow extends LoadListRow {
  billToCustomerId: string | null;
  billToCustomerName: string | null;
  dispatcherName: string | null;
  pieces: number | null;
  declaredValueCents: number | null;
  hazmat: boolean;
  unNumber: string | null;
  nmfc: string | null;
  lengthIn: number | null;
  widthIn: number | null;
  heightIn: number | null;
  stackable: boolean;
  carrierContactName: string | null;
  carrierPhone: string | null;
  emptyMiles: number | null;
  paymentTerms: LoadPaymentTerms;
  internalNotes: string | null;
  archivedAt: Date | null;
  createdAt: Date;
  createdByUserId: string | null;
  createdByName: string | null;
}

// The live dispatch with the names of its driver, truck, trailer and assigner.
export interface DispatchRow {
  id: string;
  loadId: string;
  status: LoadDispatchStatus;
  driverId: string | null;
  truckId: string | null;
  trailerId: string | null;
  driverName: string | null;
  truckNumber: string | null;
  trailerNumber: string | null;
  assignedAt: Date;
  assignedByUserId: string | null;
  assignedByName: string | null;
  driverFirstName: string | null;
  driverLastName: string | null;
  truckUnit: string | null;
  trailerUnit: string | null;
}

export interface ActivityRow {
  id: string;
  sequence: number;
  occurredAt: Date;
  kind: LoadActivityKind;
  message: string;
  actorUserId: string | null;
  actorName: string | null;
}

// revenue(l) = line haul + fuel surcharge + accessorials (03 §6.0.3); ≤ INT4 by loads_total_ck.
export function totalCents(row: Pick<LoadListRow, 'lineHaulCents' | 'fuelSurchargeCents' | 'accessorialCents'>): number {
  return row.lineHaulCents + row.fuelSurchargeCents + row.accessorialCents;
}

// round(line_haul_cents / loaded_miles), half up; null without miles.
export function ratePerMileCents(lineHaulCents: number, loadedMiles: number | null): number | null {
  return loadedMiles !== null && loadedMiles > 0 ? Math.round(lineHaulCents / loadedMiles) : null;
}

// "Carrier cost" (partner rate) when set, else "Driver pay"; margin = total − pay − operating cost.
export function payAndMargin(row: Pick<LoadListRow, 'lineHaulCents' | 'fuelSurchargeCents' | 'accessorialCents' | 'carrierRateCents' | 'driverPayCents' | 'operatingCostCents'>): {
  payKind: 'carrier_cost' | 'driver_pay';
  payCents: number | null;
  marginCents: number | null;
} {
  const payKind = row.carrierRateCents !== null ? 'carrier_cost' : 'driver_pay';
  const payCents = row.carrierRateCents ?? row.driverPayCents;
  const marginCents = payCents === null ? null : totalCents(row) - payCents - (row.operatingCostCents ?? 0);
  return { payKind, payCents, marginCents };
}

// Driver label: the own driver's full name, else the partner's free-text driver.
export function dispatchDriverName(d: DispatchRow | null): string | null {
  if (!d) return null;
  if (d.driverFirstName !== null && d.driverLastName !== null) return `${d.driverFirstName} ${d.driverLastName}`;
  return d.driverName;
}

export function dispatchTruckUnit(d: DispatchRow): string | null {
  return d.truckUnit ?? d.truckNumber;
}

export function dispatchTrailerUnit(d: DispatchRow): string | null {
  return d.trailerUnit ?? d.trailerNumber;
}

// Unit label: truck and trailer joined " / "; null when neither is known.
export function dispatchUnit(d: DispatchRow | null): string | null {
  if (!d) return null;
  const unit = [dispatchTruckUnit(d), dispatchTrailerUnit(d)].filter((u): u is string => u !== null && u !== '').join(' / ');
  return unit === '' ? null : unit;
}

export function toStopSummary(s: LoadStopRow): LoadStopSummary {
  return {
    id: s.id,
    sequence: s.sequence,
    kind: s.kind,
    status: s.status,
    facilityName: s.facilityName,
    addressLabel: stopAddressLabel(s),
    appointmentDate: s.appointmentDate,
    windowOpen: s.windowOpen,
    windowClose: s.windowClose,
    timezone: s.timezone,
  };
}

export function toStop(s: LoadStopRow): LoadStop {
  return {
    ...toStopSummary(s),
    facilityId: s.facilityId,
    addressLine1: s.addressLine1,
    city: s.city,
    state: s.state,
    postalCode: s.postalCode,
    plannedStart: s.plannedStart,
    plannedEnd: s.plannedEnd,
    referenceNumber: s.referenceNumber,
    siteContact: s.siteContact,
    arrivedAt: s.arrivedAt?.toISOString() ?? null,
    completedAt: s.completedAt?.toISOString() ?? null,
  };
}

function ltlSummary(row: LoadListRow): LoadListItem['ltl'] {
  if (row.mode !== 'ltl' || row.freightClass === null || row.handlingUnits === null) return null;
  return { freightClass: row.freightClass as LoadFreightClass, handlingUnits: row.handlingUnits, packaging: row.packaging, services: [...row.ltlServices] };
}

// One board row (LoadListItem) from the load row, its stops (sequence order) and live dispatch.
export function toListItem(row: LoadListRow, stops: readonly LoadStopRow[], dispatch: DispatchRow | null): LoadListItem {
  const ends = endpointsOf(stops);
  return {
    id: row.id,
    loadNumber: row.loadNumber,
    status: row.status,
    customer: { id: row.customerId, name: row.customerName },
    reference: row.tenderRef ?? row.customerPo,
    route: ends.route,
    pickupDate: ends.firstPickup?.appointmentDate ?? null,
    deliveryDate: ends.lastDelivery?.appointmentDate ?? null,
    origin: ends.firstPickup ? { facilityName: ends.firstPickup.facilityName, address: ends.firstPickup.address } : null,
    destination: ends.lastDelivery ? { facilityName: ends.lastDelivery.facilityName, address: ends.lastDelivery.address } : null,
    driverName: dispatchDriverName(dispatch),
    unit: dispatchUnit(dispatch),
    carrier:
      row.carrierId !== null && row.carrierName !== null
        ? { id: row.carrierId, name: row.carrierName, mcNumber: row.carrierMcNumber, dotNumber: row.carrierDotNumber, isOwnFleet: row.carrierIsOwnFleet ?? false }
        : null,
    mode: row.mode,
    equipmentType: row.equipmentType,
    commodity: row.commodity,
    weightLb: row.weightLb,
    temperatureF: row.temperatureF === null ? null : Number(row.temperatureF),
    ltl: ltlSummary(row),
    lineHaulCents: row.lineHaulCents,
    totalCents: totalCents(row),
    loadedMiles: row.loadedMiles,
    ratePerMileCents: ratePerMileCents(row.lineHaulCents, row.loadedMiles),
    ...payAndMargin(row),
    carrierRateCents: row.carrierRateCents,
    driverInstructions: row.driverInstructions,
    createdActivityAt: row.createdActivityAt?.toISOString() ?? null,
    stops: stops.map(toStopSummary),
  };
}

export function toLoadDispatch(d: DispatchRow): LoadDispatch {
  return {
    id: d.id,
    status: d.status,
    driverId: d.driverId,
    truckId: d.truckId,
    trailerId: d.trailerId,
    driverName: dispatchDriverName(d),
    truckUnit: dispatchTruckUnit(d),
    trailerUnit: dispatchTrailerUnit(d),
    assignedAt: d.assignedAt.toISOString(),
    assignedBy: d.assignedByUserId !== null && d.assignedByName !== null ? { id: d.assignedByUserId, fullName: d.assignedByName } : null,
  };
}

export function toActivityEntry(a: ActivityRow): LoadActivityEntry {
  return {
    id: a.id,
    sequence: a.sequence,
    occurredAt: a.occurredAt.toISOString(),
    kind: a.kind,
    message: a.message,
    actor: a.actorUserId !== null && a.actorName !== null ? { id: a.actorUserId, fullName: a.actorName } : null,
  };
}

export function toDetail(
  row: LoadDetailRow,
  stops: readonly LoadStopRow[],
  dispatch: DispatchRow | null,
  documents: LoadDocument[] | null,
  activity: readonly ActivityRow[],
): LoadDetail {
  const item = toListItem(row, stops, dispatch);
  return {
    ...item,
    billToCustomer: row.billToCustomerId !== null && row.billToCustomerName !== null ? { id: row.billToCustomerId, name: row.billToCustomerName } : null,
    tenderRef: row.tenderRef,
    customerPo: row.customerPo,
    dispatcherName: row.dispatcherName,
    pieces: row.pieces,
    packaging: row.packaging,
    declaredValueCents: row.declaredValueCents,
    hazmat: row.hazmat,
    unNumber: row.unNumber,
    ltl: item.ltl ? { ...item.ltl, nmfc: row.nmfc, lengthIn: row.lengthIn, widthIn: row.widthIn, heightIn: row.heightIn, stackable: row.stackable } : null,
    carrierContactName: row.carrierContactName,
    carrierPhone: row.carrierPhone,
    fuelSurchargeCents: row.fuelSurchargeCents,
    accessorialCents: row.accessorialCents,
    emptyMiles: row.emptyMiles,
    driverPayCents: row.driverPayCents,
    operatingCostCents: row.operatingCostCents,
    paymentTerms: row.paymentTerms,
    internalNotes: row.internalNotes,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdByUserId !== null && row.createdByName !== null ? { id: row.createdByUserId, fullName: row.createdByName } : null,
    dispatch: dispatch ? toLoadDispatch(dispatch) : null,
    stops: stops.map(toStop),
    documents,
    activity: activity.map(toActivityEntry),
  };
}

// meta.summary of GET /loads from `status, count(*)` over board loads (§3.1).
export function boardSummary(counts: readonly { status: LoadStatus; count: number }[]): LoadBoardSummary {
  const of = (status: LoadStatus) => counts.find((c) => c.status === status)?.count ?? 0;
  const views = Object.fromEntries(
    LOAD_BOARD_VIEWS.map((view) => [view, LOAD_BOARD_VIEW_STATUSES[view].reduce((n, status) => n + of(status), 0)]),
  ) as LoadBoardSummary['views'];
  return { undispatched: of('needs_driver'), inTransit: of('in_transit'), delivered: of('delivered'), needsPod: of('needs_pod'), views };
}
