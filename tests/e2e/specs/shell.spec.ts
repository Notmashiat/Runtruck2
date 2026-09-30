import { expect, test } from './fixtures.js';
import { signIn } from './helpers.js';

test.describe('app shell (Runtruck1 parity)', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test('sidebar lists the nine sections and highlights the active one', async ({ page }) => {
    const items = page.locator('.ui-nav .ui-nav-item');
    await expect(items).toHaveText(['Dashboard', 'Loads', 'Planner', 'Fleet', 'CRM', 'Facilities', 'Accounting', 'HR', 'Safety']);
    await expect(page.locator('.ui-nav .ui-nav-item.is-active')).toHaveText('Dashboard');
    await page.getByRole('link', { name: 'Fleet' }).click();
    await expect(page).toHaveURL(/\/app\/fleet\/drivers$/);
    await expect(page.locator('.ui-tabs .ui-tab')).toHaveText(['Drivers', 'Trucks', 'Trailers']);
    await expect(page.locator('.ui-tab.is-active')).toHaveText('Drivers');
  });

  test('routes are case-insensitive, legacy URLs redirect, unknown paths go home', async ({ page }) => {
    // Runtruck1 kept the URL as typed, case and trailing slash included (docs/01 §3).
    await page.goto('/app/Fleet/Trucks');
    await expect(page).toHaveURL(/\/app\/Fleet\/Trucks$/);
    await expect(page.locator('.ui-tab.is-active')).toHaveText('Trucks');
    await page.goto('/APP/DASHBOARD');
    await expect(page).toHaveURL(/\/APP\/DASHBOARD$/);
    await expect(page.locator('.ui-nav .ui-nav-item.is-active')).toHaveText('Dashboard');
    await page.goto('/app/crm/');
    await expect(page).toHaveURL(/\/app\/crm\/$/);
    await expect(page.locator('.ui-nav .ui-nav-item.is-active')).toHaveText('CRM');
    await page.goto('/app/Accounting/Uninvoiced/');
    await expect(page).toHaveURL(/\/app\/Accounting\/Uninvoiced\/$/);
    await expect(page.locator('.ui-topbar').getByRole('button', { name: /^Invoice \d+ loads$/ })).toBeVisible();
    await page.goto('/app/LOADS/L-40214/');
    await expect(page).toHaveURL(/\/app\/LOADS\/L-40214\/$/);
    await expect(page.getByRole('button', { name: '← Loads' })).toBeVisible();
    // Section roots go to their first tab under the URL as typed, as Runtruck1's index routes did.
    await page.goto('/app/Fleet');
    await expect(page).toHaveURL(/\/app\/Fleet\/drivers$/);
    await expect(page.locator('.ui-tab.is-active')).toHaveText('Drivers');
    await page.goto('/APP');
    await expect(page).toHaveURL(/\/APP\/dashboard$/);
    await page.goto('/app/safety/');
    await expect(page).toHaveURL(/\/app\/safety\/maintenance$/);
    await page.goto('/app/drivers/');
    await expect(page).toHaveURL(/\/app\/fleet\/drivers$/);
    await page.goto('/app/invoices');
    await expect(page).toHaveURL(/\/app\/accounting\/invoiced$/);
    await page.goto('/app/settlements');
    await expect(page).toHaveURL(/\/app\/accounting\/payroll$/);
    await page.goto('/app/no-such-page');
    await expect(page).toHaveURL(/\/$/);
  });

  test('Settings shows the profile and dark mode persists on this device', async ({ page }) => {
    await page.getByRole('button', { name: 'Settings' }).click();
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    await expect(dialog.locator('.ui-profile-name')).toHaveText('Rosa Medina');
    await expect(dialog.locator('.ui-avatar')).toHaveText('RM');
    await expect(dialog.locator('.ui-ids dd')).toHaveText(['100482731', '30017', 'rosa.medina@sunridgefreight.com']);

    await dialog.getByRole('button', { name: 'Appearance' }).click();
    await dialog.getByRole('switch', { name: 'Dark mode' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });
});
