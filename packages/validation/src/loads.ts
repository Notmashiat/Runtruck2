import { z } from 'zod';
import { businessDateSchema, pageQuerySchema, storableTextSchema, timeOfDaySchema } from './common.js';

// Load inputs: the Loads board query, load lookups and the New Load body.
// Specified in docs/api/loads.md; the value lists mirror the Postgres enums of
// docs/03-database.md §4.4 and the DTO unions in @runtruck/types (loads.ts).

export const LOAD_STATUSES = [
  'needs_driver',
  'dispatched',
  'at_pickup',
  'in_transit',
  'delayed',
  'needs_pod',
  'delivered',
] as const;

// Runtruck1 ACTIVE_STATUSES (the "Active" pill and the Dashboard "Active loads").
export const LOAD_ACTIVE_STATUSES = ['needs_driver', 'dispatched', 'at_pickup', 'in_transit', 'delayed'] as const;

export const LOAD_BOARD_VIEWS = ['active', 'needs-pod', 'delivered', 'all'] as const;

// Statuses each board pill shows (`all` shows every board load).
export const LOAD_BOARD_VIEW_STATUSES: Readonly<Record<(typeof LOAD_BOARD_VIEWS)[number], readonly (typeof LOAD_STATUSES)[number][]>> = {
  active: LOAD_ACTIVE_STATUSES,
  'needs-pod': ['needs_pod'],
  delivered: ['delivered'],
  all: LOAD_STATUSES,
};

export const LOAD_MODES = ['ftl', 'ltl', 'partial'] as const;

// In Runtruck1's option order (New Load "Equipment").
export const LOAD_EQUIPMENT_TYPES = [
  'dry_van_53',
  'reefer_53',
  'flatbed_48',
  'flatbed_tarped',
  'step_deck_48',
  'power_only',
  'box_truck_26',
] as const;

export const LOAD_PACKAGING = ['pallets', 'skids', 'crates', 'boxes', 'drums', 'totes', 'loose'] as const;

export const LOAD_LTL_SERVICES = [
  'liftgate_pickup',
  'liftgate_delivery',
  'residential_delivery',
  'inside_delivery',
  'delivery_appointment',
  'limited_access',
] as const;

// Same list as the loads_freight_class_ck CHECK (packages/database FREIGHT_CLASSES).
export const LOAD_FREIGHT_CLASSES = [
  '50', '55', '60', '65', '70', '77.5', '85', '92.5', '100',
  '110', '125', '150', '175', '200', '250', '300', '400', '500',
] as const;

export const LOAD_PAYMENT_TERMS = ['net_15', 'net_30', 'net_45', 'net_60', 'quick_pay'] as const;

// Stops New Load can create (fuel stops are not entered by users).
export const NEW_LOAD_STOP_KINDS = ['pickup', 'delivery'] as const;

// Upper bound on stops per load (Runtruck1 had none; bounded against oversized bodies).
export const NEW_LOAD_MAX_STOPS = 50;

// Largest value an `integer` column holds.
const INT4_MAX = 2_147_483_647;

export const loadStatusSchema = z.enum(LOAD_STATUSES);
export const loadBoardViewSchema = z.enum(LOAD_BOARD_VIEWS, { error: 'Use active, needs-pod, delivered or all.' });

// ---------------------------------------------------------------------------
// Reads

// GET /loads — the board (docs/api/loads.md §3).
export const listLoadsQuerySchema = pageQuerySchema.extend({
  view: loadBoardViewSchema.default('all'),
});

export type ListLoadsQuery = z.output<typeof listLoadsQuerySchema>;

// GET /loads/by-number/:loadNumber — the integer load number (40218, not "L-40218").
export const loadNumberParamSchema = z.object({
  loadNumber: z
    .string()
    .regex(/^[1-9]\d{0,9}$/, 'Use a load number such as 40218.')
    .transform(Number)
    .pipe(z.number().int().max(INT4_MAX, 'Use a load number such as 40218.')),
});

export type LoadNumberParam = z.output<typeof loadNumberParamSchema>;

// GET /loads/:id, GET/POST /loads/:id/documents.
export const loadIdParamSchema = z.object({
  id: z.uuid(),
});

export type LoadIdParam = z.output<typeof loadIdParamSchema>;

// ---------------------------------------------------------------------------
// POST /loads — New Load (docs/api/loads.md §6)
//
// The shape accepts every value Runtruck1's form could hold, including empty ones, and
// checks only format and bounds. Runtruck1's own rules ("what still has to be filled in",
// NewLoadDialog.tsx validate()) run afterwards in `createLoadSchema`'s refinement, in
// Runtruck1's order and with its exact messages, so the web can render the Review list and
// the section badges from the same schema the API enforces (newLoadIssueSection).

// Optional free text: storable (no NUL, well-formed), trimmed; empty → null.
function text(label: string, max: number) {
  return storableTextSchema()
    .trim()
    .max(max, `${label} is too long (at most ${max} characters).`)
    .nullish()
    .transform((s) => (s === undefined || s === null || s === '' ? null : s));
}

// Money in integer cents, never negative.
function cents(label: string) {
  return z
    .number({ error: `${label} must be a number of cents.` })
    .int(`${label} must be a whole number of cents.`)
    .min(0, `${label} can't be negative.`)
    .max(INT4_MAX, `${label} is too large.`);
}

function optionalCents(label: string) {
  return cents(label)
    .nullish()
    .transform((v) => v ?? null);
}

// Whole, non-negative quantities (lb, mi, in, pieces, handling units).
function optionalCount(label: string, max: number) {
  return z
    .number({ error: `${label} must be a number.` })
    .int(`${label} must be a whole number.`)
    .min(0, `${label} can't be negative.`)
    .max(max, `${label} is too large.`)
    .nullish()
    .transform((v) => v ?? null);
}

// A reference to a row of the caller's organization, or nothing chosen.
function optionalRef() {
  return z
    .uuid({ error: 'Choose an option from the list.' })
    .nullish()
    .transform((v) => v ?? null);
}

function optionalEnum<const T extends readonly [string, ...string[]]>(values: T, message: string) {
  return z
    .enum(values, { error: message })
    .nullish()
    .transform((v) => v ?? null);
}

export const createLoadStopSchema = z.object({
  kind: z.enum(NEW_LOAD_STOP_KINDS, { error: 'Choose Pickup or Delivery.' }),
  facilityName: text('Facility', 200),
  addressLine1: text('Street address', 200),
  city: text('City', 100),
  // Runtruck1 stores the state upper-cased (toLoad place()).
  state: storableTextSchema()
    .trim()
    .toUpperCase()
    .max(2, 'Use the two-letter state.')
    .nullish()
    .transform((s) => (s === undefined || s === null || s === '' ? null : s)),
  postalCode: text('ZIP', 20),
  appointmentDate: businessDateSchema.nullish().transform((v) => v ?? null),
  // HH:MM wall clock at the stop (organization timezone for New Load stops).
  windowOpen: timeOfDaySchema.nullish().transform((v) => v ?? null),
  windowClose: timeOfDaySchema.nullish().transform((v) => v ?? null),
  // "Pickup #" / "Delivery #".
  referenceNumber: text('Reference number', 100),
  siteContact: text('Site contact', 200),
});

export type CreateLoadStopInput = z.input<typeof createLoadStopSchema>;

export const createLoadLtlSchema = z.object({
  freightClass: optionalEnum(LOAD_FREIGHT_CLASSES, 'Choose a freight class from the list.'),
  nmfc: text('NMFC #', 50),
  handlingUnits: optionalCount('Handling units', 100_000),
  lengthIn: optionalCount('Length', 10_000),
  widthIn: optionalCount('Width', 10_000),
  heightIn: optionalCount('Height', 10_000),
  stackable: z.boolean().default(false),
  // In the order the user ticked them.
  services: z
    .array(z.enum(LOAD_LTL_SERVICES, { error: 'Choose a service from the list.' }))
    .max(LOAD_LTL_SERVICES.length)
    .refine((list) => new Set(list).size === list.length, 'List each service once.')
    .default([]),
});

export type CreateLoadLtlInput = z.input<typeof createLoadLtlSchema>;

// Carrier + Driver & equipment: own fleet (references) or a partner carrier (free text).
// Each kind takes only its own fields (09 §3.1 E3); see withoutForeignHaulFields.
const ownFleetHaulSchema = z.strictObject({
  hauledBy: z.literal('own_fleet'),
  driverId: optionalRef(),
  truckId: optionalRef(),
  trailerId: optionalRef(),
  // 0 or null: no driver pay (stored null; "Driver pay" and "Margin" read "—").
  driverPayCents: optionalCents('Driver pay'),
});

const partnerCarrierHaulSchema = z.strictObject({
  hauledBy: z.literal('partner_carrier'),
  carrierId: optionalRef(),
  carrierRateCents: optionalCents('Carrier rate'),
  carrierContactName: text('Carrier dispatcher', 120),
  carrierPhone: text('Carrier phone', 40),
  driverName: text('Driver name', 120),
  truckNumber: text('Truck #', 40),
  trailerNumber: text('Trailer #', 40),
});

const haulUnionSchema = z.discriminatedUnion('hauledBy', [ownFleetHaulSchema, partnerCarrierHaulSchema], {
  error: 'Choose Own fleet or Partner carrier.',
});

export type CreateLoadHaulInput = z.input<typeof haulUnionSchema>;

const HAUL_KINDS = {
  own_fleet: { label: 'own-fleet', fields: new Set(Object.keys(ownFleetHaulSchema.shape)) },
  partner_carrier: { label: 'partner-carrier', fields: new Set(Object.keys(partnerCarrierHaulSchema.shape)) },
} as const;

// 09 §3.1 E3: own fleet means references only (no free text, no carrier rate); a partner
// carrier means free text only (no references, no driver pay). A field of the other kind,
// or one of neither, is a 400 issue at haul.<field> naming the kind it belongs to, never
// silently dropped (which would create a different load than the one asked for). The
// issues do not abort, so Runtruck1's rules below still run; the strict variants are the
// backstop. The parameter is typed as the input so the body type stays precise; at run
// time it may be anything, which the union then refuses.
function withoutForeignHaulFields(input: CreateLoadHaulInput, ctx: z.RefinementCtx): CreateLoadHaulInput {
  const haul: unknown = input;
  if (typeof haul !== 'object' || haul === null || !('hauledBy' in haul)) return input;
  const kind = haul.hauledBy;
  if (kind !== 'own_fleet' && kind !== 'partner_carrier') return input;
  const other = kind === 'own_fleet' ? 'partner_carrier' : 'own_fleet';
  const kept: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(haul)) {
    if (HAUL_KINDS[kind].fields.has(field)) {
      kept[field] = value;
    } else {
      const message = HAUL_KINDS[other].fields.has(field)
        ? `This field is for ${HAUL_KINDS[other].label} loads, not ${HAUL_KINDS[kind].label} loads.`
        : 'This field is not part of a haul.';
      ctx.addIssue({ code: 'custom', path: [field], message, input: value, continue: true });
    }
  }
  return kept as CreateLoadHaulInput;
}

export const createLoadHaulSchema = z.preprocess(withoutForeignHaulFields, haulUnionSchema);

const createLoadShape = z.object({
  // Load info
  customerId: optionalRef(),
  // Null = "Same as customer".
  billToCustomerId: optionalRef(),
  tenderRef: text('Tender / reference #', 100),
  customerPo: text('Customer PO #', 100),
  mode: z.enum(LOAD_MODES, { error: 'Choose FTL, LTL or Partial.' }),
  equipmentType: optionalEnum(LOAD_EQUIPMENT_TYPES, 'Choose equipment from the list.'),
  dispatcherName: text('Dispatcher', 120),
  // Stops, in running order.
  stops: z.array(createLoadStopSchema).max(NEW_LOAD_MAX_STOPS, `A load has at most ${NEW_LOAD_MAX_STOPS} stops.`),
  // Freight
  commodity: text('Commodity', 200),
  weightLb: optionalCount('Weight', 1_000_000),
  pieces: optionalCount('Pieces', 1_000_000),
  packaging: z.enum(LOAD_PACKAGING, { error: 'Choose a packaging from the list.' }).default('pallets'),
  declaredValueCents: optionalCents('Declared value'),
  // °F; stored as numeric(4,1), i.e. rounded to 0.1.
  temperatureF: z
    .number({ error: 'Temperature must be a number.' })
    .min(-999.9, 'Temperature is out of range.')
    .max(999.9, 'Temperature is out of range.')
    .nullish()
    .transform((v) => v ?? null),
  hazmat: z.boolean().default(false),
  unNumber: text('UN number', 20),
  // LTL details: present only for mode 'ltl'.
  ltl: createLoadLtlSchema.nullish().transform((v) => v ?? null),
  // Carrier and Driver & equipment
  haul: createLoadHaulSchema,
  // Rates
  lineHaulCents: cents('Line haul').default(0),
  fuelSurchargeCents: cents('Fuel surcharge').default(0),
  accessorialCents: cents('Accessorial charges').default(0),
  loadedMiles: optionalCount('Loaded miles', 100_000),
  paymentTerms: z.enum(LOAD_PAYMENT_TERMS, { error: 'Choose payment terms from the list.' }),
  // Notes
  driverInstructions: text('Driver instructions', 4000),
  internalNotes: text('Internal notes', 4000),
});

export const createLoadSchema = createLoadShape.superRefine((d, ctx) => {
  const add = (path: (string | number)[], message: string) => {
    ctx.addIssue({ code: 'custom', path, message });
  };

  // Runtruck1 validate(), in its order and wording.
  if (d.customerId === null) add(['customerId'], 'Customer');
  if (d.equipmentType === null) add(['equipmentType'], 'Equipment');
  if (!d.stops.some((s) => s.kind === 'pickup')) add(['stops'], 'At least one pickup');
  if (!d.stops.some((s) => s.kind === 'delivery')) add(['stops'], 'At least one delivery');
  d.stops.forEach((s, i) => {
    const n = `Stop ${i + 1}`;
    if (s.facilityName === null) add(['stops', i, 'facilityName'], `${n}: facility`);
    if (s.addressLine1 === null || s.city === null || s.state === null) add(['stops', i, 'address'], `${n}: street, city and state`);
    if (s.appointmentDate === null) add(['stops', i, 'appointmentDate'], `${n}: date`);
    const prevDate = d.stops[i - 1]?.appointmentDate ?? null;
    if (s.appointmentDate !== null && prevDate !== null && s.appointmentDate < prevDate) {
      add(['stops', i, 'appointmentDate'], `${n}: date is before stop ${i}`);
    }
  });
  if (d.commodity === null) add(['commodity'], 'Commodity');
  if (d.weightLb === null || d.weightLb <= 0) add(['weightLb'], 'Weight');
  if (d.hazmat && d.unNumber === null) add(['unNumber'], 'UN number for hazmat');
  if (d.mode === 'ltl') {
    if ((d.ltl?.freightClass ?? null) === null) add(['ltl', 'freightClass'], 'Freight class');
    const units = d.ltl?.handlingUnits ?? 0;
    if (units <= 0) add(['ltl', 'handlingUnits'], 'Handling units');
  }
  if (d.haul.hauledBy === 'partner_carrier') {
    if (d.haul.carrierId === null) add(['haul', 'carrierId'], 'Carrier');
    if (d.haul.carrierRateCents === null || d.haul.carrierRateCents <= 0) add(['haul', 'carrierRateCents'], 'Carrier rate');
  }
  if (d.lineHaulCents <= 0) add(['lineHaulCents'], 'Line haul rate');

  // "Total to customer" (line haul + fuel surcharge + accessorials) must itself fit an
  // `integer`: every revenue sum adds the three columns (CHECK loads_total_ck,
  // docs/03-database.md §5.6.1), so a larger total would overflow those queries.
  if (d.lineHaulCents + d.fuelSurchargeCents + d.accessorialCents > INT4_MAX) {
    add(['lineHaulCents'], 'Total to customer is too large.');
  }

  // Consistency of fields Runtruck1 hides (the web never sends them; docs/api/loads.md §6.3).
  if (d.mode !== 'ltl' && d.ltl !== null) add(['ltl'], 'LTL details apply only to LTL loads.');
  if (!d.hazmat && d.unNumber !== null) add(['unNumber'], 'A UN number is recorded only for hazmat loads.');
  if (d.temperatureF !== null && d.equipmentType !== null && d.equipmentType !== 'reefer_53') {
    add(['temperatureF'], 'A temperature is recorded only for reefer equipment.');
  }
});

// What a client sends (optional keys may be omitted) and what the API receives after parsing.
export type CreateLoadInput = z.input<typeof createLoadSchema>;
export type CreateLoadBody = z.output<typeof createLoadSchema>;

// New Load's sections (NewLoadDialog SECTIONS), for grouping issues into badges and the Review list.
export const NEW_LOAD_SECTIONS = [
  'Load info',
  'Stops',
  'Freight',
  'LTL',
  'Carrier',
  'Driver & equipment',
  'Rates',
  'Documents',
  'Notes',
  'Review',
] as const;

export type NewLoadSection = (typeof NEW_LOAD_SECTIONS)[number];

const SECTION_OF_FIELD: Readonly<Record<string, NewLoadSection>> = {
  customerId: 'Load info',
  billToCustomerId: 'Load info',
  tenderRef: 'Load info',
  customerPo: 'Load info',
  mode: 'Load info',
  equipmentType: 'Load info',
  dispatcherName: 'Load info',
  stops: 'Stops',
  commodity: 'Freight',
  weightLb: 'Freight',
  pieces: 'Freight',
  packaging: 'Freight',
  declaredValueCents: 'Freight',
  temperatureF: 'Freight',
  hazmat: 'Freight',
  unNumber: 'Freight',
  ltl: 'LTL',
  lineHaulCents: 'Rates',
  fuelSurchargeCents: 'Rates',
  accessorialCents: 'Rates',
  loadedMiles: 'Rates',
  paymentTerms: 'Rates',
  driverInstructions: 'Notes',
  internalNotes: 'Notes',
};

const SECTION_OF_HAUL_FIELD: Readonly<Record<string, NewLoadSection>> = {
  hauledBy: 'Carrier',
  carrierId: 'Carrier',
  carrierRateCents: 'Carrier',
  carrierContactName: 'Carrier',
  carrierPhone: 'Carrier',
  driverId: 'Driver & equipment',
  truckId: 'Driver & equipment',
  trailerId: 'Driver & equipment',
  driverName: 'Driver & equipment',
  truckNumber: 'Driver & equipment',
  trailerNumber: 'Driver & equipment',
  driverPayCents: 'Rates',
};

// The New Load section an issue belongs to, from its dotted path as the API returns it
// ("stops.0.facilityName", "haul.carrierId"). Unknown paths land on Review.
export function newLoadIssueSection(path: string): NewLoadSection {
  const [head = '', field = ''] = path.split('.');
  if (head === 'haul') return SECTION_OF_HAUL_FIELD[field] ?? 'Carrier';
  return SECTION_OF_FIELD[head] ?? 'Review';
}
