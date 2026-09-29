import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';
import type { ApiErrorBody } from '@runtruck/types';
import { currentRequestId } from '../request-context/request-context.js';
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

// Turns every thrown value into the standard error envelope (architecture §15, §29).
// Only AppError messages reach users verbatim; everything unexpected becomes a
// generic INTERNAL_ERROR and is logged server-side with the request ID.
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const requestId = currentRequestId() ?? 'unknown';
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

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const category = STATUS_TO_CATEGORY[status] ?? (status >= 500 ? 'INTERNAL_ERROR' : 'VALIDATION_ERROR');
      return { status, body: { error: { code: category, message: SAFE_MESSAGES[category], requestId } } };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: { error: { code: 'INTERNAL_ERROR', message: SAFE_MESSAGES.INTERNAL_ERROR, requestId } },
    };
  }
}
