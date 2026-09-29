import { expect, type Page } from '@playwright/test';
import { E2E } from '../env.js';

// Signs in through the real login form as the seeded demo admin (Rosa Medina).
export async function signIn(page: Page, email: string = E2E.adminEmail, password: string = E2E.password): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/app\/dashboard$/);
}
