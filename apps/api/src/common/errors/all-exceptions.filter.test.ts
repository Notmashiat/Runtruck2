import { type ArgumentsHost, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { runWithRequestContext } from '../request-context/request-context.js';
import { AllExceptionsFilter } from './all-exceptions.filter.js';
import { AppError } from './app-error.js';

function capture(exception: unknown) {
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  const host = { switchToHttp: () => ({ getResponse: () => res }) } as unknown as ArgumentsHost;
  runWithRequestContext({ requestId: 'req-12345678' }, () => {
    new AllExceptionsFilter().catch(exception, host);
  });
  return { status: res.status.mock.calls[0]?.[0] as number, body: res.json.mock.calls[0]?.[0] as { error: Record<string, unknown> } };
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
