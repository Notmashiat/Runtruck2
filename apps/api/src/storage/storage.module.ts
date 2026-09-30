import { Module } from '@nestjs/common';
import { StorageService } from './storage.service.js';

// Object storage (docs/13-document-system.md §2). Imported by the documents module only.
@Module({ providers: [StorageService], exports: [StorageService] })
export class StorageModule {}
