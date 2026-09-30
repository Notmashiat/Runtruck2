import { Inject, Injectable } from '@nestjs/common';
import { type Database, type DbExecutor, schema } from '@runtruck/database';
import type { LoadDocument, LoadDocumentMimeType, LoadDocumentStatus, LoadDocumentType, LoadStatus } from '@runtruck/types';
import { and, eq, sql } from 'drizzle-orm';
import { DB } from '../database/database.module.js';

const { documents, documentVersions, loads } = schema;

interface DocumentSqlRow extends Record<string, unknown> {
  id: string;
  load_id: string;
  document_type: LoadDocumentType;
  status: LoadDocumentStatus;
  position: number;
  attached_at: string | Date | null;
  version_id: string | null;
  version_number: number | null;
  file_name: string | null;
  mime_type: string | null;
  size_bytes: string | number | null;
  checksum_sha256: string | null;
  uploaded_at: string | Date | null;
  uploaded_by_user_id: string | null;
  uploader_name: string | null;
  version_count: string | number | null;
}

const iso = (value: string | Date): string => new Date(value).toISOString();

function toLoadDocument(r: DocumentSqlRow): LoadDocument {
  return {
    id: r.id,
    loadId: r.load_id,
    documentType: r.document_type,
    status: r.status,
    position: r.position,
    attachedAt: r.attached_at === null ? null : iso(r.attached_at),
    versionCount: r.version_count === null ? 0 : Number(r.version_count),
    currentVersion:
      r.version_id === null || r.version_number === null || r.file_name === null || r.mime_type === null || r.uploaded_at === null
        ? null
        : {
            id: r.version_id,
            versionNumber: r.version_number,
            fileName: r.file_name,
            mimeType: r.mime_type as LoadDocumentMimeType,
            sizeBytes: Number(r.size_bytes),
            checksumSha256: r.checksum_sha256,
            uploadedAt: iso(r.uploaded_at),
            uploadedBy: r.uploaded_by_user_id !== null && r.uploader_name !== null ? { id: r.uploaded_by_user_id, fullName: r.uploader_name } : null,
          },
  };
}

// A load's document slots with their current version, version count and uploader, in one
// statement (docs/api/documents.md §2): the lateral picks the highest version, and its
// window count (evaluated before LIMIT) counts every version of the slot. Tenant-filtered
// on every table; the lateral is keyed by the slot's own organization.
export async function queryLoadDocuments(db: DbExecutor, organizationId: string, loadId: string, documentId?: string): Promise<LoadDocument[]> {
  const result = await db.execute<DocumentSqlRow>(sql`
    select d.id, d.load_id, d.document_type, d.status, d.position, d.attached_at,
           cur.id as version_id, cur.version_number, cur.file_name, cur.mime_type, cur.size_bytes,
           cur.checksum_sha256, cur.uploaded_at, cur.uploaded_by_user_id, cur.version_count,
           u.full_name as uploader_name
      from documents d
      left join lateral (
        select v.id, v.version_number, v.file_name, v.mime_type, v.size_bytes, v.checksum_sha256,
               v.uploaded_at, v.uploaded_by_user_id, count(*) over () as version_count
          from document_versions v
         where v.organization_id = d.organization_id and v.document_id = d.id
         order by v.version_number desc
         limit 1
      ) cur on true
      left join users u on u.id = cur.uploaded_by_user_id
     where d.organization_id = ${organizationId} and d.load_id = ${loadId}
       ${documentId === undefined ? sql`` : sql`and d.id = ${documentId}`}
     order by d.position, d.id`);
  return result.rows.map(toLoadDocument);
}

export interface DocumentLoadRef {
  id: string;
  loadNumber: number;
  status: LoadStatus;
}

export interface NewDocumentVersion {
  id: string;
  fileName: string;
  storageKey: string;
  mimeType: LoadDocumentMimeType;
  sizeBytes: number;
  checksumSha256: string;
  uploadedByUserId: string;
  uploadedAt: Date;
}

// Reads and writes of the documents module. Every statement filters on the session's
// organization; child rows carry it too (composite tenant FKs, 03 §1.3).
@Injectable()
export class DocumentsRepository {
  constructor(@Inject(DB) private readonly db: Database) {}

  get database(): Database {
    return this.db;
  }

  list(organizationId: string, loadId: string, documentId?: string, db: DbExecutor = this.db): Promise<LoadDocument[]> {
    return queryLoadDocuments(db, organizationId, loadId, documentId);
  }

  // Board and archived loads both resolve; another organization's id finds nothing.
  async findLoad(organizationId: string, loadId: string, db: DbExecutor = this.db, lock = false): Promise<DocumentLoadRef | null> {
    const query = db
      .select({ id: loads.id, loadNumber: loads.loadNumber, status: loads.status })
      .from(loads)
      .where(and(eq(loads.organizationId, organizationId), eq(loads.id, loadId)));
    const [row] = lock ? await query.for('update') : await query;
    return row ?? null;
  }

  // The slot of this type, created at max(position) + 1 when the load has none (13 §1.1),
  // then locked so concurrent uploads to one slot get consecutive version numbers.
  async lockSlot(tx: DbExecutor, organizationId: string, loadId: string, documentType: LoadDocumentType): Promise<{ id: string; status: LoadDocumentStatus; attachedAt: Date | null }> {
    await tx
      .insert(documents)
      .values({
        organizationId,
        loadId,
        documentType,
        status: 'pending',
        position: sql`(select coalesce(max(${documents.position}), 0) + 1 from ${documents} where ${documents.organizationId} = ${organizationId} and ${documents.loadId} = ${loadId})`,
      })
      .onConflictDoNothing({ target: [documents.organizationId, documents.loadId, documents.documentType] });
    const [slot] = await tx
      .select({ id: documents.id, status: documents.status, attachedAt: documents.attachedAt })
      .from(documents)
      .where(and(eq(documents.organizationId, organizationId), eq(documents.loadId, loadId), eq(documents.documentType, documentType)))
      .for('update');
    if (!slot) throw new Error('document slot missing after upsert');
    return slot;
  }

  async nextVersionNumber(tx: DbExecutor, organizationId: string, documentId: string): Promise<number> {
    const [row] = await tx
      .select({ max: sql<number>`coalesce(max(${documentVersions.versionNumber}), 0)`.mapWith(Number) })
      .from(documentVersions)
      .where(and(eq(documentVersions.organizationId, organizationId), eq(documentVersions.documentId, documentId)));
    return (row?.max ?? 0) + 1;
  }

  async addVersion(tx: DbExecutor, organizationId: string, documentId: string, versionNumber: number, v: NewDocumentVersion): Promise<void> {
    await tx.insert(documentVersions).values({ ...v, organizationId, documentId, versionNumber });
  }

  async markAttached(tx: DbExecutor, organizationId: string, documentId: string, at: Date): Promise<void> {
    await tx
      .update(documents)
      .set({ status: 'attached', attachedAt: sql`coalesce(${documents.attachedAt}, ${at.toISOString()}::timestamptz)` })
      .where(and(eq(documents.organizationId, organizationId), eq(documents.id, documentId)));
  }

  async setLoadStatus(tx: DbExecutor, organizationId: string, loadId: string, status: LoadStatus): Promise<void> {
    await tx
      .update(loads)
      .set({ status })
      .where(and(eq(loads.organizationId, organizationId), eq(loads.id, loadId)));
  }
}
