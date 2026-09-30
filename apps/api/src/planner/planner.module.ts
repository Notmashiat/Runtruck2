import { Module } from '@nestjs/common';
import { PlannerController } from './planner.controller.js';
import { PlannerRepository } from './planner.repository.js';
import { PlannerService } from './planner.service.js';

// The shared organization calendar (docs/01 D8; docs/api/planner.md): office events, color
// codes, derived load-stop events, related loads and Reset calendar. Route labels come from
// the loads module's plain helper (../loads/load-endpoints.ts), so no provider is imported.
@Module({
  controllers: [PlannerController],
  providers: [PlannerService, PlannerRepository],
})
export class PlannerModule {}
