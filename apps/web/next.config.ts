import type { NextConfig } from 'next';

// Where the Next.js server forwards /api/v1/* (server-side only; never exposed to
// the browser). The browser therefore talks to one origin, so the httpOnly
// session cookie works without CORS (docs/05-authentication.md).
const API_ORIGIN = process.env.API_ORIGIN ?? 'http://localhost:4000';

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async rewrites() {
    return [{ source: '/api/v1/:path*', destination: `${API_ORIGIN}/api/v1/:path*` }];
  },
  // Runtruck1's legacy section URLs (App.tsx:70-77), kept so old links still land.
  async redirects() {
    return [
      { source: '/app/drivers', destination: '/app/fleet/drivers', permanent: false },
      { source: '/app/trucks', destination: '/app/fleet/trucks', permanent: false },
      { source: '/app/customers', destination: '/app/crm', permanent: false },
      { source: '/app/invoices', destination: '/app/accounting/invoiced', permanent: false },
      { source: '/app/settlements', destination: '/app/accounting/payroll', permanent: false },
      { source: '/app/accounting/settlements', destination: '/app/accounting/payroll', permanent: false },
    ];
  },
};

export default config;
