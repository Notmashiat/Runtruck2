import { Module } from '@nestjs/common';
import { ContractsController } from './contracts.controller.js';
import { HrRepository } from './hr.repository.js';
import { HrService } from './hr.service.js';
import { OnboardingController } from './onboarding.controller.js';

// HR: employee contracts and onboarding (docs/api/hr.md), read-only in this release.
@Module({
  controllers: [ContractsController, OnboardingController],
  providers: [HrService, HrRepository],
})
export class HrModule {}
