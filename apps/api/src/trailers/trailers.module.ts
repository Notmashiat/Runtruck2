import { Module } from '@nestjs/common';
import { TrailersController } from './trailers.controller.js';
import { TrailersRepository } from './trailers.repository.js';
import { TrailersService } from './trailers.service.js';

@Module({
  controllers: [TrailersController],
  providers: [TrailersService, TrailersRepository],
})
export class TrailersModule {}
