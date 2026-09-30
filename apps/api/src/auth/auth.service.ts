import { Inject, Injectable } from '@nestjs/common';
import { type Database, DUMMY_PASSWORD_HASH, schema, verifyPassword } from '@runtruck/database';
import type { LoginInput } from '@runtruck/validation';
import { and, asc, eq, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/errors/app-error.js';
import { RateLimiterService } from '../common/rate-limit/rate-limiter.service.js';
import { DB } from '../database/database.module.js';
import type { AuthContext } from './auth-context.js';
import { type NewSession, SessionService } from './session.service.js';

const WINDOW_SECONDS = 15 * 60;
const MAX_ATTEMPTS_PER_EMAIL = 10;
const MAX_ATTEMPTS_PER_IP = 100;

const INVALID_CREDENTIALS = () => new AppError('UNAUTHORIZED', 'INVALID_CREDENTIALS', 'Email or password is incorrect.');

export interface LoginResult {
  session: NewSession;
  userId: string;
  organizationId: string;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly sessions: SessionService,
    private readonly limiter: RateLimiterService,
    private readonly audit: AuditService,
  ) {}

  // Every attempt is counted before the password is checked, so parallel guesses cannot
  // overshoot a limit. A successful sign-in then takes its hit back from the per-IP counter
  // and clears the per-email one: only failures use up an address's budget, so the
  // sign-ins of everyone behind one address (an office NAT, or every browser when no edge
  // proxy sets X-Forwarded-For) cannot lock that address out (docs/05-authentication.md §2).
  async login(input: LoginInput, meta: { ipAddress?: string; userAgent?: string }): Promise<LoginResult> {
    const emailKey = `rl:login:email:${input.email}`;
    const ipKey = `rl:login:ip:${meta.ipAddress ?? 'unknown'}`;
    const [emailLimited, ipLimited] = await Promise.all([
      this.limiter.hit(emailKey, MAX_ATTEMPTS_PER_EMAIL, WINDOW_SECONDS),
      this.limiter.hit(ipKey, MAX_ATTEMPTS_PER_IP, WINDOW_SECONDS),
    ]);
    if (emailLimited || ipLimited) throw AppError.rateLimited('Too many sign-in attempts. Try again in 15 minutes.');

    const [user] = await this.db
      .select({ id: schema.users.id, passwordHash: schema.users.passwordHash, status: schema.users.status })
      .from(schema.users)
      .where(eq(sql`lower(${schema.users.email})`, input.email))
      .limit(1);

    // Always run one hash verification so timing does not reveal unknown emails.
    const passwordOk = await verifyPassword(input.password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
    if (!user || !passwordOk || user.status !== 'active') throw INVALID_CREDENTIALS();

    const [membership] = await this.db
      .select({ organizationId: schema.organizationMembers.organizationId })
      .from(schema.organizationMembers)
      .where(and(eq(schema.organizationMembers.userId, user.id), eq(schema.organizationMembers.status, 'active')))
      .orderBy(asc(schema.organizationMembers.createdAt))
      .limit(1);
    if (!membership) throw new AppError('FORBIDDEN', 'NO_ACTIVE_MEMBERSHIP', 'Your account is not a member of an active organization.');

    // Session, last-login stamp and audit row commit together or not at all.
    const session = await this.db.transaction(async (tx) => {
      const created = await this.sessions.create(user.id, membership.organizationId, meta, tx);
      await tx.update(schema.users).set({ lastLoginAt: new Date() }).where(eq(schema.users.id, user.id));
      await this.audit.record(
        tx,
        { organizationId: membership.organizationId, userId: user.id },
        { action: 'USER_SIGNED_IN', entityType: 'user', entityId: user.id, next: { ipAddress: meta.ipAddress ?? null } },
      );
      return created;
    });
    await Promise.all([this.limiter.reset(emailKey), this.limiter.release(ipKey)]);

    return { session, userId: user.id, organizationId: membership.organizationId };
  }

  async logout(ctx: AuthContext): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.sessions.revoke(ctx.sessionId, tx);
      await this.audit.record(tx, ctx, { action: 'USER_SIGNED_OUT', entityType: 'user', entityId: ctx.userId });
    });
  }
}
