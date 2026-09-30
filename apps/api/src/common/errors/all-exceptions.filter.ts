import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';
import type { ApiErrorBody } from '@runtruck/types';
import { currentRequestId, responseRequestId } from '../request-context/request-context.js';
import { AppError, type ErrorCategory } from './app-error.js';

const STATUS_TO_CATEGORY: Record<number, ErrorCategory> = {
  [HttpStatus.BAD_REQUEST]: 'VALIDATION_ERROR',
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHORIZED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.METHOD_NOT_ALLOWED]: 'NOT_FOUND',
  [HttpStatus.CONFLICT]: 'CONFLICT',
  [HttpStatus.PAYLOAD_TOO_LARGE]: 'VALIDATION_ERROR',
  [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: 'VALIDATION_ERROR',
  [HttpStatus.TOO_MANY_REQUESTS]: 'RATE_LIMITED',
};

const SAFE_MESSAGES: Record<ErrorCategory, string> = {
  VALIDATION_ERROR: 'The request is invalid.',
  UNAUTHORIZED: 'Sign in to continue.',
  FORBIDDEN: 'You do not have permission to do that.',
  NOT_FOUND: 'Not found.',
  CONFLICT: 'The request conflicts with the current state.',
  RATE_LIMITED: 'Too many requests. Try again later.',
  INTEGRATION_ERROR: 'An external service failed. Try again later.',
  INTERNAL_ERROR: 'Something went wrong. Try again, and contact support with the request ID if it keeps happening.',
};

// Statuses whose generic category message would mislead: the body itself was refused.
const STATUS_MESSAGES: Partial<Record<number, string>> = {
  [HttpStatus.PAYLOAD_TOO_LARGE]: 'The request body is too large.',
  [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: 'The request body uses an unsupported encoding or character set.',
};

// A client error raised by Express or its body parser (the `http-errors` shape: a numeric
// 4xx `status`/`statusCode` and `expose: true`), e.g. a JSON body over the limit (413) or
// an unsupported Content-Encoding or charset (415). Such errors are not HttpExceptions.
function clientHttpErrorStatus(exception: unknown): number | null {
  if (typeof exception !== 'object' || exception === null) return null;
  const { status, statusCode, expose } = exception as { status?: unknown; statusCode?: unknown; expose?: unknown };
  const code = typeof status === 'number' ? status : statusCode;
  if (expose !== true || typeof code !== 'number' || !Number.isInteger(code) || code < 400 || code > 499) return null;
  return code;
}

// Turns every thrown value into the standard error envelope (architecture §15, §29).
// Only AppError messages reach users verbatim; everything unexpected becomes a
// generic INTERNAL_ERROR and is logged server-side with the request ID.
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    // The async context is the source; the response header covers an error raised where the
    // context did not reach (the middleware sets both before any other code runs).
    const requestId = currentRequestId() ?? responseRequestId(res) ?? 'unknown';
    const { status, body } = this.toResponse(exception, requestId);

    if (status >= 500) {
      const err = exception instanceof Error ? exception : new Error(String(exception));
      this.logger.error({ message: err.message, requestId, stack: err.stack });
    }

    res.status(status).json(body);
  }

  private toResponse(exception: unknown, requestId: string): { status: number; body: ApiErrorBody } {
    if (exception instanceof AppError) {
      return {
        status: exception.status,
        body: {
          error: {
            code: exception.code,
            message: exception.message,
            requestId,
            ...(exception.issues ? { issues: exception.issues } : {}),
          },
        },
      };
    }

    const status = exception instanceof HttpException ? exception.getStatus() : clientHttpErrorStatus(exception);
    if (status !== null) {
      const category = STATUS_TO_CATEGORY[status] ?? (status >= 500 ? 'INTERNAL_ERROR' : 'VALIDATION_ERROR');
      return { status, body: { error: { code: category, message: STATUS_MESSAGES[status] ?? SAFE_MESSAGES[category], requestId } } };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: { error: { code: 'INTERNAL_ERROR', message: SAFE_MESSAGES.INTERNAL_ERROR, requestId } },
    };
  }
}
