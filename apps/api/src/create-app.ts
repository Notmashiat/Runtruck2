import 'reflect-metadata';
import type { INestApplication, LoggerService } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';

export const API_PREFIX = 'api/v1';

// Builds the HTTP app exactly as production runs it; integration tests use the
// same function so they exercise the real guards, filters and middleware.
export async function createApp(logger?: LoggerService | false): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: logger ?? undefined, bufferLogs: logger === undefined });
  // Behind the web app's proxy / a load balancer: trust one hop for req.ip.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.setGlobalPrefix(API_PREFIX);
  app.enableShutdownHooks();
  return app;
}
