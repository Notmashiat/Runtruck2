import 'reflect-metadata';
import type { INestApplication, LoggerService } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { ApiEnv } from '@runtruck/config';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { noStoreMiddleware } from './common/http/no-store.middleware.js';
import { requestContextMiddleware } from './common/request-context/request-context.js';
import { API_ENV } from './config/config.module.js';

export const API_PREFIX = 'api/v1';

// Largest JSON body accepted. The biggest valid request is a New Load with 50 stops and
// every text field at its maximum: about 50,000 UTF-16 units, which even fully \u-escaped
// (6 bytes each) stays under 400 kB. Larger bodies get 413 VALIDATION_ERROR (docs/04 §1).
export const JSON_BODY_LIMIT = '1mb';

// Builds the HTTP app exactly as production runs it; integration tests use the
// same function so they exercise the real guards, filters and middleware.
export async function createApp(logger?: LoggerService | false): Promise<INestApplication> {
  // bodyParser: false — the JSON parser is registered below, after the request id,
  // security headers and no-store, so a body it refuses (too large, malformed JSON,
  // unsupported encoding) is still answered with all three (architecture §29).
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: logger ?? undefined,
    bufferLogs: logger === undefined,
    bodyParser: false,
  });
  const env = app.get<ApiEnv>(API_ENV);
  // Which hops may set X-Forwarded-For (a hop count, false, or trusted addresses; parsed by
  // @runtruck/config). req.ip, the sign-in IP limit and sessions.ip_address depend on it
  // (docs/05-authentication.md §2, docs/21-deployment.md §2).
  app.set('trust proxy', env.TRUST_PROXY);
  app.disable('x-powered-by');
  app.use(requestContextMiddleware, helmet(), noStoreMiddleware);
  app.useBodyParser('json', { limit: JSON_BODY_LIMIT });
  app.setGlobalPrefix(API_PREFIX);
  app.enableShutdownHooks();
  return app;
}
