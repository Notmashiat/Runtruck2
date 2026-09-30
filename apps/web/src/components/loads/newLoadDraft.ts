import { LOAD_EQUIPMENT_LABEL, LOAD_LTL_SERVICE_LABEL, LOAD_PACKAGING_LABEL, LOAD_PAYMENT_TERMS_LABEL } from '@runtruck/calculations';
import type { LoadEquipmentType, LoadLtlService, LoadPackaging, LoadPaymentTerms } from '@runtruck/types';
import {
  type CreateLoadInput,
  createLoadSchema,
  LOAD_EQUIPMENT_TYPES,
  LOAD_FREIGHT_CLASSES,
  LOAD_LTL_SERVICES,
  LOAD_PACKAGING,
  LOAD_PAYMENT_TERMS,
  NEW_LOAD_SECTIONS,
  type NewLoadSection,
  newLoadIssueSection,
} from '@runtruck/validation';

// New Load's draft (Runtruck1 NewLoadDialog.tsx Draft) and its mapping to the POST /loads
// body (docs/api/loads.md §8.3.2). The draft keeps Runtruck1's string fields; where
// Runtruck1 held display text for a select, it holds the select value instead (the
// customer, bill-to, own-fleet driver/truck/trailer and partner carrier uuids, the
// equipment enum; L14). Validation is the shared createLoadSchema, grouped by section.

export type Section = NewLoadSection;
export const SECTIONS: readonly Section[] = NEW_LOAD_SECTIONS;

export type Mode = 'FTL' | 'LTL' | 'Partial';
export const MODES: Mode[] = ['FTL', 'LTL', 'Partial'];

// Static option lists in Runtruck1's order, as its labels.
export const EQUIPMENT: readonly LoadEquipmentType[] = LOAD_EQUIPMENT_TYPES;
export const PACKAGING: string[] = LOAD_PACKAGING.map((p) => LOAD_PACKAGING_LABEL[p]);
export const FREIGHT_CLASSES: readonly string[] = LOAD_FREIGHT_CLASSES;
export const LTL_SERVICES: string[] = LOAD_LTL_SERVICES.map((s) => LOAD_LTL_SERVICE_LABEL[s]);
export const TERMS: string[] = LOAD_PAYMENT_TERMS.map((t) => LOAD_PAYMENT_TERMS_LABEL[t]);

export interface StopDraft {
  kind: 'Pickup' | 'Delivery';
  facility: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  date: string;
  from: string;
  to: string;
  number: string;
  contact: string;
}

export interface Draft {
  customer: string;
  billTo: string;
  ref: string;
  po: string;
  mode: Mode;
  // '' or a LoadEquipmentType.
  equipment: string;
  dispatcher: string;
  stops: StopDraft[];
  commodity: string;
  weight: string;
  pieces: string;
  packaging: string;
  value: string;
  temp: string;
  hazmat: boolean;
  unNumber: string;
  freightClass: string;
  nmfc: string;
  handlingUnits: string;
  length: string;
  width: string;
  height: string;
  stackable: boolean;
  services: string[];
  brokered: boolean;
  carrier: string;
  carrierContact: string;
  carrierPhone: string;
  carrierRate: string;
  driver: string;
  truck: string;
  trailer: string;
  lineHaul: string;
  fuel: string;
  accessorials: string;
  miles: string;
  driverPay: string;
  terms: string;
  // Document label → chosen file name ('' after Remove), as Runtruck1.
  docs: Record<string, string>;
  instructions: string;
  internal: string;
}

export function emptyStop(kind: StopDraft['kind']): StopDraft {
  return { kind, facility: '', address: '', city: '', state: '', zip: '', date: '', from: '', to: '', number: '', contact: '' };
}

// Runtruck1 INITIAL, with the signed-in member as the default dispatcher.
export function initialDraft(dispatcher: string): Draft {
  return {
    customer: '', billTo: '', ref: '', po: '', mode: 'FTL', equipment: '', dispatcher,
    stops: [emptyStop('Pickup'), emptyStop('Delivery')],
    commodity: '', weight: '', pieces: '', packaging: 'Pallets', value: '', temp: '', hazmat: false, unNumber: '',
    freightClass: '', nmfc: '', handlingUnits: '', length: '', width: '', height: '', stackable: false, services: [],
    brokered: false, carrier: '', carrierContact: '', carrierPhone: '', carrierRate: '',
    driver: '', truck: '', trailer: '',
    lineHaul: '', fuel: '', accessorials: '', miles: '', driverPay: '', terms: 'Net 30',
    docs: {}, instructions: '', internal: '',
  };
}

// Runtruck1 helpers for the live preview (Rates summary, Review).
export const num = (s: string) => Number(s) || 0;

export const isReefer = (equipment: string) => equipment === 'reefer_53';

export const equipmentLabel = (equipment: string): string =>
  (EQUIPMENT as readonly string[]).includes(equipment) ? LOAD_EQUIPMENT_LABEL[equipment as LoadEquipmentType] : '';

// '' → none; otherwise whole units / cents (L4).
const cents = (s: string): number => (s === '' ? 0 : Math.round(Number(s) * 100));
const optionalCents = (s: string): number | null => (s === '' ? null : Math.round(Number(s) * 100));
const quantity = (s: string): number | null => (s === '' ? null : Math.round(Number(s)));

function reverse<K extends string>(labels: Readonly<Record<K, string>>): Map<string, K> {
  return new Map((Object.entries(labels) as [K, string][]).map(([k, v]) => [v, k]));
}
const PACKAGING_OF = reverse<LoadPackaging>(LOAD_PACKAGING_LABEL);
const SERVICE_OF = reverse<LoadLtlService>(LOAD_LTL_SERVICE_LABEL);
const TERMS_OF = reverse<LoadPaymentTerms>(LOAD_PAYMENT_TERMS_LABEL);
const MODE_OF: Record<Mode, CreateLoadInput['mode']> = { FTL: 'ftl', LTL: 'ltl', Partial: 'partial' };

// §8.3.2: the POST /loads body. Hidden fields are sent empty (L6): LTL details only on LTL
// loads, a UN number only with hazmat, a temperature only on reefer equipment.
export function toCreateLoadBody(d: Draft): CreateLoadInput {
  return {
    customerId: d.customer || null,
    billToCustomerId: d.billTo || null,
    tenderRef: d.ref,
    customerPo: d.po,
    mode: MODE_OF[d.mode],
    equipmentType: d.equipment ? (d.equipment as LoadEquipmentType) : null,
    dispatcherName: d.dispatcher,
    stops: d.stops.map((s) => ({
      kind: s.kind === 'Pickup' ? 'pickup' : 'delivery',
      facilityName: s.facility,
      addressLine1: s.address,
      city: s.city,
      state: s.state,
      postalCode: s.zip,
      appointmentDate: s.date || null,
      windowOpen: s.from || null,
      windowClose: s.to || null,
      referenceNumber: s.number,
      siteContact: s.contact,
    })),
    commodity: d.commodity,
    weightLb: quantity(d.weight),
    pieces: quantity(d.pieces),
    packaging: PACKAGING_OF.get(d.packaging) ?? 'pallets',
    declaredValueCents: optionalCents(d.value),
    temperatureF: isReefer(d.equipment) && d.temp !== '' ? Number(d.temp) : null,
    hazmat: d.hazmat,
    unNumber: d.hazmat ? d.unNumber : null,
    ltl:
      d.mode === 'LTL'
        ? {
            freightClass: (d.freightClass || null) as NonNullable<CreateLoadInput['ltl']>['freightClass'],
            nmfc: d.nmfc,
            handlingUnits: quantity(d.handlingUnits),
            lengthIn: quantity(d.length),
            widthIn: quantity(d.width),
            heightIn: quantity(d.height),
            stackable: d.stackable,
            services: d.services.map((s) => SERVICE_OF.get(s)).filter((s): s is LoadLtlService => s !== undefined),
          }
        : null,
    haul: d.brokered
      ? {
          hauledBy: 'partner_carrier',
          carrierId: d.carrier || null,
          carrierRateCents: optionalCents(d.carrierRate),
          carrierContactName: d.carrierContact,
          carrierPhone: d.carrierPhone,
          driverName: d.driver,
          truckNumber: d.truck,
          trailerNumber: d.trailer,
        }
      : { hauledBy: 'own_fleet', driverId: d.driver || null, truckId: d.truck || null, trailerId: d.trailer || null, driverPayCents: optionalCents(d.driverPay) },
    lineHaulCents: cents(d.lineHaul),
    fuelSurchargeCents: cents(d.fuel),
    accessorialCents: cents(d.accessorials),
    loadedMiles: quantity(d.miles),
    paymentTerms: TERMS_OF.get(d.terms) ?? 'net_30',
    driverInstructions: d.instructions,
    internalNotes: d.internal,
  };
}

export type Errors = Partial<Record<Section, string[]>>;

// Issues (as the API returns them) grouped into New Load's sections, in issue order.
export function groupIssues(issues: readonly { path: string; message: string }[]): Errors {
  const e: Errors = {};
  for (const issue of issues) (e[newLoadIssueSection(issue.path)] ??= []).push(issue.message);
  return e;
}

// Runtruck1 validate(d): the shared schema's issues by section (§8.3.3). A fresh draft
// yields exactly Runtruck1's 11: Load info 2, Stops 6, Freight 2, Rates 1.
export function validate(d: Draft): Errors {
  const result = createLoadSchema.safeParse(toCreateLoadBody(d));
  if (result.success) return {};
  return groupIssues(result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
}

// ---------------------------------------------------------------------------
// The live preview (Runtruck1 formulas over the typed text, new-load §8). Figures are
// recomputed by the API on save; these only echo what the user typed.

// Runtruck1 money(): dollars with up to three decimals ("$2,450.5").
export const money = (n: number) => `$${n.toLocaleString('en-US')}`;

export function signedMoney(n: number): string {
  return n < 0 ? `-${money(-n)}` : money(n);
}

export interface Stat {
  label: string;
  value: string;
}

// Rates: Total to customer, Rate / mile, Driver pay or Carrier cost, Margin.
export function ratesStats(d: Draft): Stat[] {
  const total = num(d.lineHaul) + num(d.fuel) + num(d.accessorials);
  const cost = d.brokered ? num(d.carrierRate) : num(d.driverPay);
  return [
    { label: 'Total to customer', value: money(total) },
    { label: 'Rate / mile', value: num(d.miles) > 0 ? `$${(num(d.lineHaul) / num(d.miles)).toFixed(2)}` : '—' },
    { label: d.brokered ? 'Carrier cost' : 'Driver pay', value: cost > 0 ? money(cost) : '—' },
    { label: 'Margin', value: cost > 0 ? signedMoney(total - cost) : '—' },
  ];
}

export interface ReviewRefs {
  customers: readonly { id: string; name: string }[];
  drivers: readonly { id: string; fullName: string }[];
  // Runtruck1 Carrier names ("Valley Line Transport", "Sunridge Freight (own fleet)").
  partnerName: (id: string) => string | undefined;
  ownFleetName: string | undefined;
}

// Review: select values are mapped back to Runtruck1's text (§8.3.3, L14); Route keeps
// Runtruck1's positional first/last stops and raw cities.
export function reviewStats(d: Draft, refs: ReviewRefs): Stat[] {
  const total = num(d.lineHaul) + num(d.fuel) + num(d.accessorials);
  const firstCity = d.stops[0]?.city ?? '';
  const lastCity = d.stops[d.stops.length - 1]?.city ?? '';
  return [
    { label: 'Customer', value: refs.customers.find((c) => c.id === d.customer)?.name ?? '—' },
    { label: 'Mode · equipment', value: `${d.mode} · ${equipmentLabel(d.equipment) || '—'}` },
    { label: 'Stops', value: `${d.stops.filter((s) => s.kind === 'Pickup').length} pickup · ${d.stops.filter((s) => s.kind === 'Delivery').length} delivery` },
    { label: 'Route', value: firstCity && lastCity ? `${firstCity} → ${lastCity}` : '—' },
    { label: 'Freight', value: d.commodity ? `${d.commodity}${d.weight ? ` · ${num(d.weight).toLocaleString('en-US')} lb` : ''}` : '—' },
    { label: 'Carrier', value: d.brokered ? ((d.carrier ? refs.partnerName(d.carrier) : undefined) ?? '—') : (refs.ownFleetName ?? '—') },
    { label: 'Driver', value: d.brokered ? d.driver || 'Unassigned' : (refs.drivers.find((x) => x.id === d.driver)?.fullName ?? 'Unassigned') },
    { label: 'Total to customer', value: money(total) },
  ];
}

export function mergeErrors(a: Errors, b: Errors): Errors {
  const e: Errors = { ...a };
  for (const s of SECTIONS) {
    const extra = b[s];
    if (extra?.length) e[s] = [...(e[s] ?? []), ...extra];
  }
  return e;
}
