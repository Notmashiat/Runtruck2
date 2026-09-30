import { Module } from '@nestjs/common';
import { ClaimsController } from './claims.controller.js';
import { ClaimsRepository } from './claims.repository.js';
import { ClaimsService } from './claims.service.js';

// Cargo and liability claims (docs/api/safety.md §6), read-only in this release.
@Module({
  controllers: [ClaimsController],
  providers: [ClaimsService, ClaimsRepository],
})
export class ClaimsModule {}
