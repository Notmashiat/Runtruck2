import type { Type } from '@nestjs/common';
import { ClaimsModule } from '../claims/claims.module.js';
import { ComplianceModule } from '../compliance/compliance.module.js';
import { HrModule } from '../hr/hr.module.js';
import { MaintenanceModule } from '../maintenance/maintenance.module.js';

// NestJS modules owned by the hr-safety domain group (architecture §6). Add each module
// class here; app.module.ts picks them up through domain-modules.ts.
export const MODULES: Type[] = [HrModule, MaintenanceModule, ComplianceModule, ClaimsModule];
