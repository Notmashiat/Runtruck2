import { getPathMatch } from 'next/dist/shared/lib/router/utils/path-match';
import { describe, expect, it } from 'vitest';
import config from '../next.config';

// next.config.ts routes, matched the way Next.js matches them (path-to-regexp, strict,
// case-insensitive: `experimental.caseSensitiveRoutes` is off).
const matcher = (source: string) => getPathMatch(source, { strict: true, removeUnnamedParams: true, sensitive: false });

describe('next.config headers', () => {
  it('hardens every web response, but leaves the proxied API its own helmet headers', async () => {
    const rules = (await config.headers?.()) ?? [];
    expect(rules).toHaveLength(1);
    const [rule] = rules;
    if (!rule) throw new Error('no header rule');
    expect(Object.fromEntries(rule.headers.map((h) => [h.key.toLowerCase(), h.value]))).toEqual({
      'x-frame-options': 'DENY',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'strict-origin-when-cross-origin',
    });
    // The page CSP needs a per-request nonce: src/proxy.ts sends it, never a second copy here.
    expect(rule.headers.some((h) => h.key.toLowerCase() === 'content-security-policy')).toBe(false);

    const match = matcher(rule.source);
    for (const path of [
      '/',
      '/login',
      '/sign-out',
      '/app/dashboard',
      '/app/accounting/payroll',
      '/APP/Fleet/',
      '/_next/static/chunks/main.js',
      '/favicon.svg',
      '/api',
      '/api/v1x',
    ]) {
      expect(match(path), path).not.toBe(false);
    }
    for (const path of ['/api/v1', '/api/v1/', '/api/v1/me', '/api/v1/auth/logout', '/API/V1/settlements']) {
      expect(match(path), path).toBe(false);
    }
  });
});

describe('next.config routing', () => {
  it('keeps a trailing slash in the address bar, as Runtruck1 did', () => {
    expect(config.skipTrailingSlashRedirect).toBe(true);
  });

  it("redirects Runtruck1's legacy section URLs, with or without a trailing slash, in any case", async () => {
    const redirects = (await config.redirects?.()) ?? [];
    const destinationOf = (path: string) => redirects.find((r) => matcher(r.source)(path) !== false)?.destination;
    expect(destinationOf('/app/drivers')).toBe('/app/fleet/drivers');
    expect(destinationOf('/app/Drivers/')).toBe('/app/fleet/drivers');
    expect(destinationOf('/app/trucks/')).toBe('/app/fleet/trucks');
    expect(destinationOf('/app/customers')).toBe('/app/crm');
    expect(destinationOf('/app/invoices')).toBe('/app/accounting/invoiced');
    expect(destinationOf('/app/settlements')).toBe('/app/accounting/payroll');
    expect(destinationOf('/APP/Accounting/Settlements/')).toBe('/app/accounting/payroll');
    expect(redirects.every((r) => !r.permanent)).toBe(true);
    for (const path of ['/app/drivers/x', '/app/fleet/drivers', '/app/crm', '/app/accounting/payroll'])
      expect(destinationOf(path), path).toBeUndefined();
  });
});
