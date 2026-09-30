import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor } from '@nestjs/common';
import type { ApiSuccess } from '@runtruck/types';
import { map, type Observable } from 'rxjs';

const ENVELOPE = Symbol('runtruck.envelope');

interface Enveloped<T, M> {
  [ENVELOPE]: true;
  data: T;
  meta: M;
}

// Controllers return plain data, or `withMeta(data, meta)` when they have
// pagination or summary figures to add. Either way the client receives
// `{ data, meta }` (architecture §15).
export function withMeta<T, M extends object>(data: T, meta: M): Enveloped<T, M> {
  return { [ENVELOPE]: true, data, meta };
}

function isEnveloped(value: unknown): value is Enveloped<unknown, object> {
  return typeof value === 'object' && value !== null && ENVELOPE in value;
}

@Injectable()
export class EnvelopeInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<ApiSuccess<unknown, object>> {
    return next.handle().pipe(
      map((value: unknown) => (isEnveloped(value) ? { data: value.data, meta: value.meta } : { data: value ?? null, meta: {} })),
    );
  }
}
