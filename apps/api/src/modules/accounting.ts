import type { Type } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module.js';
import { InvoicesModule } from '../invoices/invoices.module.js';
import { PayablesModule } from '../payables/payables.module.js';
import { SettlementsModule } from '../settlements/settlements.module.js';

// NestJS modules owned by the accounting domain group (architecture §6). Add each module
// class here; app.module.ts picks them up through domain-modules.ts.
export const MODULES: Type[] = [BillingModule, InvoicesModule, PayablesModule, SettlementsModule];
