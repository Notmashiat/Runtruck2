import { ConsoleLogger } from '@nestjs/common';
import { apiEnvSchema, parseEnv } from '@runtruck/config';
import { createApp } from './create-app.js';

const env = parseEnv(apiEnvSchema);
// Structured JSON logs outside development (architecture §35).
const logger = new ConsoleLogger('runtruck-api', { json: env.NODE_ENV !== 'development', logLevels: levelsFrom(env.LOG_LEVEL) });

const app = await createApp(logger);
await app.listen(env.API_PORT);
logger.log(`API listening on port ${env.API_PORT}`);

function levelsFrom(level: typeof env.LOG_LEVEL): ('fatal' | 'error' | 'warn' | 'log' | 'debug')[] {
  const order = ['fatal', 'error', 'warn', 'log', 'debug'] as const;
  const index = { fatal: 0, error: 1, warn: 2, info: 3, debug: 4 }[level];
  return order.slice(0, index + 1);
}
