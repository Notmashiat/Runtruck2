import { type NextRequest, NextResponse } from 'next/server';

const SESSION_COOKIE = 'rt_session';

// Runs before every page request (Next 16 "proxy", formerly middleware).
// 1. Runtruck1's router matched paths case-insensitively (/app/Loads worked);
//    Next's does not, so lower-case the static segments. The load number in
//    /app/loads/:loadNumber keeps its case.
// 2. Optimistic auth redirect: no session cookie → /login. This is only UX —
//    the /app layout verifies the session with the API, and the API enforces
//    every request (architecture §2 Rule 2).
export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  const segments = pathname.split('/');
  const lowered = segments.map((s, i) => (segments[1]?.toLowerCase() === 'app' && segments[2]?.toLowerCase() === 'loads' && i === 3 ? s : s.toLowerCase()));
  const normalized = lowered.join('/');
  if (normalized !== pathname) {
    const url = request.nextUrl.clone();
    url.pathname = normalized;
    return NextResponse.redirect(url);
  }

  if ((normalized === '/app' || normalized.startsWith('/app/')) && !request.cookies.has(SESSION_COOKIE)) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // Pages only: skip the API proxy, Next internals and static files.
  matcher: ['/((?!api/|_next/|favicon.svg|.*\\..*).*)'],
};
