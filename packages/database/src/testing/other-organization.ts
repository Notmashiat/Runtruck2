import { randomUUID } from 'node:crypto';
import type { DbExecutor } from '../client.js';
import {
  bills,
  carriers,
  claims,
  complianceReminders,
  customerContacts,
  customers,
  dispatches,
  documents,
  documentVersions,
  driverDocuments,
  driverMileageEntries,
  drivers,
  employeeContracts,
  employees,
  facilities,
  factoringCompanies,
  invoiceBatches,
  invoiceBatchItems,
  invoiceItems,
  invoices,
  loadActivity,
  loads,
  loadStops,
  onboardingCases,
  onboardingDocumentRequests,
  organizationCounters,
  payments,
  plannerEvents,
  settlementItems,
  settlements,
  trailers,
  trucks,
  vendors,
  violations,
  workOrders,
} from '../schema/index.js';
import { documentStorageKey, PLACEHOLDER_PDF, PLACEHOLDER_PDF_MIME, PLACEHOLDER_PDF_SHA256 } from '../seed/demo/documents.js';
import { insertPlannerDefaults } from '../seed/demo/planner.js';

// Test-only business data for the second tenant, "Test Carrier Co": at least one row
// in every tenant-owned domain table (docs/06-multi-tenancy.md §4), so integration tests
// can prove that lists, reads and writes never cross organizations. Names and human
// numbers are distinct from the demo organization's, so a leaked row is recognisable.

export const OTHER_ORG_FIXTURE = {
  timezone: 'America/Chicago',
  customerName: 'Prairie Goods Co',
  contactName: 'Casey Field',
  carrierName: 'Test Carrier Co',
  facilityNames: ['Prairie Goods DC', 'Gulf Receiving', 'Test Carrier shop'],
  driverName: 'Terry Wheeler',
  dispatcherName: 'Morgan Hayes',
  candidateName: 'Riley Stone',
  truckUnit: 'TC-01',
  trailerUnit: 'TC-T1',
  // Board load (in transit) and an archived, delivered one.
  loadNumber: 50001,
  archivedLoadNumber: 50000,
  // A sent invoice (batched) and a paid one (with its payment).
  invoiceNumber: 9001,
  paidInvoiceNumber: 9002,
  batchNumber: 3001,
  claimNumber: 2001,
  factoringCompanyName: 'Lone Star Factoring',
  vendorName: 'Texas Tire Supply',
  plannerEventTitle: 'Test Carrier standup',
  counters: { load: 50002, invoice: 9003, invoice_batch: 3002, claim: 2002 },
} as const;

const F = OTHER_ORG_FIXTURE;
const CHICAGO = F.timezone;

async function one<T>(rows: Promise<T[]>): Promise<T> {
  const [row] = await rows;
  if (!row) throw new Error('fixture insert returned nothing');
  return row;
}

export async function seedOtherOrganizationData(db: DbExecutor, organizationId: string): Promise<void> {
  const o = { organizationId };

  const customer = await one(db.insert(customers).values({ ...o, name: F.customerName, standing: 'growing', paymentTerms: 'net_30', position: 1 }).returning({ id: customers.id }));
  await db.insert(customerContacts).values({ ...o, customerId: customer.id, fullName: F.contactName, email: 'casey@prairiegoods.test', isPrimary: true, position: 1 });

  const carrier = await one(
    db.insert(carriers).values({ ...o, name: F.carrierName, mcNumber: '900001', dotNumber: '3000001', isOwnFleet: true, position: 1 }).returning({ id: carriers.id }),
  );

  const [pickupFacilityName, deliveryFacilityName, shopName] = F.facilityNames;
  const facilityRows = await db
    .insert(facilities)
    .values([
      { ...o, name: pickupFacilityName, kind: 'shipper', addressLine1: '100 Commerce St', city: 'Dallas', state: 'TX', timezone: CHICAGO },
      { ...o, name: deliveryFacilityName, kind: 'consignee', addressLine1: '200 Harbor Rd', city: 'Houston', state: 'TX', timezone: CHICAGO },
      { ...o, name: shopName, kind: 'shop', city: 'Dallas', state: 'TX', timezone: CHICAGO },
    ])
    .returning({ id: facilities.id, name: facilities.name });
  const facilityId = (name: string) => {
    const row = facilityRows.find((f) => f.name === name);
    if (!row) throw new Error(`fixture facility ${name} missing`);
    return row.id;
  };

  const [driverFirst = '', driverLast = ''] = F.driverName.split(' ');
  const [dispatcherFirst = '', dispatcherLast = ''] = F.dispatcherName.split(' ');
  const employeeRows = await db
    .insert(employees)
    .values([
      { ...o, firstName: driverFirst, lastName: driverLast, status: 'active' },
      { ...o, firstName: dispatcherFirst, lastName: dispatcherLast, status: 'active' },
    ])
    .returning({ id: employees.id, lastName: employees.lastName });
  const driverEmployee = employeeRows.find((e) => e.lastName === driverLast);
  const dispatcherEmployee = employeeRows.find((e) => e.lastName === dispatcherLast);
  if (!driverEmployee || !dispatcherEmployee) throw new Error('fixture employees missing');

  await db.insert(employeeContracts).values({
    ...o,
    employeeId: driverEmployee.id,
    role: 'company_driver',
    contractType: 'w2',
    status: 'active',
    startsOn: '2025-01-06',
    renewsOn: '2027-01-06',
    payBasis: 'per_mile',
    payRateCents: 55,
    position: 1,
  });
  const onboardingCase = await one(
    db
      .insert(onboardingCases)
      .values({
        ...o,
        candidateName: F.candidateName,
        role: 'company_driver',
        stage: 'application',
        startedOn: '2026-09-01',
        ownerEmployeeId: dispatcherEmployee.id,
        progressPercent: 20,
        nextStep: 'Phone screen',
        position: 1,
      })
      .returning({ id: onboardingCases.id }),
  );
  await db.insert(onboardingDocumentRequests).values({ ...o, onboardingCaseId: onboardingCase.id, label: 'MVR consent', status: 'pending', position: 1 });

  const driver = await one(
    db.insert(drivers).values({ ...o, employeeId: driverEmployee.id, dutyStatus: 'on_duty', hosRemainingMinutes: 300, position: 1 }).returning({ id: drivers.id }),
  );
  await db.insert(driverMileageEntries).values({ ...o, driverId: driver.id, recordedOn: '2026-09-03', miles: 900 });
  const truck = await one(
    db
      .insert(trucks)
      .values({
        ...o,
        unitNumber: F.truckUnit,
        make: 'Mack',
        model: 'Anthem',
        modelYear: 2023,
        plateState: 'TX',
        plateNumber: 'TCX1001',
        assignedDriverId: driver.id,
        odometerMiles: 120_000,
        nextServiceMiles: 150_000,
        status: 'in_service',
      })
      .returning({ id: trucks.id }),
  );
  const trailer = await one(
    db
      .insert(trailers)
      .values({ ...o, unitNumber: F.trailerUnit, trailerType: 'dry_van', lengthFt: 53, status: 'loaded', locationKind: 'city', locationCity: 'Dallas', locationState: 'TX', position: 1 })
      .returning({ id: trailers.id }),
  );

  const loadRows = await db
    .insert(loads)
    .values([
      {
        ...o,
        loadNumber: F.loadNumber,
        customerId: customer.id,
        tenderRef: 'PO TC-1',
        equipmentType: 'dry_van_53',
        commodity: 'Paper goods',
        weightLb: 30_000,
        carrierId: carrier.id,
        lineHaulCents: 150_000,
        loadedMiles: 240,
        emptyMiles: 20,
        driverPayCents: 40_000,
        paymentTerms: 'net_30',
        status: 'in_transit',
        createdAt: new Date('2026-09-03T00:00:00Z'),
      },
      {
        ...o,
        loadNumber: F.archivedLoadNumber,
        customerId: customer.id,
        lineHaulCents: 120_000,
        paymentTerms: 'net_30',
        status: 'delivered',
        archivedAt: new Date('2026-09-03T05:00:00Z'),
      },
    ])
    .returning({ id: loads.id, loadNumber: loads.loadNumber });
  const boardLoad = loadRows.find((l) => l.loadNumber === F.loadNumber);
  const archivedLoad = loadRows.find((l) => l.loadNumber === F.archivedLoadNumber);
  if (!boardLoad || !archivedLoad) throw new Error('fixture loads missing');

  await db.insert(loadStops).values([
    {
      ...o,
      loadId: boardLoad.id,
      sequence: 1,
      kind: 'pickup',
      status: 'completed',
      facilityId: facilityId(pickupFacilityName),
      facilityName: pickupFacilityName,
      addressLine1: '100 Commerce St',
      city: 'Dallas',
      state: 'TX',
      timezone: CHICAGO,
      appointmentDate: '2026-09-03',
      windowOpen: '08:00',
      windowClose: '10:00',
    },
    {
      ...o,
      loadId: boardLoad.id,
      sequence: 2,
      kind: 'delivery',
      status: 'pending',
      facilityId: facilityId(deliveryFacilityName),
      facilityName: deliveryFacilityName,
      addressLine1: '200 Harbor Rd',
      city: 'Houston',
      state: 'TX',
      timezone: CHICAGO,
      appointmentDate: '2026-09-04',
      windowOpen: '09:00',
      windowClose: '11:00',
    },
  ]);
  await db.insert(dispatches).values({ ...o, loadId: boardLoad.id, driverId: driver.id, truckId: truck.id, trailerId: trailer.id, status: 'assigned' });
  await db.insert(loadActivity).values({
    ...o,
    loadId: boardLoad.id,
    sequence: 1,
    occurredAt: new Date('2026-09-03T13:00:00Z'),
    kind: 'driver_accepted',
    message: 'Driver accepted the load in the app',
  });

  const document = await one(
    db
      .insert(documents)
      .values({ ...o, loadId: boardLoad.id, documentType: 'rate_confirmation', status: 'attached', position: 1, attachedAt: new Date('2026-09-03T14:00:00Z') })
      .returning({ id: documents.id }),
  );
  const versionId = randomUUID();
  await db.insert(documentVersions).values({
    ...o,
    id: versionId,
    documentId: document.id,
    versionNumber: 1,
    fileName: `rate-confirmation-L-${F.loadNumber}.pdf`,
    storageKey: documentStorageKey(organizationId, boardLoad.id, versionId),
    mimeType: PLACEHOLDER_PDF_MIME,
    sizeBytes: PLACEHOLDER_PDF.length,
    checksumSha256: PLACEHOLDER_PDF_SHA256,
    uploadedAt: new Date('2026-09-03T14:00:00Z'),
  });

  const factor = await one(db.insert(factoringCompanies).values({ ...o, name: F.factoringCompanyName }).returning({ id: factoringCompanies.id }));
  const invoiceRows = await db
    .insert(invoices)
    .values([
      { ...o, invoiceNumber: F.invoiceNumber, customerId: customer.id, status: 'sent', paymentTerms: 'net_30', issuedOn: '2026-09-01', dueOn: '2026-10-01' },
      { ...o, invoiceNumber: F.paidInvoiceNumber, customerId: customer.id, status: 'paid', paymentTerms: 'net_30', issuedOn: '2026-08-20', dueOn: '2026-09-19' },
    ])
    .returning({ id: invoices.id, invoiceNumber: invoices.invoiceNumber });
  const sentInvoice = invoiceRows.find((i) => i.invoiceNumber === F.invoiceNumber);
  const paidInvoice = invoiceRows.find((i) => i.invoiceNumber === F.paidInvoiceNumber);
  if (!sentInvoice || !paidInvoice) throw new Error('fixture invoices missing');
  await db.insert(invoiceItems).values([
    { ...o, invoiceId: sentInvoice.id, position: 1, loadId: boardLoad.id, description: 'Line haul', amountCents: 150_000 },
    { ...o, invoiceId: paidInvoice.id, position: 1, loadId: archivedLoad.id, description: 'Line haul', amountCents: 120_000 },
  ]);
  await db.insert(payments).values({
    ...o,
    invoiceId: paidInvoice.id,
    receivedAt: new Date('2026-09-02T15:00:00Z'),
    method: 'factoring',
    factoringCompanyId: factor.id,
    amountCents: 120_000,
  });
  const batch = await one(
    db.insert(invoiceBatches).values({ ...o, batchNumber: F.batchNumber, createdOn: '2026-09-02', customerId: customer.id, status: 'ready' }).returning({ id: invoiceBatches.id }),
  );
  await db.insert(invoiceBatchItems).values({ ...o, batchId: batch.id, invoiceId: sentInvoice.id });

  const vendor = await one(db.insert(vendors).values({ ...o, name: F.vendorName }).returning({ id: vendors.id }));
  await db.insert(bills).values({ ...o, vendorId: vendor.id, category: 'Tires', dueOn: '2026-09-10', amountCents: 50_000, status: 'due' });

  const settlement = await one(
    db
      .insert(settlements)
      .values({ ...o, driverId: driver.id, periodStart: '2026-09-01', periodEnd: '2026-09-07', payBasis: 'per_mile', payRateCents: 55, status: 'ready' })
      .returning({ id: settlements.id }),
  );
  await db.insert(settlementItems).values({ ...o, settlementId: settlement.id, position: 1, kind: 'line_pay', miles: 900, amountCents: 49_500 });

  await db.insert(workOrders).values({
    ...o,
    truckId: truck.id,
    item: 'PM service A',
    dueOn: '2026-09-15',
    shopFacilityId: facilityId(shopName),
    estimateCents: 30_000,
    status: 'scheduled',
    position: 1,
  });
  await db.insert(driverDocuments).values({ ...o, driverId: driver.id, documentType: 'cdl', expiresOn: '2028-05-31', expiresPrecision: 'month', status: 'valid', position: 1 });
  await db.insert(complianceReminders).values({ ...o, driverId: driver.id, itemLabel: 'Medical card', dueOn: '2026-10-01', duePrecision: 'day', position: 1 });
  await db.insert(violations).values({
    ...o,
    occurredOn: '2026-08-20',
    driverId: driver.id,
    truckId: truck.id,
    violationType: 'Lighting',
    severityPoints: 2,
    location: 'I-35 scale · Waco, TX',
    status: 'open',
  });
  await db.insert(claims).values({
    ...o,
    claimNumber: F.claimNumber,
    occurredOn: '2026-08-15',
    driverId: driver.id,
    truckId: truck.id,
    trailerId: trailer.id,
    claimType: 'cargo_damage',
    claimantKind: 'customer',
    claimantCustomerId: customer.id,
    reservedCents: 100_000,
    status: 'open',
  });

  // The organization's own default calendar: a non-demo organization gets the six color
  // codes and no events (the seed's function, as Reset calendar uses it; 03 §5.12.2).
  const { colorCodeIds } = await insertPlannerDefaults(db, organizationId);
  const meeting = { id: colorCodeIds.get('meeting') };
  if (!meeting.id) throw new Error('fixture color code missing');
  await db.insert(plannerEvents).values({
    ...o,
    title: F.plannerEventTitle,
    colorCodeId: meeting.id,
    startDate: '2026-09-03',
    startTime: '08:00',
    endTime: '08:30',
    people: [F.dispatcherName],
  });

  await db.insert(organizationCounters).values(Object.entries(F.counters).map(([key, nextValue]) => ({ ...o, key, nextValue })));
}
