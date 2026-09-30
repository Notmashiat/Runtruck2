import type { ExecutionContext } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Permission } from '@runtruck/permissions';
import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../common/errors/app-error.js';
import type { AuthContext } from './auth-context.js';
import { AuthenticatedOnly, Public, RequirePermissions } from './decorators.js';
import { PermissionsGuard } from './permissions.guard.js';

class Routes {
  @Public() open() {}
  @RequirePermissions('loads.create') create() {}
  @AuthenticatedOnly() me() {}
  undecorated() {}
}

function contextFor(handler: keyof Routes, permissions: Permission[] | null): ExecutionContext {
  const auth: AuthContext | undefined = permissions
    ? { userId: 'u', organizationId: 'o', sessionId: 's', timezone: 'UTC', permissions: new Set(permissions) }
    : undefined;
  return {
    // Nest only reads decorator metadata off the function object; it is never called.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    getHandler: () => Routes.prototype[handler],
    getClass: () => Routes,
    switchToHttp: () => ({ getRequest: () => ({ auth }) }),
  } as unknown as ExecutionContext;
}

const guard = new PermissionsGuard(new Reflector());

describe('PermissionsGuard', () => {
  it('lets public routes through without a session', () => {
    expect(guard.canActivate(contextFor('open', null))).toBe(true);
  });

  it('requires the declared permission', () => {
    expect(guard.canActivate(contextFor('create', ['loads.create']))).toBe(true);
    expect(() => guard.canActivate(contextFor('create', ['loads.view']))).toThrow(AppError);
  });

  it('rejects unauthenticated calls to protected routes', () => {
    expect(() => guard.canActivate(contextFor('create', null))).toThrow(/Sign in/);
  });

  it('allows @AuthenticatedOnly routes for any member', () => {
    expect(guard.canActivate(contextFor('me', []))).toBe(true);
  });

  it('denies routes that declare no permissions (fail closed)', () => {
    const log = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    expect(() => guard.canActivate(contextFor('undecorated', ['loads.create', 'loads.view']))).toThrow(AppError);
    log.mockRestore();
  });
});
