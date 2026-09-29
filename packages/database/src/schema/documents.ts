import { sql } from 'drizzle-orm';
import { bigint, check, index, integer, pgEnum, pgTable, smallint, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, timestamps } from './_columns.js';
import { tenantFk, tenantKey } from './_tenant.js';
import { loads } from './loads.js';
import { organizationId, users } from './platform.js';

// Load paperwork (architecture §21): one row per checklist slot, one version per
// uploaded file. Binaries live in object storage (bucket runtruck-documents).
// Specified in docs/03-database.md §5.7.

export const documentType = pgEnum('document_type', [
  'rate_confirmation',
  'customer_load_tender',
  'bill_of_lading',
  'proof_of_delivery',
  'lumper_receipt',
]);

// Runtruck1: Pending / Attached.
export const documentStatus = pgEnum('document_status', ['pending', 'attached']);

export const documents = pgTable(
  'documents',
  {
    id: id(),
    organizationId: organizationId(),
    loadId: uuid().notNull(),
    documentType: documentType().notNull(),
    status: documentStatus().notNull().default('pending'),
    // Order of the Documents card rows.
    position: smallint().notNull(),
    // When the first file was attached.
    attachedAt: timestamp({ withTimezone: true, mode: 'date' }),
    ...timestamps(),
  },
  (t) => [
    tenantKey('documents', t),
    tenantFk('documents_load_fk', t.organizationId, t.loadId, loads).onDelete('cascade'),
    uniqueIndex('documents_org_load_type_uq').on(t.organizationId, t.loadId, t.documentType),
    index('documents_org_type_status_idx').on(t.organizationId, t.documentType, t.status),
    check('documents_attached_ck', sql`(${t.status} = 'attached') = (${t.attachedAt} is not null)`),
  ],
);

export const documentVersions = pgTable(
  'document_versions',
  {
    id: id(),
    organizationId: organizationId(),
    documentId: uuid().notNull(),
    // 1, 2, … per document; the highest is the current file.
    versionNumber: integer().notNull(),
    // The name the user uploaded ("rate-con-40223.pdf").
    fileName: text().notNull(),
    // Object key in the documents bucket: org/{organization_id}/documents/{document_id}/v{version_number}.
    storageKey: text().notNull(),
    mimeType: text().notNull(),
    sizeBytes: bigint({ mode: 'number' }).notNull(),
    checksumSha256: text(),
    // Null for seeded placeholders.
    uploadedByUserId: uuid().references(() => users.id, { onDelete: 'restrict' }),
    uploadedAt: timestamp({ withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    tenantKey('document_versions', t),
    tenantFk('document_versions_document_fk', t.organizationId, t.documentId, documents).onDelete('cascade'),
    uniqueIndex('document_versions_document_version_uq').on(t.organizationId, t.documentId, t.versionNumber),
    uniqueIndex('document_versions_storage_key_uq').on(t.storageKey),
    check('document_versions_number_ck', sql`${t.versionNumber} >= 1 and ${t.sizeBytes} >= 0`),
  ],
);
