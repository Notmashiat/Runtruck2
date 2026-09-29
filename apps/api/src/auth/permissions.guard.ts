import { type CanActivate, type ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { hasPermissions, type Permission } from '@runtruck/permissions';
import type { Request } from 'express';
import { AppError } from '../common/errors/app-error.js';
import { AUTHENTICATED_ONLY, IS_PUBLIC, REQUIRED_PERMISSIONS } from './decorators.js';

// Global guard #2 — authorization (architecture §12 "Required permission?").
// Deny by default: a non-public route that declares neither @RequirePermissions
// nor @AuthenticatedOnly is refused, so a forgotten decorator fails closed.
// Organization scoping ("Correct organization?") happens in each service's
// queries, which always filter by the session's organization id.
@Injectable()
export class PermissionsGuard implements CanActivate {
  private readonly logger = new Logger(PermissionsGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC, targets)) return true;

    const req = context.switchToHttp().getRequest<Request>();
    if (!req.auth) throw AppError.unauthorized();

    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(REQUIRED_PERMISSIONS, targets);
    const authenticatedOnly = this.reflector.getAllAndOverride<boolean | undefined>(AUTHENTICATED_ONLY, targets);

    if (!required && !authenticatedOnly) {
      this.logger.error(`${context.getClass().name}.${context.getHandler().name} declares no permissions; refusing.`);
      throw AppError.forbidden();
    }
    if (required && !hasPermissions(req.auth.permissions, required)) throw AppError.forbidden();
    return true;
  }
}
