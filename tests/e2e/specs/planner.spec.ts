import { expect, type Page, test } from '@playwright/test';
import { resetDemoData } from '../demo-data.js';
import { field, signIn } from './helpers.js';

// docs/20 §4 workflow 3: add, edit and delete a planner event, and "Reset calendar"
// restores the organization's defaults (docs/api/planner.md §3, D8). Every write goes
// through the API, so each change is checked again after a reload.

async function openPlanner(page: Page): Promise<void> {
  await signIn(page);
  await page.locator('.ui-nav').getByRole('link', { name: 'Planner', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/planner$/);
  await expect(page.getByText('Mon, Aug 31 – Sun, Sep 6')).toBeVisible();
}

// Adds a timed event through "+ Add Event" on Sunday morning, free in the seeded week.
// Without a place, the card's first line is the title (the "Event cards" defaults).
async function addEvent(page: Page, title: string): Promise<void> {
  await page.getByRole('button', { name: '+ Add Event' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add event' });
  await field(dialog, 'Title').fill(title);
  await field(dialog, 'Date').fill('2026-09-06');
  await field(dialog, 'Starts').fill('07:00');
  await field(dialog, 'Ends').fill('08:00');
  await dialog.locator('.ui-dialog-foot').getByRole('button', { name: 'Add event' }).click();
  await expect(dialog).toBeHidden();
}

const eventCard = (page: Page, title: string) => page.locator('.cal-ev').filter({ has: page.locator('.cal-ev-title', { hasText: title }) });

test.describe('Planner', () => {
  test.beforeEach(async () => {
    await resetDemoData();
  });

  test('adds, edits and deletes an event', async ({ page }) => {
    await openPlanner(page);

    await addEvent(page, 'E2E yard walk');
    await expect(eventCard(page, 'E2E yard walk')).toBeVisible();
    await expect(eventCard(page, 'E2E yard walk')).toContainText('7 AM – 8 AM');
    await page.reload();
    await expect(eventCard(page, 'E2E yard walk')).toBeVisible();

    // Edit from the popover.
    await eventCard(page, 'E2E yard walk').click();
    const popover = page.getByRole('dialog', { name: 'E2E yard walk' });
    await popover.getByRole('button', { name: 'Edit' }).click();
    const edit = page.getByRole('dialog', { name: 'Edit event' });
    await field(edit, 'Title').fill('E2E yard walk, rescheduled');
    await field(edit, 'Starts').fill('09:00');
    await field(edit, 'Ends').fill('10:30');
    await edit.getByRole('button', { name: 'Save' }).click();
    await expect(edit).toBeHidden();
    await expect(eventCard(page, 'E2E yard walk, rescheduled')).toContainText('9 AM – 10:30 AM');
    await page.reload();
    await expect(eventCard(page, 'E2E yard walk, rescheduled')).toContainText('9 AM – 10:30 AM');

    // Delete from the popover.
    await eventCard(page, 'E2E yard walk, rescheduled').click();
    await page.getByRole('dialog', { name: 'E2E yard walk, rescheduled' }).getByRole('button', { name: 'Delete' }).click();
    await expect(eventCard(page, 'E2E yard walk')).toHaveCount(0);
    await page.reload();
    await expect(page.locator('.cal-ev', { hasText: 'Payroll review — week of Sep 1' })).toBeVisible();
    await expect(eventCard(page, 'E2E yard walk')).toHaveCount(0);
  });

  test('load stops are read-only on the planner', async ({ page }) => {
    await openPlanner(page);
    await page.locator('.cal-ev', { hasText: 'Fresno, CA' }).filter({ hasText: 'L-40218' }).click();
    const popover = page.locator('.cal-pop');
    await expect(popover.getByRole('link', { name: 'Open load L-40218' })).toBeVisible();
    await expect(popover.getByRole('button', { name: 'Edit' })).toHaveCount(0);
    await expect(popover).toContainText('From the load board — change it on the load.');
  });

  test('adds, renames and deletes a color code', async ({ page }) => {
    await openPlanner(page);
    const legend = page.locator('.cal-legend .cal-legend-item');
    await expect(legend).toHaveText([
      'Loaded (pickup)',
      'Empty (delivery)',
      'Maintenance',
      'Driver schedule',
      'Meetings',
      'Billing & admin',
    ]);

    await page.getByRole('button', { name: 'Edit colors' }).click();
    const settings = page.getByRole('dialog', { name: 'Customize calendar' });
    const codes = settings.locator('.cal-code');
    await expect(codes).toHaveCount(6);
    await settings.getByRole('button', { name: '+ Add color code' }).click();
    await expect(codes).toHaveCount(7);

    // Renames are saved on blur (and after a 400 ms pause while typing).
    const name = codes.nth(6).getByRole('textbox', { name: 'Color code name' });
    await name.fill('E2E hauling');
    await name.blur();
    await expect(legend.nth(6)).toHaveText('E2E hauling');
    await settings.getByRole('button', { name: 'Close' }).click();
    await page.reload();
    await expect(legend.nth(6)).toHaveText('E2E hauling');

    await page.getByRole('button', { name: 'Edit colors' }).click();
    await expect(codes).toHaveCount(7);
    await codes.nth(6).getByRole('button', { name: 'Delete' }).click();
    await expect(codes).toHaveCount(6);
    await settings.getByRole('button', { name: 'Close' }).click();
    await page.reload();
    await expect(legend).toHaveCount(6);
    await expect(legend.filter({ hasText: 'E2E hauling' })).toHaveCount(0);
  });

  test('"Reset calendar" restores the default events', async ({ page }) => {
    await openPlanner(page);

    // Change the calendar: delete a seeded event and add one.
    await page.locator('.cal-ev', { hasText: 'Payroll review — week of Sep 1' }).click();
    await page.getByRole('dialog', { name: 'Payroll review — week of Sep 1' }).getByRole('button', { name: 'Delete' }).click();
    await expect(page.locator('.cal-ev', { hasText: 'Payroll review — week of Sep 1' })).toHaveCount(0);
    await addEvent(page, 'E2E temporary event');
    await expect(eventCard(page, 'E2E temporary event')).toBeVisible();

    // Customize → Layout → Reset, confirmed.
    await page.getByRole('button', { name: 'Customize' }).click();
    const settings = page.getByRole('dialog', { name: 'Customize calendar' });
    await expect(settings).toBeVisible();
    page.once('dialog', (confirm) => {
      expect(confirm.type()).toBe('confirm');
      void confirm.accept();
    });
    await settings.getByRole('button', { name: 'Reset', exact: true }).click();

    await expect(page.locator('.cal-ev', { hasText: 'Payroll review — week of Sep 1' })).toBeVisible();
    await expect(eventCard(page, 'E2E temporary event')).toHaveCount(0);
    await page.reload();
    await expect(page.locator('.cal-ev', { hasText: 'Payroll review — week of Sep 1' })).toBeVisible();
    await expect(eventCard(page, 'E2E temporary event')).toHaveCount(0);
  });
});
