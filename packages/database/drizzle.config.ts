import { defineConfig } from 'drizzle-kit';

// drizzle-kit reads the compiled schema so it resolves the package's ESM `.js` imports.
// Run `pnpm build` first (the root `db:generate` script is wired through turbo for that).
export default defineConfig({
  dialect: 'postgresql',
  schema: './dist/schema/index.js',
  out: './drizzle',
  casing: 'snake_case',
  strict: true,
  verbose: true,
});
