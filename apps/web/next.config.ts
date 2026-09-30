import type { NextConfig } from 'next';

// Where the Next.js server forwards /api/v1/* (server-side only; never exposed to
// the browser). The browser therefore talks to one origin, so the httpOnly
// session cookie works without CORS (docs/05-authentication.md).
const API_ORIGIN = process.env.API_ORIGIN ?? 'http://localhost:4000';

// Security headers for every response of the web app (docs/19 §2, docs/01 C79). No other
// site may frame a page: the signed-in app has one-click money actions (Payroll "Approve
// all"), and SameSite=Lax lets a same-site frame carry the session. The proxied API
// responses (/api/v1) keep the API's own helmet headers instead of getting a second set.
// Pages also get a Content-Security-Policy (frame-ancestors 'none', nonce-based scripts);
// it needs a fresh nonce per request, so src/proxy.ts sets it (lib/csp.ts), not this list.
const SECURITY_HEADERS = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
];

// Runtruck1's legacy section URLs (App.tsx:70-77), kept so old links still land. `{/}?`:
// react-router also matched them with a trailing slash.
const LEGACY_REDIRECTS: [source: string, destination: string][] = [
  ['/app/drivers', '/app/fleet/drivers'],
  ['/app/trucks', '/app/fleet/trucks'],
  ['/app/customers', '/app/crm'],
  ['/app/invoices', '/app/accounting/invoiced'],
  ['/app/settlements', '/app/accounting/payroll'],
  ['/app/accounting/settlements', '/app/accounting/payroll'],
];

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Runtruck1 kept the URL as typed, trailing slash included (docs/01 §3); Next's
  // default would 308 '/app/crm/' to '/app/crm'. Routes still match with the slash.
  skipTrailingSlashRedirect: true,
  headers() {
    return Promise.resolve([{ source: '/((?!api/v1(?:/|$)).*)', headers: SECURITY_HEADERS }]);
  },
  // The rewrite proxy forwards the browser's X-Forwarded-For exactly as received and never
  // adds the peer address (Next's proxy-request.js: httpxy without xfwd). The web tier can
  // therefore never vouch for the client IP: the API trusts only this hop (TRUST_PROXY), and
  // an edge proxy in front of the web tier must set X-Forwarded-For from its peer address
  // (docs/05-authentication.md §2, docs/21-deployment.md §2, docs/01 C80).
  rewrites() {
    return Promise.resolve([{ source: '/api/v1/:path*', destination: `${API_ORIGIN}/api/v1/:path*` }]);
  },
  redirects() {
    return Promise.resolve(LEGACY_REDIRECTS.map(([source, destination]) => ({ source: `${source}{/}?`, destination, permanent: false })));
  },
};

export default config;
