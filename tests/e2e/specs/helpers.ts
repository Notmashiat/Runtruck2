import { expect, type Locator, type Page } from '@playwright/test';
import { E2E } from '../env.js';

// Signs in through the real login form as the seeded demo admin (Rosa Medina).
export async function signIn(page: Page, email: string = E2E.adminEmail, password: string = E2E.password): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/app\/dashboard$/);
}

// The control of a Runtruck form field, found by its visible label ("Customer" also
// matches the required "Customer *"), within `scope` (a dialog or a panel).
export function field(scope: Locator, label: string): Locator {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const exact = new RegExp(`^${escaped}( \\*)?$`);
  return scope
    .locator('.ui-field')
    .filter({ has: scope.page().locator('.ui-field-label', { hasText: exact }) })
    .locator('input, select, textarea')
    .first();
}

// KPI tiles in page order: labels, values and (optionally) notes.
export async function expectKpis(page: Page, kpis: readonly (readonly [label: string, value: string, note?: string])[]): Promise<void> {
  await expect(page.locator('.ui-kpi-label')).toHaveText(kpis.map((k) => k[0]));
  await expect(page.locator('.ui-kpi-value')).toHaveText(kpis.map((k) => k[1]));
  for (const [i, [, , note]] of kpis.entries()) {
    if (note !== undefined) await expect(page.locator('.ui-kpi').nth(i).locator('.ui-kpi-note')).toHaveText(note);
  }
}
