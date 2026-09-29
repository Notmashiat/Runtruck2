import 'reflect-metadata';
import type { INestApplication, LoggerService } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { ApiEnv } from '@runtruck/config';
import { AppModule } from './app.module.js';
import { API_ENV } from './config/config.module.js';

export const API_PREFIX = 'api/v1';

// Builds the HTTP app exactly as production runs it; integration tests use the
// same function so they exercise the real guards, filters and middleware.
export async function createApp(logger?: LoggerService | false): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: logger ?? undefined, bufferLogs: logger === undefined });
  const env = app.get<ApiEnv>(API_ENV);
  // Only trusted proxies may set X-Forwarded-For; otherwise clients could spoof
  // req.ip and dodge per-IP sign-in throttling.
  app.set('trust proxy', env.TRUST_PROXY);
  app.disable('x-powered-by');
  app.setGlobalPrefix(API_PREFIX);
  app.enableShutdownHooks();
  return app;
}
