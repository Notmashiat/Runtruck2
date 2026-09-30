import { type ArgumentsHost, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { runWithRequestContext } from '../request-context/request-context.js';
import { AllExceptionsFilter } from './all-exceptions.filter.js';
import { AppError } from './app-error.js';

function capture(exception: unknown, options: { inContext?: boolean; headerId?: string } = {}) {
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn(), getHeader: vi.fn(() => options.headerId) };
  const host = { switchToHttp: () => ({ getResponse: () => res }) } as unknown as ArgumentsHost;
  const run = () => {
    new AllExceptionsFilter().catch(exception, host);
  };
  if (options.inContext === false) run();
  else runWithRequestContext({ requestId: 'req-12345678' }, run);
  return { status: res.status.mock.calls[0]?.[0] as number, body: res.json.mock.calls[0]?.[0] as { error: Record<string, unknown> } };
}

// The shape body-parser's errors have (http-errors): not HttpExceptions.
function httpError(status: number, message: string, expose = status < 500): Error {
  return Object.assign(new Error(message), { status, statusCode: status, expose, type: 'entity.too.large' });
}

describe('AllExceptionsFilter', () => {
  it('passes AppError code, message and issues through with the request id', () => {
    const { status, body } = capture(AppError.validation([{ path: 'email', message: 'Required' }]));
    expect(status).toBe(400);
    expect(body).toEqual({
      error: { code: 'VALIDATION_ERROR', message: 'Some fields are invalid.', requestId: 'req-12345678', issues: [{ path: 'email', message: 'Required' }] },
    });
  });

  it('maps a specific not-found code', () => {
    const { status, body } = capture(AppError.notFound('LOAD_NOT_FOUND', 'Load was not found.'));
    expect(status).toBe(404);
    expect(body.error.code).toBe('LOAD_NOT_FOUND');
  });

  it('categorizes framework HTTP errors without leaking their message', () => {
    const { status, body } = capture(new HttpException('Cannot GET /secret/internal/path', HttpStatus.NOT_FOUND));
    expect(status).toBe(404);
    expect(body.error).toEqual({ code: 'NOT_FOUND', message: 'Not found.', requestId: 'req-12345678' });
  });

  it('categorizes body-parser client errors (413, 415, 400) without logging them as server errors', () => {
    const log = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const tooLarge = capture(httpError(413, 'request entity too large'));
    expect(tooLarge.status).toBe(413);
    expect(tooLarge.body.error).toEqual({ code: 'VALIDATION_ERROR', message: 'The request body is too large.', requestId: 'req-12345678' });
    const encoding = capture(httpError(415, 'unsupported content encoding "xyz"'));
    expect(encoding.status).toBe(415);
    expect(encoding.body.error).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'The request body uses an unsupported encoding or character set.',
      requestId: 'req-12345678',
    });
    const aborted = capture(httpError(400, 'request aborted'));
    expect(aborted.status).toBe(400);
    expect(aborted.body.error.code).toBe('VALIDATION_ERROR');
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it('treats unexposed or 5xx http-errors as unexpected', () => {
    const log = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    expect(capture(httpError(500, 'stream encoding should not be set')).status).toBe(500);
    expect(capture(httpError(400, 'internal detail', false)).body.error.code).toBe('INTERNAL_ERROR');
    expect(log).toHaveBeenCalledTimes(2);
    log.mockRestore();
  });

  it('falls back to the response header when the error arrives outside the request context', () => {
    const { body } = capture(httpError(413, 'too large'), { inContext: false, headerId: 'c1b1a3f0-0000-4000-8000-000000000001' });
    expect(body.error.requestId).toBe('c1b1a3f0-0000-4000-8000-000000000001');
  });

  it('hides unexpected errors behind INTERNAL_ERROR and logs them', () => {
    const log = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { status, body } = capture(new Error('relation "loads" does not exist at password=hunter2'));
    expect(status).toBe(500);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(body)).not.toContain('hunter2');
    expect(JSON.stringify(body)).not.toContain('relation');
    expect(log).toHaveBeenCalledOnce();
    log.mockRestore();
  });
});
