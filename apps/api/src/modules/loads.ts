import type { Type } from '@nestjs/common';
import { DispatchModule } from '../dispatch/dispatch.module.js';
import { DocumentsModule } from '../documents/documents.module.js';
import { LoadsModule } from '../loads/loads.module.js';
import { StorageModule } from '../storage/storage.module.js';

// NestJS modules owned by the loads domain group (architecture §6). Add each module
// class here; app.module.ts picks them up through domain-modules.ts.
export const MODULES: Type[] = [LoadsModule, DocumentsModule, DispatchModule, StorageModule];
