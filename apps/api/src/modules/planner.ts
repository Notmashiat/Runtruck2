import type { Type } from '@nestjs/common';
import { PlannerModule } from '../planner/planner.module.js';

// NestJS modules owned by the planner domain group (architecture §6). Add each module
// class here; app.module.ts picks them up through domain-modules.ts.
export const MODULES: Type[] = [PlannerModule];
