import type { Type } from '@nestjs/common';
import { MODULES as ACCOUNTING } from './modules/accounting.js';
import { MODULES as DASHBOARD } from './modules/dashboard.js';
import { MODULES as FLEET_CRM } from './modules/fleet-crm.js';
import { MODULES as HR_SAFETY } from './modules/hr-safety.js';
import { MODULES as LOADS } from './modules/loads.js';
import { MODULES as PLANNER } from './modules/planner.js';

// Business-domain modules (architecture §6), registered per domain group in
// src/modules/<group>.ts so groups never edit the same file.
export const DOMAIN_MODULES: Type[] = [...DASHBOARD, ...LOADS, ...PLANNER, ...ACCOUNTING, ...FLEET_CRM, ...HR_SAFETY];
