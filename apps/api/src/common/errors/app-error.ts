import { HttpStatus } from '@nestjs/common';

// Error categories (architecture §29). Every error response carries one of these
// as `category`-derived HTTP status plus a specific `code` (e.g. LOAD_NOT_FOUND).
export const ERROR_CATEGORIES = {
  VALIDATION_ERROR: HttpStatus.BAD_REQUEST,
  UNAUTHORIZED: HttpStatus.UNAUTHORIZED,
  FORBIDDEN: HttpStatus.FORBIDDEN,
  NOT_FOUND: HttpStatus.NOT_FOUND,
  CONFLICT: HttpStatus.CONFLICT,
  RATE_LIMITED: HttpStatus.TOO_MANY_REQUESTS,
  INTEGRATION_ERROR: HttpStatus.BAD_GATEWAY,
  INTERNAL_ERROR: HttpStatus.INTERNAL_SERVER_ERROR,
} as const;

export type ErrorCategory = keyof typeof ERROR_CATEGORIES;

export interface ErrorIssue {
  path: string;
  message: string;
}

// A deliberate, user-safe error. The message is shown to users, so it must never
// contain internals (SQL, stack traces, secrets — §29).
export class AppError extends Error {
  constructor(
    readonly category: ErrorCategory,
    readonly code: string,
    message: string,
    readonly issues?: ErrorIssue[],
  ) {
    super(message);
    this.name = 'AppError';
  }

  get status(): number {
    return ERROR_CATEGORIES[this.category];
  }

  static notFound(code: string, message: string): AppError {
    return new AppError('NOT_FOUND', code, message);
  }

  static forbidden(message = 'You do not have permission to do that.'): AppError {
    return new AppError('FORBIDDEN', 'FORBIDDEN', message);
  }

  static unauthorized(message = 'Sign in to continue.'): AppError {
    return new AppError('UNAUTHORIZED', 'UNAUTHORIZED', message);
  }

  static conflict(code: string, message: string): AppError {
    return new AppError('CONFLICT', code, message);
  }

  static validation(issues: ErrorIssue[], message = 'Some fields are invalid.'): AppError {
    return new AppError('VALIDATION_ERROR', 'VALIDATION_ERROR', message, issues);
  }

  static rateLimited(message = 'Too many attempts. Try again later.'): AppError {
    return new AppError('RATE_LIMITED', 'RATE_LIMITED', message);
  }
}
