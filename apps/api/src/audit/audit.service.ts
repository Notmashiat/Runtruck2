import { Injectable } from '@nestjs/common';
import { type DbExecutor, schema } from '@runtruck/database';
import type { AuthContext } from '../auth/auth-context.js';
import { currentRequestId } from '../common/request-context/request-context.js';

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId: string;
  entityLabel?: string;
  previous?: unknown;
  next?: unknown;
  occurredAt?: Date;
}

// Writes append-only audit rows (architecture §30). Always call it with the
// same transaction as the change it records, so the two commit together.
@Injectable()
export class AuditService {
  async record(tx: DbExecutor, ctx: Pick<AuthContext, 'organizationId' | 'userId'>, entry: AuditEntry): Promise<void> {
    await tx.insert(schema.auditLogs).values({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      entityLabel: entry.entityLabel ?? null,
      previous: entry.previous ?? null,
      next: entry.next ?? null,
      requestId: currentRequestId() ?? null,
      ...(entry.occurredAt ? { occurredAt: entry.occurredAt } : {}),
    });
  }
}
