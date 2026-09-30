import { Module } from '@nestjs/common';
import { DispatchRepository } from './dispatch.repository.js';
import { DispatchService } from './dispatch.service.js';

// Dispatch assignment rules (architecture §19, docs/09-dispatch-lifecycle.md). No endpoint
// of its own in this release: New Load (loads module) is the only assignment path.
@Module({ providers: [DispatchService, DispatchRepository], exports: [DispatchService] })
export class DispatchModule {}
