import { expect, test } from './fixtures.js';
import { latestAuditNext, resetDemoData } from '../demo-data.js';
import { expectKpis, field, signIn } from './helpers.js';

// docs/20 §4 workflow 2 (architecture §31 "Create Load → Assign Driver → Upload"): New Load
// with an own-fleet driver, two stops, rates and a PDF, then the load on its detail page,
// the Loads board, the Planner and the Dashboard. Priya Raman's CDL is expired: dispatch
// records a compliance warning but never blocks (brief §8 C27).

// A minimal, well-formed one-page PDF (the API detects the type from the bytes).
const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
);

test.describe('New Load', () => {
  test.beforeAll(async () => {
    await resetDemoData();
  });

  test('creates an own-fleet load for Priya Raman and shows it on the board, detail page, planner and dashboard', async ({ page }) => {
    await signIn(page);
    await page.locator('.ui-nav').getByRole('link', { name: 'Loads', exact: true }).click();
    await expect(page).toHaveURL(/\/app\/loads$/);
    await expect(page.locator('.ui-card-title')).toHaveText('5 loads');

    await page.getByRole('button', { name: '+ New Load' }).click();
    const dialog = page.getByRole('dialog', { name: 'New load' });
    await expect(dialog).toBeVisible();
    const section = (name: string) => dialog.locator('.ui-dialog-nav').getByRole('button', { name, exact: true });

    // Load info
    await field(dialog, 'Customer').selectOption({ label: 'Northgate Foods' });
    await field(dialog, 'Tender / reference #').fill('PO E2E-7001');
    await field(dialog, 'Equipment').selectOption({ label: 'Dry van, 53 ft' });

    // Stops: a pickup and a delivery inside the planner's current week.
    await section('Stops').click();
    const stops = dialog.locator('.ui-panel');
    await expect(stops).toHaveCount(2);
    const stopValues = [
      {
        facility: 'Valley Cannery',
        address: '1200 Kansas Ave',
        city: 'Modesto',
        state: 'CA',
        zip: '95351',
        date: '2026-09-04',
        from: '08:00',
        to: '10:00',
      },
      {
        facility: 'Rose City Grocers DC',
        address: '4400 NW Yeon Ave',
        city: 'Portland',
        state: 'OR',
        zip: '97210',
        date: '2026-09-05',
        from: '13:00',
        to: '15:00',
      },
    ];
    for (const [i, s] of stopValues.entries()) {
      const stop = stops.nth(i);
      await field(stop, 'Facility').fill(s.facility);
      await field(stop, 'Street address').fill(s.address);
      await field(stop, 'City').fill(s.city);
      await field(stop, 'State').fill(s.state);
      await field(stop, 'ZIP').fill(s.zip);
      await field(stop, 'Date').fill(s.date);
      await field(stop, 'Window opens').fill(s.from);
      await field(stop, 'Window closes').fill(s.to);
    }

    // Freight
    await section('Freight').click();
    await field(dialog, 'Commodity').fill('Canned tomatoes');
    await field(dialog, 'Weight (lb)').fill('42000');

    // Carrier: own fleet (the default), then the driver.
    await section('Carrier').click();
    await expect(dialog.getByRole('group', { name: 'Hauled by' }).locator('.is-active')).toHaveText('Own fleet');
    await section('Driver & equipment').click();
    const driver = field(dialog, 'Driver');
    const priya = await driver.locator('option', { hasText: 'Priya Raman' }).getAttribute('value');
    if (!priya) throw new Error('Priya Raman is not in the Driver select');
    await driver.selectOption(priya);
    // Choosing a driver fills in their truck.
    await expect(field(dialog, 'Truck').locator('option:checked')).toContainText('T-103');

    // Rates
    await section('Rates').click();
    await field(dialog, 'Line haul ($)').fill('3200');
    await field(dialog, 'Fuel surcharge ($)').fill('250');
    await field(dialog, 'Loaded miles').fill('640');
    await field(dialog, 'Driver pay ($)').fill('800');

    // Documents: attach the rate confirmation.
    await section('Documents').click();
    const rateCon = dialog.locator('.ui-file-row', { hasText: 'Rate confirmation' });
    await rateCon.locator('input[type=file]').setInputFiles({ name: 'rate-con-e2e.pdf', mimeType: 'application/pdf', buffer: PDF });
    await expect(rateCon).toContainText('rate-con-e2e.pdf');

    // Review, then create.
    await section('Review').click();
    await expect(dialog.locator('.ui-note')).toHaveText('Everything required is filled in. It goes on the board as Dispatched.');
    await dialog.getByRole('button', { name: 'Create load' }).click();

    // Detail page of the new load.
    await expect(page).toHaveURL(/\/app\/loads\/L-40223$/);
    await expect(dialog).toBeHidden();
    await expect(page.locator('.ui-card .ui-h2')).toHaveText('Modesto, CA → Portland, OR');
    await expect(page.getByText('Load L-40223 · Northgate Foods · Dispatched')).toBeVisible();
    await expectKpis(page, [
      ['Miles', '640'],
      ['Line haul', '$3,200', '$5.00 / mi'],
      ['Driver pay', '$800'],
      ['Margin', '$2,650'],
    ]);
    const stopsCard = page.locator('.ui-card', { has: page.locator('.ui-card-title', { hasText: 'Stops' }) });
    await expect(stopsCard.locator('.ui-stop-name')).toHaveText(['Valley Cannery', 'Rose City Grocers DC']);
    const documents = page.locator('.ui-card', { has: page.locator('.ui-card-title', { hasText: 'Documents' }) });
    await expect(documents.getByText('Rate confirmation', { exact: true }).locator('..').locator('.ui-chip')).toHaveText('Attached');

    // Dispatching Priya Raman was not blocked; her expired CDL is on the audit trail.
    for (const action of ['LOAD_CREATED', 'LOAD_ASSIGNED']) {
      expect(await latestAuditNext(action, 'L-40223')).toMatchObject({
        complianceWarnings: [{ documentType: 'cdl', problem: 'expired', expiresOn: '2026-07-31', message: 'CDL expired on 2026-07-31.' }],
      });
    }

    // The board lists it (search by number).
    await page.getByRole('button', { name: '← Loads' }).click();
    await expect(page).toHaveURL(/\/app\/loads$/);
    await page.getByRole('textbox', { name: 'Search' }).fill('L-40223');
    await expect(page.locator('.ui-card-title')).toHaveText('1 matching “L-40223”');
    const row = page.locator('.ui-table tbody tr').first();
    await expect(row).toContainText('L-40223');
    await expect(row).toContainText('PO E2E-7001');
    await expect(row).toContainText('Priya Raman');
    await expect(row).toContainText('$3,200');
    await expect(row.locator('.ui-chip')).toHaveText('Dispatched');

    // The planner shows both stops in the current week.
    await page.locator('.ui-nav').getByRole('link', { name: 'Planner', exact: true }).click();
    await expect(page.locator('.cal-ev', { hasText: 'Modesto, CA' }).filter({ hasText: 'L-40223' })).toBeVisible();
    await expect(page.locator('.cal-ev', { hasText: 'Portland, OR' }).filter({ hasText: 'L-40223' })).toBeVisible();

    // The dashboard counts it as active (dashboard.md §2.11 item 2).
    await page.locator('.ui-nav').getByRole('link', { name: 'Dashboard', exact: true }).click();
    await expect(page.locator('.ui-kpi').first().locator('.ui-kpi-value')).toHaveText('6');
    await expect(page.locator('.ui-kpi').first().locator('.ui-kpi-note')).toHaveText('+3 vs. last week');
    await expect(page.locator('.ui-table tbody tr').first()).toContainText('L-40223');
  });
});
