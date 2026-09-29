import { Injectable, type PipeTransform } from '@nestjs/common';
import type { z } from 'zod';
import { AppError } from '../errors/app-error.js';

// Validates a body / query / param against a shared Zod schema from
// @runtruck/validation (architecture §16). Use as @Body(new ZodValidationPipe(schema)).
@Injectable()
export class ZodValidationPipe<S extends z.ZodType> implements PipeTransform<unknown, z.output<S>> {
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.output<S> {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;
    throw AppError.validation(result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })));
  }
}
