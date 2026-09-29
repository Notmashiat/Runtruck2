import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ApiEnv } from '@runtruck/config';
import type { Request } from 'express';
import { AppError } from '../common/errors/app-error.js';
import { API_ENV } from '../config/config.module.js';
import { IS_PUBLIC } from './decorators.js';
import { SESSION_COOKIE, SessionService } from './session.service.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const MAX_TOKEN_LENGTH = 128;

// Global guard #1 — authentication (architecture §11, §12 "Authenticated?").
// Resolves the session cookie into req.auth and rejects unauthenticated calls to
// non-public routes. It also blocks cross-site state-changing requests: the
// session cookie is SameSite=Lax, and any browser Origin must be the web app.
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    this.assertSameOrigin(req);

    const cookies = req.cookies as Record<string, unknown> | undefined;
    const token = cookies?.[SESSION_COOKIE];
    if (typeof token === 'string' && token.length > 0 && token.length <= MAX_TOKEN_LENGTH) {
      const auth = await this.sessions.resolve(token);
      if (auth) req.auth = auth;
    }

    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;
    if (!req.auth) throw AppError.unauthorized();
    return true;
  }

  private assertSameOrigin(req: Request): void {
    if (SAFE_METHODS.has(req.method)) return;
    const origin = req.header('origin');
    // Browsers always send Origin on state-changing requests; non-browser clients
    // (tests, future mobile app with bearer tokens) do not carry the cookie risk.
    if (origin !== undefined && origin !== this.env.WEB_ORIGIN) {
      throw new AppError('FORBIDDEN', 'CROSS_ORIGIN_REJECTED', 'Cross-site request rejected.');
    }
  }
}
