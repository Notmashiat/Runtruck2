import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { ClockModule } from './common/clock/clock.module.js';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter.js';
import { EnvelopeInterceptor } from './common/http/envelope.interceptor.js';
import { ConfigModule } from './config/config.module.js';
import { DatabaseModule } from './database/database.module.js';
import { DOMAIN_MODULES } from './domain-modules.js';
import { EventsModule } from './events/events.module.js';
import { HealthController } from './health/health.controller.js';
import { RedisModule } from './redis/redis.module.js';

@Module({
  imports: [ConfigModule, DatabaseModule, RedisModule, ClockModule, AuditModule, EventsModule, AuthModule, ...DOMAIN_MODULES],
  controllers: [HealthController],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // The request id, helmet and no-store run earlier, before the JSON body parser
    // (create-app.ts), so they also cover requests the parser refuses.
    consumer.apply(cookieParser()).forRoutes('*path');
  }
}
