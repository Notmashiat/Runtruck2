import type { ApiSuccess, MeResponse } from '@runtruck/types';
import { cookies } from 'next/headers';

const API_ORIGIN = process.env.API_ORIGIN ?? 'http://localhost:4000';
const SESSION_COOKIE = 'rt_session';

// Server-side session check for protected layouts. Returns null when there is
// no valid session; the API decides validity, never the web server.
export async function getMe(): Promise<MeResponse | null> {
  const store = await cookies();
  const session = store.get(SESSION_COOKIE);
  if (!session) return null;

  const res = await fetch(`${API_ORIGIN}/api/v1/me`, {
    headers: { cookie: `${SESSION_COOKIE}=${session.value}`, accept: 'application/json' },
    cache: 'no-store',
  });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`Session check failed with HTTP ${res.status}`);
  const body = (await res.json()) as ApiSuccess<MeResponse>;
  return body.data;
}
