import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.js';
import { resetDemoData } from '../demo-data.js';
import { expectKpis, signIn } from './helpers.js';

// docs/20 §4 workflow 4: Payroll "Approve all" (and the header's "Run settlements") moves
// the three Ready settlements to Approved; Ellis (on hold) and Ana (paid) are unchanged,
// and the state survives a reload (docs/api/settlements.md §5).

const BEFORE = ['Ready', 'Ready', 'Hold · fuel', 'Ready', 'Paid'];
const AFTER = ['Approved', 'Approved', 'Hold · fuel', 'Approved', 'Paid'];

async function openPayroll(page: Page): Promise<void> {
  await signIn(page);
  await page.locator('.ui-nav').getByRole('link', { name: 'Accounting', exact: true }).click();
  await page.locator('.ui-tabs').getByRole('link', { name: 'Payroll', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/accounting\/payroll$/);
  await expect(page.locator('.ui-table tbody tr td:first-child')).toHaveText([
    'Marcus Hale',
    'Dara Whitfield',
    'Ellis Nakamura',
    'Priya Raman',
    'Ana Cortez',
  ]);
  await expect(page.locator('.ui-table tbody .ui-chip')).toHaveText(BEFORE);
  await expectKpis(page, [
    ['Drivers', '5', '3 ready to approve'],
    ['Gross', '$5,477', 'Week of Sep 1'],
    ['Deductions', '$512', 'Fuel advances and escrow'],
    ['Net payable', '$4,965', 'Awaiting approval'],
  ]);
}

async function expectApproved(page: Page): Promise<void> {
  await expect(page.locator('.ui-table tbody .ui-chip')).toHaveText(AFTER);
  await expect(page.locator('.ui-card-head').getByRole('button', { name: 'Approved' })).toBeVisible();
  await expectKpis(page, [
    ['Drivers', '5', 'Approved for payment'],
    ['Gross', '$5,477', 'Week of Sep 1'],
    ['Deductions', '$512', 'Fuel advances and escrow'],
    ['Net payable', '$4,965', 'Approved'],
  ]);
}

test.describe('Payroll approval', () => {
  test.beforeEach(async () => {
    await resetDemoData();
  });

  test('"Approve all" approves the ready settlements and it survives a reload', async ({ page }) => {
    await openPayroll(page);
    await page.locator('.ui-card-head').getByRole('button', { name: 'Approve all' }).click();
    await expectApproved(page);

    await page.reload();
    await expectApproved(page);
  });

  test('the header\'s "Run settlements" does the same', async ({ page }) => {
    await openPayroll(page);
    await page.locator('.ui-topbar').getByRole('button', { name: 'Run settlements' }).click();
    await expectApproved(page);

    await page.reload();
    await expectApproved(page);
  });
});
