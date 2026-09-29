// Loads the repo's .env when present (local runs). CI provides the variables
// directly, so a missing file is fine.
export function loadDotEnv(): void {
  try {
    process.loadEnvFile(new URL('../../../.env', import.meta.url));
  } catch {
    // No .env file — rely on the environment.
  }
}
