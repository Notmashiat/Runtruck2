import { expect, test } from '@playwright/test';
import { signIn } from './helpers.js';

test.describe('sign-in', () => {
  test('protects the app and sends visitors to the login page', async ({ page }) => {
    await page.goto('/app/loads');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });

  test('rejects a wrong password with a generic message', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill('rosa.medina@sunridgefreight.com');
    await page.getByLabel('Password').fill('definitely-wrong');
    await page.getByRole('button', { name: 'Sign in' }).click();
    // Scoped to the form: Next's route announcer is also an (empty) alert region.
    await expect(page.locator('.rt-login-form').getByRole('alert')).toHaveText('Email or password is incorrect.');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('marketing "Log in" leads to sign-in, then into the dashboard; log out ends the session', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Log in' }).click();
    await expect(page).toHaveURL(/\/login$/);

    await signIn(page);
    await expect(page.locator('.ui-user-name')).toHaveText('Rosa Medina');
    await expect(page.locator('.ui-user-meta')).toHaveText('Dispatch · Sunridge Freight');

    await page.getByRole('link', { name: 'Log out' }).click();
    await expect(page).toHaveURL(/\/$/);
    await page.goto('/app/dashboard');
    await expect(page).toHaveURL(/\/login$/);
  });
});
