import { Module } from '@nestjs/common';
import { MaintenanceRepository } from './maintenance.repository.js';
import { MaintenanceService } from './maintenance.service.js';
import { WorkOrdersController } from './work-orders.controller.js';

// Maintenance work orders (docs/api/safety.md §2), read-only in this release.
@Module({
  controllers: [WorkOrdersController],
  providers: [MaintenanceService, MaintenanceRepository],
})
export class MaintenanceModule {}
