import { defineConfig } from 'vitest/config';
import { swcPlugin } from './vitest.swc.js';

// Unit tests.
export default defineConfig({
  plugins: [await swcPlugin()],
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
