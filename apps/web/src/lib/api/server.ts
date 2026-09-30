import type { ApiErrorBody, ApiSuccess, MeResponse } from '@runtruck/types';
import { cookies, headers } from 'next/headers';
import { cache } from 'react';

const API_ORIGIN = process.env.API_ORIGIN ?? 'http://localhost:4000';
const SESSION_COOKIE = 'rt_session';
export const PATHNAME_HEADER = 'x-runtruck-pathname';

export class ServerApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ServerApiError';
  }
}

// GET from the API on the server with the visitor's session cookie. The API
// decides validity and permissions, never the web server. Memoized per server
// request (React cache), so a read the /app layout and the page both prefetch
// (e.g. the uninvoiced loads on Accounting › Uninvoiced) and `/me` are sent once.
export const serverGet = cache(async function serverGet<T, M extends object = Record<string, never>>(
  path: string,
): Promise<ApiSuccess<T, M>> {
  const store = await cookies();
  const session = store.get(SESSION_COOKIE);
  const res = await fetch(`${API_ORIGIN}/api/v1${path}`, {
    headers: { accept: 'application/json', ...(session ? { cookie: `${SESSION_COOKIE}=${session.value}` } : {}) },
    cache: 'no-store',
  });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const error = (body as Partial<ApiErrorBody> | null)?.error;
    throw new ServerApiError(res.status, error?.code ?? 'INTERNAL_ERROR', error?.message ?? `HTTP ${res.status}`);
  }
  return body as ApiSuccess<T, M>;
});

// Server-side session check for protected layouts. Returns null when there is
// no valid session.
export async function getMe(): Promise<MeResponse | null> {
  const store = await cookies();
  if (!store.get(SESSION_COOKIE)) return null;
  try {
    return (await serverGet<MeResponse>('/me')).data;
  } catch (err) {
    if (err instanceof ServerApiError && err.status === 401) return null;
    throw err;
  }
}

// The requested path, forwarded by src/proxy.ts (layouts do not receive it).
export async function requestPathname(): Promise<string> {
  return (await headers()).get(PATHNAME_HEADER) ?? '';
}
