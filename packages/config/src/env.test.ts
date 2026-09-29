import { describe, expect, it } from 'vitest';
import { apiEnvSchema, EnvValidationError, parseEnv } from './env.js';

const valid = {
  DATABASE_URL: 'postgres://runtruck:secret@localhost:5432/runtruck',
  REDIS_URL: 'redis://localhost:6379',
  S3_BUCKET: 'runtruck-documents',
  S3_ACCESS_KEY_ID: 'key',
  S3_SECRET_ACCESS_KEY: 'secret',
};

describe('parseEnv(apiEnvSchema)', () => {
  it('applies defaults', () => {
    const env = parseEnv(apiEnvSchema, valid);
    expect(env.API_PORT).toBe(4000);
    expect(env.NODE_ENV).toBe('development');
    expect(env.WEB_ORIGIN).toBe('http://localhost:3000');
    expect(env.DEMO_TODAY).toBeUndefined();
    expect(env.S3_FORCE_PATH_STYLE).toBe(false);
    expect(env.S3_REGION).toBe('us-east-1');
  });

  it('parses the MinIO settings', () => {
    const env = parseEnv(apiEnvSchema, { ...valid, S3_ENDPOINT: 'http://localhost:9000', S3_FORCE_PATH_STYLE: 'true' });
    expect(env.S3_ENDPOINT).toBe('http://localhost:9000');
    expect(env.S3_FORCE_PATH_STYLE).toBe(true);
  });

  it('names missing variables without leaking values', () => {
    try {
      parseEnv(apiEnvSchema, { REDIS_URL: 'redis://user:hunter2@localhost:6379' });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(EnvValidationError);
      expect((err as Error).message).toContain('DATABASE_URL');
      expect((err as Error).message).not.toContain('hunter2');
    }
  });

  it('rejects a malformed DEMO_TODAY', () => {
    expect(() => parseEnv(apiEnvSchema, { ...valid, DEMO_TODAY: 'Sep 3' })).toThrow(/DEMO_TODAY/);
  });

  it('refuses DEMO_TODAY in production', () => {
    expect(() => parseEnv(apiEnvSchema, { ...valid, NODE_ENV: 'production', DEMO_TODAY: '2026-09-03' })).toThrow(/DEMO_TODAY/);
  });
});
