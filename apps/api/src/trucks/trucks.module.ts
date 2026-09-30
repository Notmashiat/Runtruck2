import { Module } from '@nestjs/common';
import { TrucksController } from './trucks.controller.js';
import { TrucksRepository } from './trucks.repository.js';
import { TrucksService } from './trucks.service.js';

@Module({
  controllers: [TrucksController],
  providers: [TrucksService, TrucksRepository],
})
export class TrucksModule {}
