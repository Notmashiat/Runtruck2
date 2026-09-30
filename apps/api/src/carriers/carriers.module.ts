import { Module } from '@nestjs/common';
import { CarriersController } from './carriers.controller.js';
import { CarriersRepository } from './carriers.repository.js';
import { CarriersService } from './carriers.service.js';

@Module({
  controllers: [CarriersController],
  providers: [CarriersService, CarriersRepository],
})
export class CarriersModule {}
