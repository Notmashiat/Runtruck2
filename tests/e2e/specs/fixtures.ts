import { expect, test as base, type Page } from '@playwright/test';

// The suite's `test`: every test also fails when a page it opened logs a console error,
// throws an uncaught error, or violates the Content-Security-Policy (docs/19 §2, docs/01 C79;
// docs/20-testing.md). Chromium reports blocked resources and CSP refusals as console
// errors; the init script adds each `securitypolicyviolation` event explicitly, and failed
// requests ("Failed to load resource") count too. A test that provokes an error on purpose
// (a refused sign-in, an API made to fail) allows exactly that message with
// `browserErrors.allow(/…/)`.

export interface BrowserErrors {
  allow: (pattern: RegExp) => void;
}

export const test = base.extend<{ browserErrors: BrowserErrors }>({
  browserErrors: [
    async ({ context }, use) => {
      const seen: string[] = [];
      const allowed: RegExp[] = [];
      const watch = (page: Page) => {
        page.on('console', (msg) => {
          if (msg.type() === 'error') seen.push(`console error on ${page.url()}: ${msg.text()}`);
        });
        page.on('pageerror', (err) => {
          seen.push(`uncaught error on ${page.url()}: ${err.message}`);
        });
      };
      context.pages().forEach(watch);
      context.on('page', watch);
      await context.addInitScript(() => {
        document.addEventListener('securitypolicyviolation', (e) => {
          console.error(`CSP violation: ${e.violatedDirective} blocked ${e.blockedURI || 'inline'}`);
        });
      });

      await use({
        allow: (pattern) => {
          allowed.push(pattern);
        },
      });

      const unexpected = seen.filter((line) => !allowed.some((pattern) => pattern.test(line)));
      expect(unexpected, 'console errors, uncaught errors or CSP violations in the browser').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
