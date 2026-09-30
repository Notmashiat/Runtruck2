import { schema } from '@runtruck/database';
import { describe, expect, it } from 'vitest';
import { AuditService } from '../audit/audit.service.js';
import type { AuthContext } from '../auth/auth-context.js';
import { EventsService } from '../events/events.service.js';
import type { ApprovedSettlement } from './settlements.events.js';
import { SettlementsService } from './settlements.service.js';
import { EMPTY_PERIOD_AGGREGATE } from './settlements.summary.js';

// POST /settlements/approve writes one audit row and one outbox event per approved
// settlement as two multi-row INSERTs, not 2 × N statements while the approved rows stay
// locked (architecture §38; docs/api/settlements.md §3.1 step 5).

function approveWith(approved: ApprovedSettlement[]) {
  const inserts: { table: unknown; rows: unknown[] }[] = [];
  const tx = {
    insert: (table: unknown) => ({
      values: (rows: unknown[]) => {
        inserts.push({ table, rows: Array.isArray(rows) ? rows : [rows] });
        return Promise.resolve();
      },
    }),
  };
  const db = { transaction: <T>(fn: (t: typeof tx) => Promise<T>) => fn(tx) };
  const repository = {
    periodExists: () => Promise.resolve(true),
    approveReady: () => Promise.resolve(approved),
    rows: () => Promise.resolve([]),
    aggregate: () => Promise.resolve(EMPTY_PERIOD_AGGREGATE),
  };
  const clock = { now: () => new Date('2026-09-03T15:00:00.000Z'), today: () => '2026-09-03' };
  const service = new SettlementsService(db as never, clock as never, new AuditService(), new EventsService(), repository as never);
  const ctx = { organizationId: 'org-1', userId: 'user-1', timezone: 'America/Los_Angeles' } as AuthContext;
  return { inserts, result: service.approve(ctx, { periodStart: '2026-09-01' }) };
}

const roster = (n: number): ApprovedSettlement[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `settlement-${i}`,
    driverId: `driver-${i}`,
    driverName: `Driver ${i}`,
    periodStart: '2026-09-01',
  }));

describe('SettlementsService.approve writes', () => {
  it('two statements whatever the roster size: one audit INSERT and one event INSERT', async () => {
    const { inserts, result } = approveWith(roster(40));
    expect((await result).meta.approvedNow).toBe(40);
    expect(inserts.map((i) => i.table)).toEqual([schema.auditLogs, schema.events]);
    expect(inserts.map((i) => i.rows.length)).toEqual([40, 40]);
    expect(inserts[0]?.rows[0]).toMatchObject({
      organizationId: 'org-1',
      actorUserId: 'user-1',
      action: 'SETTLEMENT_APPROVED',
      entityId: 'settlement-0',
    });
    expect(inserts[1]?.rows[39]).toMatchObject({ organizationId: 'org-1', type: 'SettlementApproved', aggregateId: 'settlement-39' });
  });

  it('nothing when no settlement was ready', async () => {
    const { inserts, result } = approveWith([]);
    expect((await result).meta.approvedNow).toBe(0);
    expect(inserts).toEqual([]);
  });
});
