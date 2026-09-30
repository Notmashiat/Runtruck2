import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller.js';
import { BillingRepository } from './billing.repository.js';
import { BillingService } from './billing.service.js';
import { UninvoicedLoadsQuery } from './uninvoiced-loads.query.js';

// Receivables: uninvoiced loads and invoice batches (docs/api/billing.md). Exports the
// shared uninvoiced-loads query so the Dashboard's "Unbilled loads" uses the same rule.
@Module({
  controllers: [BillingController],
  providers: [BillingService, BillingRepository, UninvoicedLoadsQuery],
  exports: [UninvoicedLoadsQuery],
})
export class BillingModule {}
