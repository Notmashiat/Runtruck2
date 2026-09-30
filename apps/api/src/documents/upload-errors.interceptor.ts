import { BadRequestException, type CallHandler, type ExecutionContext, Injectable, type NestInterceptor, PayloadTooLargeException } from '@nestjs/common';
import { catchError, type Observable, throwError } from 'rxjs';
import { AppError } from '../common/errors/app-error.js';

// Runs around multer's FileInterceptor and turns its limit errors into the documented
// codes (docs/api/documents.md §3): a file over 25 MiB (the stream is cut at the limit) is
// DOCUMENT_FILE_TOO_LARGE; an extra file or field, a wrongly named file part or a
// malformed multipart body is VALIDATION_ERROR. Multer's own messages never reach users.
@Injectable()
export class UploadErrorsInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      catchError((err: unknown) => {
        if (err instanceof PayloadTooLargeException) {
          return throwError(() => new AppError('VALIDATION_ERROR', 'DOCUMENT_FILE_TOO_LARGE', 'The file is larger than 25 MB.'));
        }
        if (err instanceof BadRequestException) {
          return throwError(() => AppError.validation([{ path: 'file', message: 'Send one file part named "file" and the document type.' }]));
        }
        return throwError(() => err);
      }),
    );
  }
}
