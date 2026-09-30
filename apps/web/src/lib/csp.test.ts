import { getScriptNonceFromHeader } from 'next/dist/server/app-render/get-script-nonce-from-header';
import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy, createNonce, THEME_SCRIPT_HASH } from './csp';
import { THEME_SCRIPT } from './theme-script';

// The pages' Content-Security-Policy (docs/01 C79, docs/19 §2). Whether a browser loads the
// app under it without a violation is checked end to end (tests/e2e auth.spec.ts).

const NONCE = 'r4nd0mN0nce+/Ab12345678==';

function directives(policy: string): Map<string, string[]> {
  return new Map(
    policy.split(';').map((d) => {
      const [name = '', ...sources] = d.trim().split(/\s+/);
      return [name, sources];
    }),
  );
}

describe('contentSecurityPolicy', () => {
  it('allows only nonce-carrying scripts and the theme script in production', () => {
    const csp = directives(contentSecurityPolicy(NONCE, { dev: false }));
    expect(csp.get('script-src')).toEqual(["'self'", `'nonce-${NONCE}'`, "'strict-dynamic'", THEME_SCRIPT_HASH]);
    expect(csp.get('default-src')).toEqual(["'self'"]);
    expect(csp.get('object-src')).toEqual(["'none'"]);
    expect(csp.get('base-uri')).toEqual(["'self'"]);
    expect(csp.get('form-action')).toEqual(["'self'"]);
    expect(csp.get('connect-src')).toEqual(["'self'"]);
    for (const sources of csp.values()) expect(sources).not.toContain("'unsafe-eval'");
  });

  it('forbids framing by any site', () => {
    expect(directives(contentSecurityPolicy(NONCE, { dev: false })).get('frame-ancestors')).toEqual(["'none'"]);
  });

  it('allows the Google Fonts stylesheet and fonts of the root layout', () => {
    const csp = directives(contentSecurityPolicy(NONCE, { dev: false }));
    expect(csp.get('style-src')).toEqual(["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com']);
    expect(csp.get('font-src')).toEqual(["'self'", 'https://fonts.gstatic.com']);
  });

  it("adds 'unsafe-eval' to scripts under next dev only", () => {
    const csp = directives(contentSecurityPolicy(NONCE, { dev: true }));
    expect(csp.get('script-src')).toEqual(["'self'", `'nonce-${NONCE}'`, "'strict-dynamic'", THEME_SCRIPT_HASH, "'unsafe-eval'"]);
    expect(csp.get('frame-ancestors')).toEqual(["'none'"]);
  });

  it('carries the nonce where Next.js looks for it', () => {
    const nonce = createNonce();
    expect(getScriptNonceFromHeader(contentSecurityPolicy(nonce, { dev: false }))).toBe(nonce);
  });
});

describe('THEME_SCRIPT_HASH', () => {
  it('is the SHA-256 of the inline theme script', async () => {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(THEME_SCRIPT));
    expect(THEME_SCRIPT_HASH).toBe(`'sha256-${Buffer.from(digest).toString('base64')}'`);
  });
});

describe('createNonce', () => {
  it('is 128 random bits in base64, fresh on every call', () => {
    const nonces = new Set(Array.from({ length: 50 }, createNonce));
    expect(nonces.size).toBe(50);
    for (const nonce of nonces) {
      expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
      expect(Buffer.from(nonce, 'base64')).toHaveLength(16);
    }
  });
});
