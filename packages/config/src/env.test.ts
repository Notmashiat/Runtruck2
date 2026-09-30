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

  it('parses the local S3 (SeaweedFS) settings', () => {
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

  it('parses TRUST_PROXY into what Express expects (hop count, false or addresses)', () => {
    expect(parseEnv(apiEnvSchema, valid).TRUST_PROXY).toEqual(['loopback']);
    expect(parseEnv(apiEnvSchema, { ...valid, TRUST_PROXY: '1' }).TRUST_PROXY).toBe(1);
    expect(parseEnv(apiEnvSchema, { ...valid, TRUST_PROXY: '2' }).TRUST_PROXY).toBe(2);
    expect(parseEnv(apiEnvSchema, { ...valid, TRUST_PROXY: 'false' }).TRUST_PROXY).toBe(false);
    expect(parseEnv(apiEnvSchema, { ...valid, TRUST_PROXY: 'loopback, 10.0.0.0/8,fd00::/8, 192.168.0.0/255.255.0.0' }).TRUST_PROXY).toEqual(
      ['loopback', '10.0.0.0/8', 'fd00::/8', '192.168.0.0/255.255.0.0'],
    );
  });

  it('requires TRUST_PROXY in staging and production, where no default is safe', () => {
    expect(() => parseEnv(apiEnvSchema, { ...valid, NODE_ENV: 'production' })).toThrow(/TRUST_PROXY/);
    expect(() => parseEnv(apiEnvSchema, { ...valid, NODE_ENV: 'staging' })).toThrow(/TRUST_PROXY/);
    expect(parseEnv(apiEnvSchema, { ...valid, NODE_ENV: 'production', TRUST_PROXY: '10.0.1.0/24' }).TRUST_PROXY).toEqual(['10.0.1.0/24']);
    expect(parseEnv(apiEnvSchema, { ...valid, NODE_ENV: 'test' }).TRUST_PROXY).toEqual(['loopback']);
  });

  it('refuses TRUST_PROXY=true and malformed addresses', () => {
    expect(() => parseEnv(apiEnvSchema, { ...valid, TRUST_PROXY: 'true' })).toThrow(/TRUST_PROXY/);
    expect(() => parseEnv(apiEnvSchema, { ...valid, TRUST_PROXY: 'lb.internal' })).toThrow(/TRUST_PROXY/);
    expect(() => parseEnv(apiEnvSchema, { ...valid, TRUST_PROXY: '10.0.0.0/33' })).toThrow(/TRUST_PROXY/);
    expect(() => parseEnv(apiEnvSchema, { ...valid, TRUST_PROXY: '' })).toThrow(/TRUST_PROXY/);
  });
});
