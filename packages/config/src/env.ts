import { z } from 'zod';

export class EnvValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid environment configuration:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'EnvValidationError';
  }
}

// Parse process.env (or any record) against a schema. Error messages name the
// offending variables but never echo their values, since values may be secrets (§34).
export function parseEnv<S extends z.ZodType>(schema: S, source: Record<string, string | undefined> = process.env): z.output<S> {
  const result = schema.safeParse(source);
  if (result.success) return result.data;
  const issues = result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`);
  throw new EnvValidationError(issues);
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a YYYY-MM-DD date');

export const nodeEnvSchema = z.enum(['development', 'test', 'staging', 'production']).default('development');

export const apiEnvSchema = z
  .object({
    NODE_ENV: nodeEnvSchema,
    API_PORT: z.coerce.number().int().positive().default(4000),
    DATABASE_URL: z.url(),
    DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
    REDIS_URL: z.url(),
    // The web origin allowed to call the API with credentials (CSRF origin check).
    WEB_ORIGIN: z.url().default('http://localhost:3000'),
    SESSION_TTL_HOURS: z.coerce.number().int().positive().default(12),
    // S3-compatible object storage for documents (architecture §21). The bucket is private.
    S3_ENDPOINT: z.url().optional(),
    S3_REGION: z.string().min(1).default('us-east-1'),
    S3_BUCKET: z.string().min(3),
    S3_ACCESS_KEY_ID: z.string().min(1),
    S3_SECRET_ACCESS_KEY: z.string().min(1),
    S3_FORCE_PATH_STYLE: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    // Pins "today" for the demo dataset (Runtruck1 parity: 2026-09-03). Unset = real clock.
    DEMO_TODAY: isoDate.optional(),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug']).default('info'),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && env.DEMO_TODAY) {
      ctx.addIssue({ code: 'custom', path: ['DEMO_TODAY'], message: 'must not be set in production' });
    }
  });

export type ApiEnv = z.output<typeof apiEnvSchema>;

export const databaseEnvSchema = z.object({
  DATABASE_URL: z.url(),
});

export type DatabaseEnv = z.output<typeof databaseEnvSchema>;
