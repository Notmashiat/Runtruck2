import { createHash, randomBytes } from 'node:crypto';
import { THEME_SCRIPT } from './theme-script';

// The Content-Security-Policy of every web page (docs/19 §2, docs/01 C79). src/proxy.ts sends it
// with a fresh nonce on each page response, and on the request too: Next.js reads the nonce
// from there and puts it on its own scripts (runtime, page chunks, the inline RSC payload).
// Only a page rendered per request can carry that nonce, so the root layout opts every page
// into dynamic rendering (app/layout.tsx). Server-only (node:crypto).
//
// - script-src: Next's scripts by nonce, the chunks they load through 'strict-dynamic', and
//   the inline theme script by its hash. Never 'unsafe-inline'; 'unsafe-eval' only under
//   `next dev`, where React's debugging tools need it.
// - style-src: the app's stylesheets, the Google Fonts stylesheet, and inline styles (React's
//   style={…} props are attributes, which no nonce or hash can allow).
// - frame-ancestors 'none': no other site may frame a page (clickjacking of one-click money
//   actions such as Payroll "Approve all"); X-Frame-Options: DENY in next.config.ts says the
//   same to older browsers.

export const THEME_SCRIPT_HASH = `'sha256-${createHash('sha256').update(THEME_SCRIPT, 'utf8').digest('base64')}'`;

// 128 random bits, base64: the form Next.js extracts ('nonce-…').
export function createNonce(): string {
  return randomBytes(16).toString('base64');
}

export function contentSecurityPolicy(nonce: string, { dev }: { dev: boolean }): string {
  const directives: [name: string, sources: string[]][] = [
    ['default-src', ["'self'"]],
    ['script-src', ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", THEME_SCRIPT_HASH, ...(dev ? ["'unsafe-eval'"] : [])]],
    ['style-src', ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com']],
    ['font-src', ["'self'", 'https://fonts.gstatic.com']],
    ['img-src', ["'self'", 'data:', 'blob:']],
    ['connect-src', ["'self'"]],
    ['object-src', ["'none'"]],
    ['base-uri', ["'self'"]],
    ['form-action', ["'self'"]],
    ['frame-ancestors', ["'none'"]],
  ];
  return directives.map(([name, sources]) => `${name} ${sources.join(' ')}`).join('; ');
}
