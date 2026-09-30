import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Permission } from '@runtruck/permissions';
import type { Request } from 'express';
import { AppError } from '../common/errors/app-error.js';
import type { AuthContext } from './auth-context.js';

export const IS_PUBLIC = 'runtruck:isPublic';
export const REQUIRED_PERMISSIONS = 'runtruck:requiredPermissions';
export const AUTHENTICATED_ONLY = 'runtruck:authenticatedOnly';

// No session required (login, health). Everything else requires one.
export const Public = () => SetMetadata(IS_PUBLIC, true);

// The permissions a route needs (architecture §12, §13). Every non-public route
// must declare either this or @AuthenticatedOnly — the guard denies anything else.
export const RequirePermissions = (...permissions: Permission[]) => SetMetadata(REQUIRED_PERMISSIONS, permissions);

// Any signed-in member may call it (e.g. GET /me, logout).
export const AuthenticatedOnly = () => SetMetadata(AUTHENTICATED_ONLY, true);

// Injects the AuthContext the SessionGuard attached to the request.
export const Auth = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthContext => {
  const req = ctx.switchToHttp().getRequest<Request>();
  if (!req.auth) throw AppError.unauthorized();
  return req.auth;
});
