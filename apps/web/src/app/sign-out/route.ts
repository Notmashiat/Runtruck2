import { type NextRequest, NextResponse } from 'next/server';

const SESSION_COOKIE = 'rt_session';

// The web origin's fallback for "Log out" (docs/01 C78, docs/05 §3). The Sidebar calls it
// only when POST /api/v1/auth/logout could not end the session (API unreachable or failing)
// and the member chose to sign out of this browser anyway. It clears the httpOnly session
// cookie, which page scripts cannot; the server session is not touched and simply expires.
// It grants nothing, reads nothing and never talks to the API.
export function POST(request: NextRequest): NextResponse {
  // Same-origin only (docs/05 §6), so another site cannot sign a member out.
  if (!isSameOrigin(request)) return new NextResponse(null, { status: 403 });
  // Like POST /auth/logout, it also drops what the browser cached for this origin while the
  // member was signed in, so the next person at a shared computer cannot read it back.
  const res = new NextResponse(null, { status: 204, headers: { 'cache-control': 'no-store', 'clear-site-data': '"cache"' } });
  const secure = request.nextUrl.protocol === 'https:' || request.headers.get('x-forwarded-proto') === 'https';
  // The same name, path and host as the API's cookie (docs/05 §1), expired.
  res.cookies.set({ name: SESSION_COOKIE, value: '', path: '/', httpOnly: true, sameSite: 'lax', secure, maxAge: 0, expires: new Date(0) });
  return res;
}

// Runtruck1 sent every unknown path to the landing page; a visit here behaves the same
// (the 307 to '/' of app/[...rest]/page.tsx). It never touches the cookie.
export function GET(): NextResponse {
  return new NextResponse(null, { status: 307, headers: { location: '/' } });
}

function isSameOrigin(request: NextRequest): boolean {
  const site = request.headers.get('sec-fetch-site');
  if (site !== null) return site === 'same-origin';
  const origin = request.headers.get('origin');
  // Browsers always send one of the two on a POST; a client without either carries no
  // cookie of the member's.
  if (origin === null) return true;
  try {
    return new URL(origin).host === (request.headers.get('x-forwarded-host') ?? request.headers.get('host'));
  } catch {
    return false;
  }
}
