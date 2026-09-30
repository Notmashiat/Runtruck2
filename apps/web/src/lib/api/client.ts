import type { ApiErrorBody, ApiErrorIssue, ApiSuccess } from '@runtruck/types';

// Browser-side API client. Requests go to the same origin (/api/v1/*), which the
// Next server proxies to the NestJS API, so the httpOnly session cookie rides
// along automatically. The API is the authority for every rule (architecture §5).

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId: string | undefined,
    readonly issues: ApiErrorIssue[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

async function request<T, M extends object>(method: Method, path: string, body?: unknown): Promise<ApiSuccess<T, M>> {
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  const res = await fetch(`/api/v1${path}`, {
    method,
    credentials: 'same-origin',
    headers: body === undefined || isForm ? { accept: 'application/json' } : { accept: 'application/json', 'content-type': 'application/json' },
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  });

  const json: unknown = await res.json().catch(() => null);
  if (res.ok) return json as ApiSuccess<T, M>;

  const error = (json as Partial<ApiErrorBody> | null)?.error;
  if (res.status === 401 && typeof window !== 'undefined' && !path.startsWith('/auth/')) {
    // Session expired or revoked: back to sign-in with a full page load, which
    // drops every cached query of the old session.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign('/login');
  }
  throw new ApiError(res.status, error?.code ?? 'INTERNAL_ERROR', error?.message ?? 'Something went wrong.', error?.requestId, error?.issues ?? []);
}

export const api = {
  get: <T, M extends object = Record<string, never>>(path: string) => request<T, M>('GET', path),
  post: <T, M extends object = Record<string, never>>(path: string, body?: unknown) => request<T, M>('POST', path, body ?? {}),
  patch: <T, M extends object = Record<string, never>>(path: string, body: unknown) => request<T, M>('PATCH', path, body),
  put: <T, M extends object = Record<string, never>>(path: string, body: unknown) => request<T, M>('PUT', path, body),
  delete: <T, M extends object = Record<string, never>>(path: string) => request<T, M>('DELETE', path),
  upload: <T, M extends object = Record<string, never>>(path: string, form: FormData) => request<T, M>('POST', path, form),
};

// Builds a query string from defined values only.
export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}
