import { Module } from '@nestjs/common';
import { FacilitiesController } from './facilities.controller.js';
import { FacilitiesRepository } from './facilities.repository.js';
import { FacilitiesService } from './facilities.service.js';

// Locations domain (architecture §6 `locations/`): the facility register.
@Module({
  controllers: [FacilitiesController],
  providers: [FacilitiesService, FacilitiesRepository],
})
export class LocationsModule {}
