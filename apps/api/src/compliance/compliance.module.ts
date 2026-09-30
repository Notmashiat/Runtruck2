import { Module } from '@nestjs/common';
import { ComplianceRemindersController } from './compliance-reminders.controller.js';
import { ComplianceRepository } from './compliance.repository.js';
import { ComplianceService } from './compliance.service.js';
import { DriverDocumentsController } from './driver-documents.controller.js';
import { ViolationsController } from './violations.controller.js';

// Compliance: driver qualification files, the compliance watchlist and roadside violations
// (docs/api/safety.md §3–§5), read-only in this release.
@Module({
  controllers: [DriverDocumentsController, ComplianceRemindersController, ViolationsController],
  providers: [ComplianceService, ComplianceRepository],
})
export class ComplianceModule {}
