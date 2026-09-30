import { type NextRequest, NextResponse } from 'next/server';
import { contentSecurityPolicy, createNonce } from '@/lib/csp';

const SESSION_COOKIE = 'rt_session';
const CSP_HEADER = 'content-security-policy';

// Runs before every page request (Next 16 "proxy", formerly middleware).
// 1. Runtruck1's router matched paths case-insensitively (/app/Loads worked);
//    Next's does not, so the static segments are lower-cased for routing. It is a
//    rewrite, not a redirect: like Runtruck1, the address bar keeps the URL as typed
//    (the shell lower-cases usePathname() itself, lib/nav.ts parseAppPath). The load
//    number in /app/loads/:loadNumber keeps its case.
// 2. Optimistic auth redirect: no session cookie → /login. This is only UX —
//    the /app layout verifies the session with the API, and the API enforces
//    every request (architecture §2 Rule 2).
// 3. The page's Content-Security-Policy with a fresh nonce (lib/csp.ts), on the
//    response and on the request, where Next.js reads the nonce for its scripts.
export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  const segments = pathname.split('/');
  const lowered = segments.map((s, i) => (segments[1]?.toLowerCase() === 'app' && segments[2]?.toLowerCase() === 'loads' && i === 3 ? s : s.toLowerCase()));
  const normalized = lowered.join('/');

  if ((normalized === '/app' || normalized.startsWith('/app/')) && !request.cookies.has(SESSION_COOKIE)) {
    // A fresh URL: a clone of '/app/' would carry its trailing slash over to '/login/'.
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // Layouts do not receive the URL; forward it for server-side prefetching
  // (lib/api/server.ts requestPathname), the URL as typed for the section roots'
  // redirects (lib/typed-path.ts), and the policy whose nonce Next.js puts on its
  // scripts. Each overwrites anything the client sent.
  const csp = contentSecurityPolicy(createNonce(), { dev: process.env.NODE_ENV === 'development' });
  const forwarded = new Headers(request.headers);
  forwarded.set('x-runtruck-pathname', normalized);
  forwarded.set('x-runtruck-typed-pathname', pathname);
  forwarded.set(CSP_HEADER, csp);
  let res: NextResponse;
  if (normalized !== pathname) {
    const url = request.nextUrl.clone();
    url.pathname = normalized;
    res = NextResponse.rewrite(url, { request: { headers: forwarded } });
  } else {
    res = NextResponse.next({ request: { headers: forwarded } });
  }
  res.headers.set(CSP_HEADER, csp);
  return res;
}

export const config = {
  // Pages only: skip the API proxy, Next internals and static files.
  matcher: ['/((?!api/|_next/|favicon.svg|.*\\..*).*)'],
};
