import { Inject, Injectable } from '@nestjs/common';
import { EM_DASH } from '@runtruck/calculations';
import type { Database } from '@runtruck/database';
import type { DashboardData, DashboardMeta } from '@runtruck/types';
import type { AuthContext } from '../auth/auth-context.js';
import { ClockService } from '../common/clock/clock.service.js';
import { DB } from '../database/database.module.js';
import { activeLoadsSummary, dashboardPeriods, deadheadSummary, revenueFigures, toSafeNumber } from './dashboard.figures.js';
import { DashboardRepository } from './dashboard.repository.js';

// Runtruck1 `.slice(0, 6)` of the "Active loads" card (dashboard.md §2.4).
export const DASHBOARD_ACTIVE_LOADS_LIMIT = 6;

// GET /dashboard (docs/api/dashboard.md §2): every figure computed from stored rows (D5)
// for the organization's business date (D4). The reads run in one read-only REPEATABLE
// READ transaction, so the KPI count, the table and the chart come from one snapshot, and
// the result is never cached (Redis is not authoritative; a created load shows at once).
@Injectable()
export class DashboardService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly clock: ClockService,
    private readonly repository: DashboardRepository,
  ) {}

  async get(ctx: AuthContext): Promise<{ data: DashboardData; meta: DashboardMeta }> {
    const periods = dashboardPeriods(this.clock.today(ctx.timezone));
    const org = ctx.organizationId;

    return this.db.transaction(
      async (tx) => {
        // Sequential on purpose: one transaction is one connection.
        const active = await this.repository.activeLoads(tx, org, DASHBOARD_ACTIVE_LOADS_LIMIT);
        const lastWeekCount = await this.repository.activeOnCount(tx, org, periods.lastWeekDay);
        const revenueDays = await this.repository.revenueByDeliveryDay(tx, org, periods.previousWeekStart, periods.weekEnd);
        const deadhead = await this.repository.deadheadMiles(tx, org, periods);
        const unbilled = await this.repository.unbilledLoads(tx, org);
        const drivers = await this.repository.drivers(tx, org);

        const revenue = revenueFigures(revenueDays, periods);
        return {
          data: {
            activeLoads: active.rows.map((r) => ({
              id: r.id,
              loadNumber: r.loadNumber,
              customerName: r.customerName,
              // Every active load has stops (POST /loads requires them); "—" guards the type.
              route: r.route ?? EM_DASH,
              lineHaulCents: r.lineHaulCents,
              status: r.status,
            })),
            revenueLastSevenDays: revenue.chart,
            drivers: drivers.map((d) => ({
              id: d.id,
              name: `${d.firstName} ${d.lastName}`,
              dutyStatus: d.dutyStatus,
              hosRemainingMinutes: d.hosRemainingMinutes,
            })),
          },
          meta: {
            today: periods.today,
            weekStart: periods.weekStart,
            weekEnd: periods.weekEnd,
            summary: {
              activeLoads: activeLoadsSummary(active.count, lastWeekCount),
              revenueThisWeek: revenue.summary,
              deadheadMiles: deadheadSummary(deadhead.thisWeek, deadhead.previousWeek),
              unbilledLoads: { count: unbilled.count, amountCents: toSafeNumber(unbilled.amountCents) },
            },
          },
        };
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
  }
}
