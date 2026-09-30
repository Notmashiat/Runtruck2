import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppError } from '../errors/app-error.js';
import { ZodValidationPipe } from './zod-validation.pipe.js';

const pipe = new ZodValidationPipe(z.object({ name: z.string().min(1), stops: z.array(z.object({ city: z.string() })) }));

describe('ZodValidationPipe', () => {
  it('returns the parsed value', () => {
    expect(pipe.transform({ name: 'x', stops: [] })).toEqual({ name: 'x', stops: [] });
  });

  it('throws VALIDATION_ERROR with dotted issue paths', () => {
    try {
      pipe.transform({ name: '', stops: [{ city: 3 }] });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      const e = err as AppError;
      expect(e.category).toBe('VALIDATION_ERROR');
      expect(e.issues?.map((i) => i.path)).toEqual(['name', 'stops.0.city']);
    }
  });
});
