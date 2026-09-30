import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

// Per-request correlation data (architecture §29: every unexpected error is
// logged with a request ID). Stored in AsyncLocalStorage so services and the
// audit/event writers can read it without threading it through every call.
export interface RequestContextData {
  requestId: string;
}

const storage = new AsyncLocalStorage<RequestContextData>();

export const REQUEST_ID_HEADER = 'x-request-id';

export function currentRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

export function runWithRequestContext<T>(data: RequestContextData, fn: () => T): T {
  return storage.run(data, fn);
}

// Express middleware, registered before every other middleware (create-app.ts), so even a
// body the JSON parser refuses is answered with a request id. The id is always minted
// here: an incoming `x-request-id` is ignored, because the Next.js rewrite forwards the
// browser's own header and a client-chosen id would end up on audit and outbox rows
// (architecture §29, §30; docs/19-security.md §2 "Correlation").
export function requestContextMiddleware(_req: Request, res: Response, next: NextFunction): void {
  const requestId = randomUUID();
  res.setHeader(REQUEST_ID_HEADER, requestId);
  runWithRequestContext({ requestId }, next);
}

// The id this response carries, for code that may run outside the request's async
// context (the exception filter answering an error raised by a body parser).
export function responseRequestId(res: Partial<Pick<Response, 'getHeader'>>): string | undefined {
  const value = res.getHeader?.(REQUEST_ID_HEADER);
  return typeof value === 'string' ? value : undefined;
}
