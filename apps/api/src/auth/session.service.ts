import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { ApiEnv } from '@runtruck/config';
import { type Database, type DbExecutor, schema } from '@runtruck/database';
import { isPermission, type Permission } from '@runtruck/permissions';
import { and, eq, gt, isNull, lt, or } from 'drizzle-orm';
import { API_ENV } from '../config/config.module.js';
import { DB } from '../database/database.module.js';
import type { AuthContext } from './auth-context.js';

export const SESSION_COOKIE = 'rt_session';
// Refresh last_seen_at at most this often, so reads don't write on every request.
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// Housekeeping run hourly by the worker: drop sessions that expired or were
// revoked more than a day ago. Returns how many rows were removed.
export async function purgeStaleSessions(db: DbExecutor, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - 86_400_000);
  const removed = await db
    .delete(schema.sessions)
    .where(or(lt(schema.sessions.expiresAt, cutoff), lt(schema.sessions.revokedAt, cutoff)))
    .returning({ id: schema.sessions.id });
  return removed.length;
}

export interface NewSession {
  token: string;
  expiresAt: Date;
}

@Injectable()
export class SessionService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  async create(userId: string, organizationId: string, meta: { ipAddress?: string; userAgent?: string }, db: DbExecutor = this.db): Promise<NewSession> {
    // 256 bits of entropy; only the hash is stored.
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + this.env.SESSION_TTL_HOURS * 3_600_000);
    await db.insert(schema.sessions).values({
      tokenHash: hashToken(token),
      userId,
      organizationId,
      expiresAt,
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent?.slice(0, 512) ?? null,
    });
    return { token, expiresAt };
  }

  // Resolves a cookie token to an AuthContext, or null when the session is
  // unknown, expired, revoked, or its user/membership is no longer active.
  async resolve(token: string): Promise<AuthContext | null> {
    const now = new Date();
    const [row] = await this.db
      .select({
        sessionId: schema.sessions.id,
        userId: schema.sessions.userId,
        organizationId: schema.sessions.organizationId,
        lastSeenAt: schema.sessions.lastSeenAt,
        timezone: schema.organizations.timezone,
      })
      .from(schema.sessions)
      .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
      .innerJoin(schema.organizations, eq(schema.organizations.id, schema.sessions.organizationId))
      .innerJoin(
        schema.organizationMembers,
        and(eq(schema.organizationMembers.userId, schema.sessions.userId), eq(schema.organizationMembers.organizationId, schema.sessions.organizationId)),
      )
      .where(
        and(
          eq(schema.sessions.tokenHash, hashToken(token)),
          isNull(schema.sessions.revokedAt),
          gt(schema.sessions.expiresAt, now),
          eq(schema.users.status, 'active'),
          eq(schema.organizationMembers.status, 'active'),
        ),
      )
      .limit(1);
    if (!row) return null;

    if (now.getTime() - row.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
      await this.db.update(schema.sessions).set({ lastSeenAt: now }).where(eq(schema.sessions.id, row.sessionId));
    }

    return {
      userId: row.userId,
      organizationId: row.organizationId,
      sessionId: row.sessionId,
      timezone: row.timezone,
      permissions: await this.permissionsFor(row.userId, row.organizationId),
    };
  }

  async revoke(sessionId: string, db: DbExecutor = this.db): Promise<void> {
    await db.update(schema.sessions).set({ revokedAt: new Date() }).where(eq(schema.sessions.id, sessionId));
  }

  // Union of the permissions of every role the user holds in this organization.
  async permissionsFor(userId: string, organizationId: string): Promise<ReadonlySet<Permission>> {
    const rows = await this.db
      .selectDistinct({ key: schema.permissions.key })
      .from(schema.userRoles)
      .innerJoin(schema.roles, and(eq(schema.roles.id, schema.userRoles.roleId), eq(schema.roles.organizationId, organizationId)))
      .innerJoin(schema.rolePermissions, eq(schema.rolePermissions.roleId, schema.roles.id))
      .innerJoin(schema.permissions, eq(schema.permissions.id, schema.rolePermissions.permissionId))
      .where(and(eq(schema.userRoles.userId, userId), eq(schema.userRoles.organizationId, organizationId)));
    return new Set(rows.map((r) => r.key).filter(isPermission));
  }
}
