import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller.js';
import { DashboardRepository } from './dashboard.repository.js';
import { DashboardService } from './dashboard.service.js';

// Operations dashboard (docs/api/dashboard.md). It reuses two plain shared helpers, not
// providers: the loads module's route labels (../loads/load-endpoints.ts) and the billing
// module's uninvoiced predicate (../billing/uninvoiced-loads.query.ts).
@Module({
  controllers: [DashboardController],
  providers: [DashboardService, DashboardRepository],
})
export class DashboardModule {}
