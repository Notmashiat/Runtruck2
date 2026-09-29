import { describe, expect, it } from 'vitest';
import { apiEnvSchema, EnvValidationError, parseEnv } from './env.js';

const valid = {
  DATABASE_URL: 'postgres://runtruck:secret@localhost:5432/runtruck',
  REDIS_URL: 'redis://localhost:6379',
};

describe('parseEnv(apiEnvSchema)', () => {
  it('applies defaults', () => {
    const env = parseEnv(apiEnvSchema, valid);
    expect(env.API_PORT).toBe(4000);
    expect(env.NODE_ENV).toBe('development');
    expect(env.WEB_ORIGIN).toBe('http://localhost:3000');
    expect(env.DEMO_TODAY).toBeUndefined();
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
