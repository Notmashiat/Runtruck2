// Load wire types: the Loads board, load detail, New Load create.
// Specified in docs/api/loads.md; lifecycle in docs/08-load-lifecycle.md,
// dispatch rules in docs/09-dispatch-lifecycle.md. Type-only module.
//
// Conventions (docs/04-api.md §6): money is integer cents (`…Cents`), business
// dates are `YYYY-MM-DD`, instants are UTC ISO strings, wall-clock times are
// `HH:MM` in the timezone named next to them. Display strings are built by the
// web with @runtruck/calculations; strings that are text compositions of stored
// facts (route, unit, addresses) arrive display-ready (design brief §3).

import type { PageMeta } from './api.js';
import type { PaymentTerms } from './customers.js';
import type { LoadDocument } from './documents.js';

// `load_status` (03 §4.4, docs/08). Labels (web): needs_driver "Needs driver" (amber) ·
// dispatched "Dispatched" (gray) · at_pickup "At pickup" (gray) · in_transit "In transit" (blue) ·
// delayed "Delayed" (amber) · needs_pod "Needs POD" (amber) · delivered "Delivered" (gray).
export type LoadStatus = 'needs_driver' | 'dispatched' | 'at_pickup' | 'in_transit' | 'delayed' | 'needs_pod' | 'delivered';

// Loads board filter (`?view=`): Runtruck1's pills Active / Needs POD / Delivered / All.
export type LoadBoardView = 'active' | 'needs-pod' | 'delivered' | 'all';

// `load_mode`: ftl "Full truckload" (choice "FTL") · ltl "Less than truckload" ("LTL") · partial "Partial".
export type LoadMode = 'ftl' | 'ltl' | 'partial';

// `equipment_type`: dry_van_53 "Dry van, 53 ft" · reefer_53 "Reefer, 53 ft" · flatbed_48 "Flatbed, 48 ft" ·
// flatbed_tarped "Flatbed, tarped" · step_deck_48 "Step deck, 48 ft" · power_only "Power only" ·
// box_truck_26 "Box truck, 26 ft". Reefer ⇔ reefer_53.
export type LoadEquipmentType =
  | 'dry_van_53'
  | 'reefer_53'
  | 'flatbed_48'
  | 'flatbed_tarped'
  | 'step_deck_48'
  | 'power_only'
  | 'box_truck_26';

// `packaging`: Title-case labels ("Pallets" … "Loose").
export type LoadPackaging = 'pallets' | 'skids' | 'crates' | 'boxes' | 'drums' | 'totes' | 'loose';

// `ltl_service`: liftgate_pickup "Liftgate at pickup" · liftgate_delivery "Liftgate at delivery" ·
// residential_delivery "Residential delivery" · inside_delivery "Inside delivery" ·
// delivery_appointment "Delivery appointment" · limited_access "Limited access".
export type LoadLtlService =
  | 'liftgate_pickup'
  | 'liftgate_delivery'
  | 'residential_delivery'
  | 'inside_delivery'
  | 'delivery_appointment'
  | 'limited_access';

// NMFC class, `loads.freight_class` (CHECK-restricted text).
export type LoadFreightClass =
  | '50' | '55' | '60' | '65' | '70' | '77.5' | '85' | '92.5' | '100'
  | '110' | '125' | '150' | '175' | '200' | '250' | '300' | '400' | '500';

// `payment_terms` on the load: net_15 "Net 15" · net_30 "Net 30" · net_45 "Net 45" · net_60 "Net 60" · quick_pay "Quick pay".
// The same Postgres enum as the customer's terms: an alias of the canonical union (customers.ts).
export type LoadPaymentTerms = PaymentTerms;

// `stop_kind`: pickup "Pickup" · delivery "Delivery" · fuel "Fuel stop".
export type LoadStopKind = 'pickup' | 'delivery' | 'fuel';

// `stop_status`; the detail-page kind label is derived from kind + status (03 §6.0.5).
export type LoadStopStatus = 'pending' | 'arrived' | 'completed';

// `dispatch_status` (not displayed).
export type LoadDispatchStatus = 'assigned' | 'completed' | 'cancelled';

// `load_activity_kind`; the message text is stored with the row.
export type LoadActivityKind =
  | 'created'
  | 'driver_instructions'
  | 'driver_accepted'
  | 'arrived'
  | 'document_uploaded'
  | 'invoice_queued'
  | 'consignee_notified';

// Which cost the load's "pay" is: the KPI tile reads "Carrier cost" or "Driver pay".
export type LoadPayKind = 'driver_pay' | 'carrier_cost';

// New Load "Hauled by": Own fleet / Partner carrier.
export type LoadHauledBy = 'own_fleet' | 'partner_carrier';

export interface LoadPartyRef {
  id: string;
  name: string;
}

export interface LoadUserRef {
  id: string;
  // users.full_name
  fullName: string;
}

// The carrier on the load (loads.carrier_id). `name` is stored without " (own fleet)";
// the web appends it when `isOwnFleet` (03 §6.0.8). MC/DOT are digits only.
export interface LoadCarrierRef {
  id: string;
  name: string;
  mcNumber: string | null;
  dotNumber: string | null;
  isOwnFleet: boolean;
}

// First pickup ("from") or last delivery ("to"): Runtruck1's from/fromAddr, to/toAddr.
export interface LoadEndpoint {
  // load_stops.facility_name
  facilityName: string;
  // address_line1, city, state joined ", " — without the postal code (Runtruck1 `street()`).
  address: string;
}

// The pieces of the "LTL" row: `Class ${freightClass} · ${handlingUnits} ${packaging label, lower-case}`
// then the service labels, joined " · ".
export interface LoadLtlSummary {
  freightClass: LoadFreightClass;
  handlingUnits: number;
  packaging: LoadPackaging | null;
  // In the order the user ticked them.
  services: LoadLtlService[];
}

export interface LoadLtlDetail extends LoadLtlSummary {
  nmfc: string | null;
  lengthIn: number | null;
  widthIn: number | null;
  heightIn: number | null;
  stackable: boolean;
}

// A stop as the board expand row needs it.
export interface LoadStopSummary {
  id: string;
  sequence: number;
  kind: LoadStopKind;
  status: LoadStopStatus;
  // load_stops.facility_name (fuel stop: "Planned · 92 gal, DEF top-off").
  facilityName: string;
  // 03 §6.0.3 "stop address label": address_line1, city, state joined ", " then " " + postal code.
  // Fuel stop: "Routed automatically on the lane". Null when the stop has none of these.
  addressLabel: string | null;
  // Stop-local business day, YYYY-MM-DD.
  appointmentDate: string;
  // HH:MM wall clock in `timezone`; either end may be null.
  windowOpen: string | null;
  windowClose: string | null;
  // IANA zone of the wall-clock times.
  timezone: string;
}

export interface LoadStop extends LoadStopSummary {
  facilityId: string | null;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  // Planner slot (HH:MM in `timezone`), both or neither.
  plannedStart: string | null;
  plannedEnd: string | null;
  // New Load "Pickup #" / "Delivery #".
  referenceNumber: string | null;
  // New Load "Site contact" (personal data).
  siteContact: string | null;
  arrivedAt: string | null;
  completedAt: string | null;
}

// GET /loads row: every value the board row, its expand row, the Dashboard "Active loads"
// table and the planner "Related load" list render, plus every field Runtruck1's search
// matched (docs/api/loads.md §3).
export interface LoadListItem {
  id: string;
  // Human number; the web renders "L-40218" (formatLoadNumber).
  loadNumber: number;
  status: LoadStatus;
  customer: LoadPartyRef;
  // coalesce(tender_ref, customer_po); null → "—".
  reference: string | null;
  // "Fresno, CA → Reno, NV" (first pickup label → last delivery label); null when the load has no stops.
  route: string | null;
  // First pickup / last delivery appointment_date; null when the load has no such stop.
  pickupDate: string | null;
  deliveryDate: string | null;
  origin: LoadEndpoint | null;
  destination: LoadEndpoint | null;
  // Live dispatch: the driver's full name (own fleet) or the partner's free-text driver; null → "Unassigned".
  driverName: string | null;
  // Live dispatch: truck and trailer unit numbers joined " / "; null → "—" (board cell "Unassigned").
  unit: string | null;
  // Null → "Not yet covered".
  carrier: LoadCarrierRef | null;
  // Null on seeded loads (no "Mode" row, no search key).
  mode: LoadMode | null;
  equipmentType: LoadEquipmentType | null;
  commodity: string | null;
  weightLb: number | null;
  // Reefer set point °F; the web shows it only for reefer_53.
  temperatureF: number | null;
  // Non-null only for LTL loads.
  ltl: LoadLtlSummary | null;
  // "Rate" / "Line haul".
  lineHaulCents: number;
  // line haul + fuel surcharge + accessorials ("Total to customer").
  totalCents: number;
  loadedMiles: number | null;
  // round(line_haul_cents / loaded_miles) when loaded_miles > 0, else null.
  ratePerMileCents: number | null;
  // 'carrier_cost' when carrier_rate_cents is set, else 'driver_pay'.
  payKind: LoadPayKind;
  // carrier_rate_cents ?? driver_pay_cents; null → "—".
  payCents: number | null;
  // totalCents − payCents − coalesce(operating_cost_cents, 0); null when payCents is null. May be negative.
  marginCents: number | null;
  // Brokered loads: what the partner is paid.
  carrierRateCents: number | null;
  // "Driver instructions" (Runtruck1 `notes`).
  driverInstructions: string | null;
  // occurred_at of the load's `created` activity row (loads entered with New Load); null for seeded loads.
  createdActivityAt: string | null;
  // Every stop in `sequence` order (the board expand lists only pickups and deliveries).
  stops: LoadStopSummary[];
}

// meta.summary of GET /loads — counted over board loads (not archived), ignoring `view`, `q` and paging.
export interface LoadBoardSummary {
  // KPI "Undispatched": status needs_driver.
  undispatched: number;
  // KPI "In transit": status in_transit (delayed is not counted).
  inTransit: number;
  // KPI "Delivered": status delivered.
  delivered: number;
  // KPI "Needs POD": status needs_pod.
  needsPod: number;
  // Rows per pill.
  views: Record<LoadBoardView, number>;
}

export interface LoadListMeta extends PageMeta {
  summary: LoadBoardSummary;
}

// The live (non-cancelled) dispatch of a load (docs/09).
export interface LoadDispatch {
  id: string;
  status: LoadDispatchStatus;
  // Own fleet: references; brokered: null.
  driverId: string | null;
  truckId: string | null;
  trailerId: string | null;
  // Own fleet: the driver's full name / unit numbers; brokered: the partner's free text.
  driverName: string | null;
  truckUnit: string | null;
  trailerUnit: string | null;
  assignedAt: string;
  assignedBy: LoadUserRef | null;
}

export interface LoadActivityEntry {
  id: string;
  sequence: number;
  // UTC ISO; the web renders formatActivityTime(occurredAt, org timezone, today).
  occurredAt: string;
  kind: LoadActivityKind;
  message: string;
  // Null when the actor is not a user (seed, driver app).
  actor: LoadUserRef | null;
}

// GET /loads/by-number/:loadNumber, GET /loads/:id, POST /loads (201).
export interface LoadDetail extends LoadListItem {
  billToCustomer: LoadPartyRef | null;
  tenderRef: string | null;
  customerPo: string | null;
  dispatcherName: string | null;
  pieces: number | null;
  packaging: LoadPackaging | null;
  declaredValueCents: number | null;
  hazmat: boolean;
  unNumber: string | null;
  ltl: LoadLtlDetail | null;
  carrierContactName: string | null;
  carrierPhone: string | null;
  fuelSurchargeCents: number;
  accessorialCents: number;
  emptyMiles: number | null;
  driverPayCents: number | null;
  operatingCostCents: number | null;
  paymentTerms: LoadPaymentTerms;
  internalNotes: string | null;
  // Non-null for loads closed off the dispatch board (the web falls back to the first board load, D6).
  archivedAt: string | null;
  createdAt: string;
  // Null for seeded loads.
  createdBy: LoadUserRef | null;
  dispatch: LoadDispatch | null;
  stops: LoadStop[];
  // Slots by position; null when the member lacks documents.view (07 §8 item 1).
  documents: LoadDocument[] | null;
  // By sequence.
  activity: LoadActivityEntry[];
}

// Detail and create responses carry an empty meta.
export type LoadDetailMeta = Record<string, never>;
