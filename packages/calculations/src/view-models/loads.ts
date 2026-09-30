// loads view-model builders and label/tone maps: turn API DTOs into Runtruck1-shaped
// display rows. Shared by the web (rendering + live search) and the API (server-side q)
// so both match identically (docs/03-database.md §1.11). Specified in docs/api/loads.md
// (§8.1.3 view-model row, §8.2.2 detail values, §10 item 1).

import type {
  LoadCarrierRef,
  LoadDocumentStatus,
  LoadDocumentType,
  LoadEquipmentType,
  LoadListItem,
  LoadLtlService,
  LoadLtlSummary,
  LoadMode,
  LoadPackaging,
  LoadPaymentTerms,
  LoadStatus,
  LoadStopKind,
  LoadStopStatus,
  LoadStopSummary,
} from '@runtruck/types';
import { EM_DASH, formatActivityTime, formatInt, formatLoadNumber, formatMoney, formatMoneyOrDash, formatRatePerMile, formatShortDate } from '../format.js';

// Chip tones (the same values as @runtruck/ui `Tone`; Runtruck1 tagClass → chip colour).
export type LoadTone = 'blue' | 'gray' | 'amber' | 'green';

// Runtruck1's status labels, 1:1 with `load_status` (docs/08 §1).
export const LOAD_STATUS_LABEL: Readonly<Record<LoadStatus, string>> = {
  needs_driver: 'Needs driver',
  dispatched: 'Dispatched',
  at_pickup: 'At pickup',
  in_transit: 'In transit',
  delayed: 'Delayed',
  needs_pod: 'Needs POD',
  delivered: 'Delivered',
};

// tag-accent → blue, tag-neutral → gray, tag-outline → amber (core-pages §1.4, §9.2).
export const LOAD_STATUS_TONE: Readonly<Record<LoadStatus, LoadTone>> = {
  needs_driver: 'amber',
  dispatched: 'gray',
  at_pickup: 'gray',
  in_transit: 'blue',
  delayed: 'amber',
  needs_pod: 'amber',
  delivered: 'gray',
};

// Detail "Mode" row and search key `mode` (Runtruck1 toLoad).
export const LOAD_MODE_LABEL: Readonly<Record<LoadMode, string>> = {
  ftl: 'Full truckload',
  ltl: 'Less than truckload',
  partial: 'Partial',
};

// New Load's "Mode" segmented choice.
export const LOAD_MODE_CHOICE: Readonly<Record<LoadMode, 'FTL' | 'LTL' | 'Partial'>> = {
  ftl: 'FTL',
  ltl: 'LTL',
  partial: 'Partial',
};

export const LOAD_EQUIPMENT_LABEL: Readonly<Record<LoadEquipmentType, string>> = {
  dry_van_53: 'Dry van, 53 ft',
  reefer_53: 'Reefer, 53 ft',
  flatbed_48: 'Flatbed, 48 ft',
  flatbed_tarped: 'Flatbed, tarped',
  step_deck_48: 'Step deck, 48 ft',
  power_only: 'Power only',
  box_truck_26: 'Box truck, 26 ft',
};

export const LOAD_PACKAGING_LABEL: Readonly<Record<LoadPackaging, string>> = {
  pallets: 'Pallets',
  skids: 'Skids',
  crates: 'Crates',
  boxes: 'Boxes',
  drums: 'Drums',
  totes: 'Totes',
  loose: 'Loose',
};

export const LOAD_LTL_SERVICE_LABEL: Readonly<Record<LoadLtlService, string>> = {
  liftgate_pickup: 'Liftgate at pickup',
  liftgate_delivery: 'Liftgate at delivery',
  residential_delivery: 'Residential delivery',
  inside_delivery: 'Inside delivery',
  delivery_appointment: 'Delivery appointment',
  limited_access: 'Limited access',
};

// New Load "Payment terms" (Runtruck1 TERMS).
export const LOAD_PAYMENT_TERMS_LABEL: Readonly<Record<LoadPaymentTerms, string>> = {
  net_15: 'Net 15',
  net_30: 'Net 30',
  net_45: 'Net 45',
  net_60: 'Net 60',
  quick_pay: 'Quick pay',
};

// Runtruck1 DOCUMENTS names (load detail "Documents" card, New Load "Documents").
export const LOAD_DOCUMENT_TYPE_LABEL: Readonly<Record<LoadDocumentType, string>> = {
  rate_confirmation: 'Rate confirmation',
  customer_load_tender: 'Customer load tender',
  bill_of_lading: 'Bill of lading',
  proof_of_delivery: 'Proof of delivery',
  lumper_receipt: 'Lumper receipt',
};

// "Attached" (tag-green) / "Pending" (tag-outline → amber).
export const LOAD_DOCUMENT_STATUS_LABEL: Readonly<Record<LoadDocumentStatus, string>> = {
  pending: 'Pending',
  attached: 'Attached',
};

export const LOAD_DOCUMENT_STATUS_TONE: Readonly<Record<LoadDocumentStatus, LoadTone>> = {
  pending: 'amber',
  attached: 'green',
};

// ---------------------------------------------------------------------------
// Stops (03 §6.0.5)

// Detail-page kind label from kind + stop status.
export function stopKindLabel(kind: LoadStopKind, status: LoadStopStatus): string {
  if (kind === 'fuel') return 'Fuel stop';
  if (kind === 'pickup') {
    if (status === 'arrived') return 'Pickup · at shipper';
    if (status === 'completed') return 'Pickup · complete';
    return 'Pickup';
  }
  return status === 'completed' ? 'Delivery · complete' : 'Delivery';
}

// The CSS modifier of `.ui-stop-kind`: pickup / delivery / none for a fuel stop.
export function stopKindClass(kind: LoadStopKind): '' | 'pickup' | 'delivery' {
  return kind === 'fuel' ? '' : kind;
}

// Appointment window: "08:00–14:00" (U+2013) when both ends are set, else the one set,
// else "Any time" (Runtruck1 toLoad `when`).
export function stopWindow(open: string | null, close: string | null): string {
  if (open && close) return `${open}–${close}`;
  return open ?? close ?? 'Any time';
}

// "Sep 3 · 08:00–14:00" — the stop time line of the detail page and the board expand row.
export function stopTimeLine(stop: Pick<LoadStopSummary, 'appointmentDate' | 'windowOpen' | 'windowClose'>): string {
  return `${formatShortDate(stop.appointmentDate)} · ${stopWindow(stop.windowOpen, stop.windowClose)}`;
}

// The board expand row lists only pickups and deliveries (Runtruck1 stopsOf).
export function boardStops<S extends Pick<LoadStopSummary, 'kind'>>(stops: readonly S[]): S[] {
  return stops.filter((s) => s.kind !== 'fuel');
}

// ---------------------------------------------------------------------------
// Display compositions (03 §6.0.3)

// "Sunridge Freight (own fleet)" / "Valley Line Transport" / "Not yet covered".
export function loadCarrierName(carrier: LoadCarrierRef | null): string {
  if (carrier === null) return 'Not yet covered';
  return carrier.isOwnFleet ? `${carrier.name} (own fleet)` : carrier.name;
}

export function loadCarrierMc(carrier: LoadCarrierRef | null): string {
  return carrier?.mcNumber ? `MC ${carrier.mcNumber}` : EM_DASH;
}

export function loadCarrierDot(carrier: LoadCarrierRef | null): string {
  return carrier?.dotNumber ? `DOT ${carrier.dotNumber}` : EM_DASH;
}

// "-10 °F" / "Set at pickup" on reefer equipment, "Ambient" otherwise.
export function loadTemperature(equipmentType: LoadEquipmentType | null, temperatureF: number | null): string {
  if (equipmentType !== 'reefer_53') return 'Ambient';
  return temperatureF !== null ? `${temperatureF} °F` : 'Set at pickup';
}

// "Class 70 · 4 pallets · Liftgate at delivery · Delivery appointment" (services in click order).
export function loadLtlText(ltl: LoadLtlSummary): string {
  const units = ltl.packaging ? `${ltl.handlingUnits} ${LOAD_PACKAGING_LABEL[ltl.packaging].toLowerCase()}` : String(ltl.handlingUnits);
  return [`Class ${ltl.freightClass}`, units, ...ltl.services.map((s) => LOAD_LTL_SERVICE_LABEL[s])].join(' · ');
}

// ---------------------------------------------------------------------------
// The view-model row (§8.1.3): exactly Runtruck1's `Load` keys and display strings, so
// `matchesQuery` over it behaves like Runtruck1's search. No uuid or other string key
// Runtruck1 lacked; the DTO rides along under `load` (an object, never searched).

export interface LoadSearchRow {
  id: string;
  customer: string;
  route: string;
  pickup: string;
  delivery: string;
  driver: string;
  unit: string;
  rate: string;
  status: string;
  // Presentation (skipped by matchesQuery, like Runtruck1's tagClass).
  tone: LoadTone;
  miles: string;
  rpm: string;
  pay: string;
  margin: string;
  commodity: string;
  weight: string;
  equip: string;
  temp: string;
  ref: string;
  from: string;
  fromAddr: string;
  to: string;
  toAddr: string;
  carrier: string;
  carrierMc: string;
  carrierDot: string;
  // Only on loads that have them (created with New Load).
  mode?: string;
  ltl?: string;
  carrierRate?: string;
  notes?: string;
  createdAt?: string;
  // Not searched (arrays and objects are skipped).
  stops: LoadStopSummary[];
  load: LoadListItem;
}

export interface LoadRowContext {
  // The organization's IANA timezone and business date (MeResponse / ClockService).
  timeZone: string;
  today: string;
}

export function toLoadSearchRow<T extends LoadListItem>(item: T, ctx: LoadRowContext): LoadSearchRow & { load: T } {
  const row: LoadSearchRow & { load: T } = {
    id: formatLoadNumber(item.loadNumber),
    customer: item.customer.name,
    route: item.route ?? EM_DASH,
    pickup: item.pickupDate ? formatShortDate(item.pickupDate) : EM_DASH,
    delivery: item.deliveryDate ? formatShortDate(item.deliveryDate) : EM_DASH,
    driver: item.driverName ?? 'Unassigned',
    unit: item.unit ?? EM_DASH,
    rate: formatMoney(item.lineHaulCents),
    status: LOAD_STATUS_LABEL[item.status],
    tone: LOAD_STATUS_TONE[item.status],
    miles: item.loadedMiles !== null && item.loadedMiles > 0 ? formatInt(item.loadedMiles) : EM_DASH,
    rpm: formatRatePerMile(item.ratePerMileCents),
    pay: formatMoneyOrDash(item.payCents),
    margin: formatMoneyOrDash(item.marginCents),
    commodity: item.commodity ?? EM_DASH,
    weight: item.weightLb !== null ? `${formatInt(item.weightLb)} lb` : EM_DASH,
    equip: item.equipmentType ? LOAD_EQUIPMENT_LABEL[item.equipmentType] : EM_DASH,
    temp: loadTemperature(item.equipmentType, item.temperatureF),
    ref: item.reference ?? EM_DASH,
    from: item.origin?.facilityName ?? '',
    fromAddr: item.origin?.address ?? '',
    to: item.destination?.facilityName ?? '',
    toAddr: item.destination?.address ?? '',
    carrier: loadCarrierName(item.carrier),
    carrierMc: loadCarrierMc(item.carrier),
    carrierDot: loadCarrierDot(item.carrier),
    stops: item.stops,
    load: item,
  };
  if (item.mode !== null) row.mode = LOAD_MODE_LABEL[item.mode];
  if (item.ltl !== null) row.ltl = loadLtlText(item.ltl);
  if (item.carrierRateCents !== null) row.carrierRate = formatMoney(item.carrierRateCents);
  if (item.driverInstructions !== null) row.notes = item.driverInstructions;
  if (item.createdActivityAt !== null) row.createdAt = formatActivityTime(item.createdActivityAt, ctx.timeZone, ctx.today);
  return row;
}

// Runtruck1's lib/search.ts over a view-model row: any own string or number field
// (except the presentation keys) contains the trimmed, lower-cased query. The web's
// matchesQuery (apps/web lib/search.ts) is the same rule; the API uses this one for `q`.
export function loadRowMatches(row: object, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return Object.entries(row).some(
    ([key, v]) => key !== 'tagClass' && key !== 'tone' && (typeof v === 'string' || typeof v === 'number') && String(v).toLowerCase().includes(q),
  );
}
