import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module.js';
import { DocumentsController } from './documents.controller.js';
import { DocumentsRepository } from './documents.repository.js';
import { DocumentsService } from './documents.service.js';

// Load paperwork (architecture §21; docs/api/documents.md). The repository is exported so
// the load detail can embed the same LoadDocument list.
@Module({
  imports: [StorageModule],
  controllers: [DocumentsController],
  providers: [DocumentsService, DocumentsRepository],
  exports: [DocumentsRepository],
})
export class DocumentsModule {}
