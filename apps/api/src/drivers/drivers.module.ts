import { Module } from '@nestjs/common';
import { DriversController } from './drivers.controller.js';
import { DriversRepository } from './drivers.repository.js';
import { DriversService } from './drivers.service.js';

@Module({
  controllers: [DriversController],
  providers: [DriversService, DriversRepository],
})
export class DriversModule {}
