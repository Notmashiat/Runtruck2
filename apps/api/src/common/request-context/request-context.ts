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
const VALID_INCOMING_ID = /^[A-Za-z0-9._-]{8,128}$/;

export function currentRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

export function runWithRequestContext<T>(data: RequestContextData, fn: () => T): T {
  return storage.run(data, fn);
}

// Express middleware: accept a well-formed incoming id (from the web proxy or a
// load balancer) or mint one, echo it back, and scope the rest of the request.
export function requestContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header(REQUEST_ID_HEADER);
  const requestId = incoming && VALID_INCOMING_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader(REQUEST_ID_HEADER, requestId);
  runWithRequestContext({ requestId }, next);
}
