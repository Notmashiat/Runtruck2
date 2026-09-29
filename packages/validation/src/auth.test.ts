import { describe, expect, it } from 'vitest';
import { loginSchema } from './auth.js';
import { pageQuerySchema } from './common.js';

describe('loginSchema', () => {
  it('normalizes the email', () => {
    expect(loginSchema.parse({ email: '  Rosa.Medina@SunridgeFreight.com ', password: 'x' }).email).toBe('rosa.medina@sunridgefreight.com');
  });

  it('rejects a malformed email and an empty password', () => {
    const result = loginSchema.safeParse({ email: 'not-an-email', password: '' });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.path.join('.'))).toEqual(['email', 'password']);
  });

  it('caps password length', () => {
    expect(loginSchema.safeParse({ email: 'a@b.co', password: 'x'.repeat(257) }).success).toBe(false);
  });
});

describe('pageQuerySchema', () => {
  it('defaults and coerces query-string values', () => {
    expect(pageQuerySchema.parse({})).toEqual({ limit: 100, offset: 0 });
    expect(pageQuerySchema.parse({ limit: '25', offset: '50', q: ' hale ' })).toEqual({ limit: 25, offset: 50, q: 'hale' });
  });

  it('refuses unbounded pages', () => {
    expect(pageQuerySchema.safeParse({ limit: '100000' }).success).toBe(false);
  });
});
