import { Body, Controller, Get, Param, Post, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { LoadDocument } from '@runtruck/types';
import { LOAD_DOCUMENT_MAX_BYTES, loadIdParamSchema, type LoadIdParam, uploadLoadDocumentSchema, type UploadLoadDocumentInput } from '@runtruck/validation';
import type { Request } from 'express';
import { Auth, RequirePermissions } from '../auth/decorators.js';
import type { AuthContext } from '../auth/auth-context.js';
import { AppError } from '../common/errors/app-error.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { DocumentsService, type ReceivedFile } from './documents.service.js';
import { UploadErrorsInterceptor } from './upload-errors.interceptor.js';

// docs/api/documents.md: a load's document slots and uploads into them.
@Controller('loads')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get(':id/documents')
  @RequirePermissions('documents.view')
  list(@Auth() ctx: AuthContext, @Param(new ZodValidationPipe(loadIdParamSchema)) params: LoadIdParam): Promise<LoadDocument[]> {
    return this.documents.list(ctx, params.id);
  }

  // One file part `file` (≤ 25 MiB) and one text field `documentType` (13 §4.1). Without
  // `dest` or `storage`, multer keeps the file in memory (never on disk) and cuts the stream
  // at the size limit.
  @Post(':id/documents')
  @RequirePermissions('documents.upload')
  @UseInterceptors(
    UploadErrorsInterceptor,
    FileInterceptor('file', {
      limits: { fileSize: LOAD_DOCUMENT_MAX_BYTES, files: 1, fields: 1, fieldSize: 1024, parts: 2 },
      defParamCharset: 'utf8',
    }),
  )
  upload(
    @Auth() ctx: AuthContext,
    @Req() req: Request,
    @Param(new ZodValidationPipe(loadIdParamSchema)) params: LoadIdParam,
    @Body(new ZodValidationPipe(uploadLoadDocumentSchema)) body: UploadLoadDocumentInput,
    @UploadedFile() file: ReceivedFile | undefined,
  ): Promise<LoadDocument> {
    if (!req.is('multipart/form-data')) throw AppError.validation([{ path: 'file', message: 'Send the file as multipart/form-data.' }]);
    return this.documents.upload(ctx, params.id, body.documentType, file);
  }
}
