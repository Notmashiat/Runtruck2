import { Module } from '@nestjs/common';
import { SettlementsController } from './settlements.controller.js';
import { SettlementsRepository } from './settlements.repository.js';
import { SettlementsService } from './settlements.service.js';

// Driver settlements (payroll): read the pay period, approve its ready settlements
// (docs/api/settlements.md). AuditService, EventsService and ClockService are global.
@Module({
  controllers: [SettlementsController],
  providers: [SettlementsService, SettlementsRepository],
})
export class SettlementsModule {}
