import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createLoadSchema } from './index.js';

// The web's Content-Security-Policy has no 'unsafe-eval' (docs/01 C79): zod must never probe
// `new Function`, which the browser reports as a violation even when zod catches it.
describe('zod configuration', () => {
  it('runs jitless once the package is loaded', () => {
    expect(createLoadSchema).toBeDefined();
    expect(z.config().jitless).toBe(true);
  });
});
