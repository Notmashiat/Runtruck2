import { Inject, Injectable } from '@nestjs/common';
import { type Database, schema } from '@runtruck/database';
import type { MeResponse } from '@runtruck/types';
import { and, eq } from 'drizzle-orm';
import { ClockService } from '../common/clock/clock.service.js';
import { AppError } from '../common/errors/app-error.js';
import { DB } from '../database/database.module.js';
import type { AuthContext } from './auth-context.js';

@Injectable()
export class MeService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly clock: ClockService,
  ) {}

  async describe(ctx: AuthContext): Promise<MeResponse> {
    const [row] = await this.db
      .select({
        userId: schema.users.id,
        fullName: schema.users.fullName,
        email: schema.users.email,
        memberNumber: schema.organizationMembers.memberNumber,
        title: schema.organizationMembers.title,
        orgId: schema.organizations.id,
        orgName: schema.organizations.name,
        shortName: schema.organizations.shortName,
        companyNumber: schema.organizations.companyNumber,
        timezone: schema.organizations.timezone,
      })
      .from(schema.organizationMembers)
      .innerJoin(schema.users, eq(schema.users.id, schema.organizationMembers.userId))
      .innerJoin(schema.organizations, eq(schema.organizations.id, schema.organizationMembers.organizationId))
      .where(and(eq(schema.organizationMembers.userId, ctx.userId), eq(schema.organizationMembers.organizationId, ctx.organizationId)))
      .limit(1);
    if (!row) throw AppError.unauthorized();

    return {
      user: { id: row.userId, fullName: row.fullName, email: row.email, memberNumber: row.memberNumber, title: row.title },
      organization: { id: row.orgId, name: row.orgName, shortName: row.shortName, companyNumber: row.companyNumber, timezone: row.timezone },
      permissions: [...ctx.permissions].sort(),
      today: this.clock.today(row.timezone),
    };
  }
}
