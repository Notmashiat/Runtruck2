import { isIP } from 'node:net';
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

// Express's named ranges for "trust proxy".
const TRUST_PROXY_NAMES = new Set(['loopback', 'linklocal', 'uniquelocal']);

// One "trust proxy" address entry: a named range, an IP, or an IP with a prefix length
// (10.0.0.0/8, fd00::/8) or an IPv4 netmask (10.0.0.0/255.0.0.0).
function isTrustProxyAddress(entry: string): boolean {
  if (TRUST_PROXY_NAMES.has(entry)) return true;
  const [address = '', range, ...rest] = entry.split('/');
  const family = isIP(address);
  if (family === 0 || rest.length > 0) return false;
  if (range === undefined) return true;
  if (/^\d{1,3}$/.test(range)) return Number(range) <= (family === 4 ? 32 : 128);
  return family === 4 && isIP(range) === 4;
}

// TRUST_PROXY, converted to what Express expects. Express reads a *string* as addresses
// only, so "1" would trust the address 0.0.0.1 and "true" would crash at boot; this turns
// digits into a hop count and a list into an array, and refuses anything else.
//   - digits ("1")            → the number of hops in front of the API to trust
//   - "false"                 → trust nothing: req.ip is the peer address
//   - addresses (comma list)  → trust exactly these hops, e.g. "loopback": the Next.js
//                               server on the same host
// "true" (trust every hop) is refused: any client could then choose req.ip and dodge the
// per-IP sign-in limit (docs/19-security.md G4). Next.js forwards X-Forwarded-For exactly as
// it received it and never adds its peer, so the trusted hop must be the web tier and an
// edge proxy in front of it must set the header (docs/21-deployment.md §2).
export const trustProxySchema = z
  .string()
  .trim()
  .min(1)
  .transform((value, ctx): number | false | string[] => {
    if (/^\d+$/.test(value)) return Number(value);
    if (value === 'false') return false;
    if (value === 'true') {
      ctx.addIssue({
        code: 'custom',
        message: 'must not be true (trusting every hop lets clients forge their IP); use a hop count or addresses',
      });
      return z.NEVER;
    }
    const entries = value.split(',').map((e) => e.trim());
    if (entries.some((e) => !isTrustProxyAddress(e))) {
      ctx.addIssue({
        code: 'custom',
        message: 'must be a hop count, false, or a comma-separated list of IP addresses, subnets or loopback/linklocal/uniquelocal',
      });
      return z.NEVER;
    }
    return entries;
  });

// Development and test: the Next.js server on the same host.
const DEFAULT_TRUST_PROXY: string[] = ['loopback'];

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
    // Which upstream hops may set X-Forwarded-For (Express "trust proxy"), see trustProxySchema.
    // Unset: "loopback" in development and test; staging and production must set it.
    TRUST_PROXY: trustProxySchema.optional(),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && env.DEMO_TODAY) {
      ctx.addIssue({ code: 'custom', path: ['DEMO_TODAY'], message: 'must not be set in production' });
    }
    // req.ip (the sign-in IP limit, sessions.ip_address, the sign-in audit) is only as good as
    // this setting, and the right value depends on the deployment's proxies: no default there.
    if ((env.NODE_ENV === 'production' || env.NODE_ENV === 'staging') && env.TRUST_PROXY === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['TRUST_PROXY'],
        message:
          'must be set in staging and production (the web tier, behind an edge proxy that sets X-Forwarded-For; docs/21-deployment.md §2)',
      });
    }
  })
  .transform(({ TRUST_PROXY, ...env }) => ({ ...env, TRUST_PROXY: TRUST_PROXY ?? DEFAULT_TRUST_PROXY }));

export type ApiEnv = z.output<typeof apiEnvSchema>;

export const databaseEnvSchema = z.object({
  DATABASE_URL: z.url(),
});

export type DatabaseEnv = z.output<typeof databaseEnvSchema>;
