import { z } from 'zod';

// Load document inputs (architecture §16: validate file metadata). Specified in
// docs/api/documents.md and docs/13-document-system.md.

// Checklist order of New Load's Documents section (Runtruck1 DOCUMENTS) and of the slots
// POST /loads creates (positions 1–5).
export const LOAD_DOCUMENT_TYPES = [
  'rate_confirmation',
  'customer_load_tender',
  'bill_of_lading',
  'proof_of_delivery',
  'lumper_receipt',
] as const;

export const loadDocumentTypeSchema = z.enum(LOAD_DOCUMENT_TYPES, { error: 'Choose a document type.' });

// Largest accepted upload (25 MiB): a multi-page scanned bill of lading fits; the limit is
// enforced while the multipart body streams (docs/13 §4.1).
export const LOAD_DOCUMENT_MAX_BYTES = 25 * 1024 * 1024;

// Longest stored file name (after sanitizing, docs/13 §4.3).
export const LOAD_DOCUMENT_MAX_FILE_NAME = 255;

// Runtruck1's file input accepts ".pdf,image/*". The server accepts these types, detected
// from the file's leading bytes. SVG is excluded (it can carry script, docs/13 §4.2).
export const LOAD_DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/tiff',
  'image/bmp',
  'image/heic',
  'image/heif',
  'image/avif',
] as const;

// Text fields of the multipart body of POST /loads/:id/documents (the file part is `file`).
export const uploadLoadDocumentSchema = z.object({
  documentType: loadDocumentTypeSchema,
});

export type UploadLoadDocumentInput = z.output<typeof uploadLoadDocumentSchema>;

// Metadata of the received file, checked by the API after reading and sniffing it.
export const loadDocumentFileMetaSchema = z.object({
  fileName: z.string().min(1).max(LOAD_DOCUMENT_MAX_FILE_NAME),
  mimeType: z.enum(LOAD_DOCUMENT_MIME_TYPES, { error: 'Attach a PDF or an image.' }),
  sizeBytes: z
    .number()
    .int()
    .min(1, 'The file is empty.')
    .max(LOAD_DOCUMENT_MAX_BYTES, 'The file is larger than 25 MB.'),
});

export type LoadDocumentFileMeta = z.output<typeof loadDocumentFileMetaSchema>;

// Path params of GET /loads/:id/documents/:documentId/file.
export const loadDocumentParamsSchema = z.object({
  id: z.uuid(),
  documentId: z.uuid(),
});

export type LoadDocumentParams = z.output<typeof loadDocumentParamsSchema>;
