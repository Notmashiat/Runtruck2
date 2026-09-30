import { createHash, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { LOAD_DOCUMENT_TYPE_LABEL, formatLoadNumber } from '@runtruck/calculations';
import type { Transaction } from '@runtruck/database';
import { hasPermissions } from '@runtruck/permissions';
import type { LoadDocument, LoadDocumentType } from '@runtruck/types';
import { loadDocumentFileMetaSchema } from '@runtruck/validation';
import { AuditService } from '../audit/audit.service.js';
import type { AuthContext } from '../auth/auth-context.js';
import { ClockService } from '../common/clock/clock.service.js';
import { AppError } from '../common/errors/app-error.js';
import { EventsService } from '../events/events.service.js';
import { assertLoadTransition } from '../loads/load-status.js';
import { StorageService } from '../storage/storage.service.js';
import { DocumentsRepository } from './documents.repository.js';
import { detectDocumentMimeType } from './file-type.js';
import { sanitizeFileName } from './file-name.js';
import { documentStorageKey } from './storage-key.js';

// The received multipart file (multer memory storage).
export interface ReceivedFile {
  originalname: string;
  size: number;
  buffer: Buffer;
}

const loadNotFound = () => AppError.notFound('LOAD_NOT_FOUND', 'Load was not found.');

const documentError = (code: string, message: string) => new AppError('VALIDATION_ERROR', code, message);

// Load paperwork (docs/api/documents.md, docs/13-document-system.md).
@Injectable()
export class DocumentsService {
  constructor(
    private readonly repo: DocumentsRepository,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
    private readonly clock: ClockService,
  ) {}

  async list(ctx: AuthContext, loadId: string): Promise<LoadDocument[]> {
    const load = await this.repo.findLoad(ctx.organizationId, loadId);
    if (!load) throw loadNotFound();
    return this.repo.list(ctx.organizationId, loadId);
  }

  // 13 §4.4: check the file and the load, write the object outside any transaction, then
  // record the version (and T12) in one transaction with its audit rows and events.
  async upload(ctx: AuthContext, loadId: string, documentType: LoadDocumentType, file: ReceivedFile | undefined): Promise<LoadDocument> {
    // 1. The file: present, not empty, an allowed type by its bytes, a clean name.
    if (!file) throw documentError('DOCUMENT_FILE_MISSING', 'Attach a file.');
    if (file.size === 0 || file.buffer.length === 0) throw documentError('DOCUMENT_FILE_EMPTY', 'The file is empty.');
    const mimeType = detectDocumentMimeType(file.buffer);
    if (!mimeType) throw documentError('DOCUMENT_FILE_TYPE_NOT_ALLOWED', 'Attach a PDF or an image.');
    const meta = loadDocumentFileMetaSchema.safeParse({ fileName: sanitizeFileName(file.originalname), mimeType, sizeBytes: file.buffer.length });
    if (!meta.success) throw AppError.validation(meta.error.issues.map((i) => ({ path: `file.${i.path.join('.')}`, message: i.message })));
    const checksumSha256 = createHash('sha256').update(file.buffer).digest('hex');

    // 2. The load, in the caller's organization (no lock yet).
    const load = await this.repo.findLoad(ctx.organizationId, loadId);
    if (!load) throw loadNotFound();

    // 3–4. The version id and key are known up front, so the object is written before
    // any row is locked; a storage failure records nothing (502).
    const versionId = randomUUID();
    const storageKey = documentStorageKey(ctx.organizationId, load.id, versionId);
    await this.storage.put(storageKey, file.buffer, mimeType, checksumSha256);

    // 5. One transaction for the rows, the audit trail and the outbox.
    const now = this.clock.now(ctx.timezone);
    const documentId = await this.repo.database.transaction(async (tx) => {
      const slot = await this.repo.lockSlot(tx, ctx.organizationId, load.id, documentType);
      const versionNumber = await this.repo.nextVersionNumber(tx, ctx.organizationId, slot.id);
      await this.repo.addVersion(tx, ctx.organizationId, slot.id, versionNumber, {
        id: versionId,
        fileName: meta.data.fileName,
        storageKey,
        mimeType,
        sizeBytes: meta.data.sizeBytes,
        checksumSha256,
        uploadedByUserId: ctx.userId,
        uploadedAt: now,
      });
      await this.repo.markAttached(tx, ctx.organizationId, slot.id, now);

      const loadLabel = formatLoadNumber(load.loadNumber);
      await this.audit.record(tx, ctx, {
        action: 'DOCUMENT_UPLOADED',
        entityType: 'document',
        entityId: slot.id,
        entityLabel: `${loadLabel} · ${LOAD_DOCUMENT_TYPE_LABEL[documentType]}`,
        previous: { status: slot.status },
        next: { loadId: load.id, documentType, versionNumber, fileName: meta.data.fileName, mimeType, sizeBytes: meta.data.sizeBytes, checksumSha256 },
      });
      await this.events.emit(tx, ctx, {
        type: 'DocumentUploaded',
        aggregateType: 'document',
        aggregateId: slot.id,
        payload: { loadId: load.id, documentId: slot.id, documentVersionId: versionId, documentType, versionNumber },
      });

      if (documentType === 'proof_of_delivery') {
        await this.events.emit(tx, ctx, {
          type: 'PODUploaded',
          aggregateType: 'document',
          aggregateId: slot.id,
          payload: { loadId: load.id, documentId: slot.id, documentVersionId: versionId },
        });
        await this.completeDeliveryOnPod(tx, ctx, load.id);
      }
      return slot.id;
    });

    const [document] = await this.repo.list(ctx.organizationId, load.id, documentId);
    if (!document) throw new Error('uploaded document slot not found');
    return document;
  }

  // 08 T12: a POD moves a needs_pod load to delivered, only when the uploader also holds
  // loads.update (07 §8 item 6). The load row is locked and re-read inside the transaction.
  private async completeDeliveryOnPod(tx: Transaction, ctx: AuthContext, loadId: string): Promise<void> {
    if (!hasPermissions(ctx.permissions, ['loads.update'])) return;
    const load = await this.repo.findLoad(ctx.organizationId, loadId, tx, true);
    if (load?.status !== 'needs_pod') return;
    assertLoadTransition(load.status, 'delivered');
    await this.repo.setLoadStatus(tx, ctx.organizationId, load.id, 'delivered');
    await this.audit.record(tx, ctx, {
      action: 'LOAD_STATUS_CHANGED',
      entityType: 'load',
      entityId: load.id,
      entityLabel: formatLoadNumber(load.loadNumber),
      previous: { status: 'needs_pod' },
      next: { status: 'delivered' },
    });
    await this.events.emit(tx, ctx, {
      type: 'LoadStatusChanged',
      aggregateType: 'load',
      aggregateId: load.id,
      payload: { loadId: load.id, loadNumber: load.loadNumber, from: 'needs_pod', to: 'delivered' },
    });
  }
}
