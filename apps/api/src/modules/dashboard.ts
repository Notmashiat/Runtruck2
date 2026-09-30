import type { Type } from '@nestjs/common';
import { DashboardModule } from '../dashboard/dashboard.module.js';

// NestJS modules owned by the dashboard domain group (architecture §6). Add each module
// class here; app.module.ts picks them up through domain-modules.ts.
export const MODULES: Type[] = [DashboardModule];
