import { Module } from '@nestjs/common';
import { DispatchModule } from '../dispatch/dispatch.module.js';
import { DocumentsModule } from '../documents/documents.module.js';
import { LoadsController } from './loads.controller.js';
import { LoadsRepository } from './loads.repository.js';
import { LoadsService } from './loads.service.js';

// Loads, stops and activity (architecture §17; docs/api/loads.md). Other modules reuse the
// route-label helper of ./load-endpoints.ts (a plain function, no provider needed).
@Module({
  imports: [DispatchModule, DocumentsModule],
  controllers: [LoadsController],
  providers: [LoadsService, LoadsRepository],
})
export class LoadsModule {}
