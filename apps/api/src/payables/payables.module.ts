import { Module } from '@nestjs/common';
import { PayablesController } from './payables.controller.js';
import { PayablesRepository } from './payables.repository.js';
import { PayablesService } from './payables.service.js';

// Accounts payable: vendors and bills (docs/api/payables.md).
@Module({
  controllers: [PayablesController],
  providers: [PayablesService, PayablesRepository],
})
export class PayablesModule {}
