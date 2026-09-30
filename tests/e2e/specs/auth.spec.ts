import { expect, test } from './fixtures.js';
import { signIn } from './helpers.js';

test.describe('sign-in', () => {
  test('protects the app and sends visitors to the login page', async ({ page }) => {
    await page.goto('/app/loads');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });

  test('rejects a wrong password with a generic message', async ({ page, browserErrors }) => {
    // Chromium logs the refused sign-in request itself.
    browserErrors.allow(/Failed to load resource: the server responded with a status of 401/);
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

// "Log out" fails closed (docs/01 C78): the page is left only once the session is gone.
test.describe('log out when the API cannot end the session', () => {
  const FAILED =
    'Log out did not finish, so you are still signed in.\n\nPress OK to try again, or Cancel to sign out of this browser only.';

  test.beforeEach(async ({ page, browserErrors }) => {
    // Chromium logs each failed request the test provokes.
    browserErrors.allow(/Failed to load resource: the server responded with a status of 502/);
    await signIn(page);
    await page.route('**/api/v1/auth/logout', (route) => route.fulfill({ status: 502, body: 'Bad Gateway' }));
  });

  test('offers a retry, and leaves once the retry ends the session', async ({ page }) => {
    // The API is back before the member retries: the first request falls back to the 502
    // above, the retry reaches the API. (No unroute while the confirm is open: it blocks.)
    let calls = 0;
    await page.route('**/api/v1/auth/logout', (route) => (++calls === 1 ? route.fallback() : route.continue()));
    const dialogs: string[] = [];
    page.on('dialog', (dialog) => {
      dialogs.push(dialog.message());
      void dialog.accept();
    });
    await page.getByRole('link', { name: 'Log out' }).click();
    await expect(page).toHaveURL(/\/$/);
    expect(dialogs).toEqual([FAILED]);
    await page.goto('/app/dashboard');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('Cancel signs this browser out through the web origin', async ({ page }) => {
    const dialogs: string[] = [];
    page.on('dialog', (dialog) => {
      dialogs.push(dialog.message());
      // Retry once (still failing), then give up.
      void (dialogs.length === 1 ? dialog.accept() : dialog.dismiss());
    });
    await page.getByRole('link', { name: 'Log out' }).click();
    await expect(page).toHaveURL(/\/$/);
    expect(dialogs).toEqual([FAILED, FAILED]);
    expect((await page.context().cookies()).filter((c) => c.name === 'rt_session')).toEqual([]);
    await page.getByRole('link', { name: 'Log in' }).click();
    await expect(page).toHaveURL(/\/login$/);
  });

  test('stays signed in on the page when the browser cannot be signed out either', async ({ page }) => {
    await page.route('**/sign-out', (route) => route.fulfill({ status: 502, body: 'Bad Gateway' }));
    const dialogs: string[] = [];
    page.on('dialog', (dialog) => {
      dialogs.push(`${dialog.type()}: ${dialog.message()}`);
      void dialog.dismiss();
    });
    await page.getByRole('link', { name: 'Log out' }).click();
    await expect
      .poll(() => dialogs)
      .toEqual([`confirm: ${FAILED}`, 'alert: Could not sign out. You are still signed in. Try again in a moment.']);
    await expect(page).toHaveURL(/\/app\/dashboard$/);
    await page.reload();
    await expect(page.locator('.ui-user-name')).toHaveText('Rosa Medina');
  });
});

// Every web page is hardened (docs/01 C79, docs/19 §2): no other site may frame it, and its
// scripts run only by the per-request nonce Next.js puts on them (or, for the inline theme
// script, by its hash).
test('web pages send the anti-framing, hardening and script-policy headers', async ({ page }) => {
  const nonces = new Set<string>();
  const expectHardened = async (path: string) => {
    const res = await page.request.get(path, { maxRedirects: 0 });
    expect(res.status(), path).toBe(200);
    const headers = res.headers();
    const csp = headers['content-security-policy'] ?? '';
    expect(csp, path).toContain("frame-ancestors 'none'");
    expect(headers['x-frame-options'], path).toBe('DENY');
    expect(headers['x-content-type-options'], path).toBe('nosniff');
    expect(headers['referrer-policy'], path).toBe('strict-origin-when-cross-origin');

    const scriptSrc =
      csp
        .split(';')
        .map((d) => d.trim())
        .find((d) => d.startsWith('script-src ')) ?? '';
    expect(scriptSrc, path).toContain("'strict-dynamic'");
    expect(scriptSrc, path).not.toContain("'unsafe-inline'");
    expect(scriptSrc, path).not.toContain("'unsafe-eval'");
    const nonce = /'nonce-([^']+)'/.exec(scriptSrc)?.[1] ?? '';
    expect(nonce, path).not.toBe('');
    nonces.add(nonce);

    // Rendered per request with that nonce on every script but the hashed theme script.
    const html = await res.text();
    const scripts = [...html.matchAll(/<script\b([^>]*)>/g)].map((m) => m[1] ?? '');
    expect(scripts.length, path).toBeGreaterThan(1);
    expect(
      scripts.filter((attrs) => !attrs.includes(`nonce="${nonce}"`)),
      path,
    ).toEqual(['']);
    expect(html, path).toContain('<script>try{document.documentElement.dataset.theme=');
  };
  const pages = ['/', '/login', '/app/dashboard', '/app/accounting/payroll', '/APP/Planner'];
  await expectHardened('/');
  await expectHardened('/login');
  await signIn(page);
  for (const path of pages.slice(2)) await expectHardened(path);
  // A fresh nonce for every response.
  expect(nonces.size).toBe(pages.length);

  // The proxied API keeps its own helmet headers: one set, not the web's added on top.
  const api = (await page.request.get('/api/v1/me')).headers();
  expect(api['x-frame-options']).toMatch(/^[A-Z]+$/);
  expect(api['content-security-policy']).toContain('default-src');
  expect(api['content-security-policy']).not.toContain("'nonce-");
});

// The suite's fixture (fixtures.ts) fails a test on any securitypolicyviolation event, CSP
// refusal or other console error. This test visits what exercises the policy: server-rendered
// pages, client navigation ('strict-dynamic' chunks) and the hashed theme script.
test('the app runs under its Content-Security-Policy without a violation', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Log in' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await signIn(page);
  for (const path of ['/app/planner', '/app/loads', '/app/accounting/payroll', '/app/fleet/trucks']) {
    await page.goto(path);
    // Hydrated: the Settings dialog opens only through React.
    await page.locator('.ui-sidebar').getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeHidden();
  }
  // Client-side navigation loads further chunks ('strict-dynamic').
  await page.locator('.ui-nav').getByRole('link', { name: 'Dashboard', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/dashboard$/);
  await expect(page.locator('.ui-kpi').first()).toBeVisible();

  // The inline theme script, allowed by its hash, applies a saved dark theme on load.
  await page.evaluate(() => {
    localStorage.setItem('runtruck-theme', 'dark');
  });
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});
