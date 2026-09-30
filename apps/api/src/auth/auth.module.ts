import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { RateLimiterService } from '../common/rate-limit/rate-limiter.service.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { MeService } from './me.service.js';
import { PermissionsGuard } from './permissions.guard.js';
import { SessionGuard } from './session.guard.js';
import { SessionService } from './session.service.js';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    MeService,
    SessionService,
    RateLimiterService,
    // Order matters: authenticate first, then authorize.
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
  exports: [SessionService],
})
export class AuthModule {}
