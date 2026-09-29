import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Post, Req, Res } from '@nestjs/common';
import type { ApiEnv } from '@runtruck/config';
import type { MeResponse } from '@runtruck/types';
import { type LoginInput, loginSchema } from '@runtruck/validation';
import type { CookieOptions, Request, Response } from 'express';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { API_ENV } from '../config/config.module.js';
import type { AuthContext } from './auth-context.js';
import { AuthService } from './auth.service.js';
import { Auth, AuthenticatedOnly, Public } from './decorators.js';
import { MeService } from './me.service.js';
import { SESSION_COOKIE, SessionService } from './session.service.js';

@Controller()
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly me: MeService,
    private readonly sessions: SessionService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  // POST /api/v1/auth/login → sets the httpOnly session cookie, returns the same body as GET /me.
  @Public()
  @Post('auth/login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MeResponse> {
    const result = await this.auth.login(body, { ipAddress: req.ip, userAgent: req.header('user-agent') });
    res.cookie(SESSION_COOKIE, result.session.token, { ...this.cookieOptions(), expires: result.session.expiresAt });
    const ctx = await this.sessions.resolve(result.session.token);
    if (!ctx) throw new Error('Session was not readable immediately after creation');
    return this.me.describe(ctx);
  }

  @AuthenticatedOnly()
  @Post('auth/logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Auth() ctx: AuthContext, @Res({ passthrough: true }) res: Response): Promise<null> {
    await this.auth.logout(ctx);
    res.clearCookie(SESSION_COOKIE, this.cookieOptions());
    return null;
  }

  @AuthenticatedOnly()
  @Get('me')
  describe(@Auth() ctx: AuthContext): Promise<MeResponse> {
    return this.me.describe(ctx);
  }

  private cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.env.NODE_ENV === 'production' || this.env.NODE_ENV === 'staging',
      path: '/',
    };
  }
}
