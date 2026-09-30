import { getScriptNonceFromHeader } from 'next/dist/server/app-render/get-script-nonce-from-header';
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { proxy } from './proxy';

// Runtruck1 matched routes case-insensitively and kept the URL as typed (docs/01 §3). The
// proxy therefore rewrites to the lower-cased route instead of redirecting.

const request = (path: string, signedIn = true) =>
  new NextRequest(`http://localhost:3000${path}`, { headers: signedIn ? { cookie: 'rt_session=token' } : {} });

const rewrittenTo = (res: Response) => {
  const target = res.headers.get('x-middleware-rewrite');
  return target === null ? null : new URL(target).pathname;
};

describe('proxy', () => {
  it('routes mixed-case paths without changing the address bar', () => {
    for (const [typed, route] of [
      ['/app/Fleet/Trucks', '/app/fleet/trucks'],
      ['/APP/DASHBOARD', '/app/dashboard'],
      ['/app/crm/', '/app/crm/'],
      ['/app/Accounting/Uninvoiced/', '/app/accounting/uninvoiced/'],
    ] as const) {
      const res = proxy(request(typed));
      expect(res.status, typed).toBe(200);
      expect(res.headers.get('location'), typed).toBeNull();
      expect(rewrittenTo(res), typed).toBe(typed === route ? null : route);
      expect(res.headers.get('x-middleware-request-x-runtruck-pathname'), typed).toBe(route);
      expect(res.headers.get('x-middleware-request-x-runtruck-typed-pathname'), typed).toBe(typed);
    }
  });

  it('overwrites a typed-path header sent by the client', () => {
    const req = new NextRequest('http://localhost:3000/app/Fleet', {
      headers: { cookie: 'rt_session=token', 'x-runtruck-typed-pathname': '//evil.example' },
    });
    expect(proxy(req).headers.get('x-middleware-request-x-runtruck-typed-pathname')).toBe('/app/Fleet');
  });

  it('keeps the load number case in /app/loads/:loadNumber', () => {
    expect(rewrittenTo(proxy(request('/app/LOADS/L-40214')))).toBe('/app/loads/L-40214');
    expect(rewrittenTo(proxy(request('/app/Loads/l-40221')))).toBe('/app/loads/l-40221');
    expect(rewrittenTo(proxy(request('/app/loads/L-40214/')))).toBeNull();
  });

  it('sends every page its Content-Security-Policy with a fresh nonce, also to Next.js', () => {
    const nonces = new Set<string>();
    for (const path of ['/', '/login', '/app/dashboard', '/APP/Planner', '/app/crm/']) {
      const res = proxy(request(path));
      const csp = res.headers.get('content-security-policy') ?? '';
      expect(csp, path).toContain("frame-ancestors 'none'");
      // Next.js reads the nonce for its scripts from the request's policy.
      expect(res.headers.get('x-middleware-request-content-security-policy'), path).toBe(csp);
      const nonce = getScriptNonceFromHeader(csp);
      expect(nonce, path).toBeTruthy();
      nonces.add(nonce ?? '');
    }
    expect(nonces.size).toBe(5);
  });

  it('overwrites a Content-Security-Policy sent by the client', () => {
    const req = new NextRequest('http://localhost:3000/login', {
      headers: { 'content-security-policy': "script-src 'nonce-chosenByAttacker'" },
    });
    const forwarded = proxy(req).headers.get('x-middleware-request-content-security-policy') ?? '';
    expect(getScriptNonceFromHeader(forwarded)).not.toBe('chosenByAttacker');
    expect(forwarded).toContain("frame-ancestors 'none'");
  });

  it('sends visitors without a session cookie to /login', () => {
    for (const path of ['/app/dashboard', '/APP/Fleet', '/app/']) {
      const res = proxy(request(path, false));
      expect(res.status, path).toBe(307);
      expect(new URL(res.headers.get('location') ?? '').pathname, path).toBe('/login');
    }
    expect(proxy(request('/Login', false)).headers.get('location')).toBeNull();
  });
});
