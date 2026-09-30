// Load document wire types (architecture §21). Specified in docs/api/documents.md;
// the storage model is docs/13-document-system.md and docs/03-database.md §5.7.
// Type-only module: no runtime values.

// `document_type` (03 §4.4). Labels (web): rate_confirmation "Rate confirmation" ·
// customer_load_tender "Customer load tender" · bill_of_lading "Bill of lading" ·
// proof_of_delivery "Proof of delivery" · lumper_receipt "Lumper receipt".
export type LoadDocumentType =
  | 'rate_confirmation'
  | 'customer_load_tender'
  | 'bill_of_lading'
  | 'proof_of_delivery'
  | 'lumper_receipt';

// `document_status`: pending → "Pending" (amber) · attached → "Attached" (green).
export type LoadDocumentStatus = 'pending' | 'attached';

// The file types an upload may contain, as detected from the file's bytes
// (never from the client's Content-Type). docs/13 §4.
export type LoadDocumentMimeType =
  | 'application/pdf'
  | 'image/jpeg'
  | 'image/png'
  | 'image/gif'
  | 'image/webp'
  | 'image/tiff'
  | 'image/bmp'
  | 'image/heic'
  | 'image/heif'
  | 'image/avif';

export interface LoadDocumentUserRef {
  id: string;
  // users.full_name
  fullName: string;
}

// One uploaded file of a document slot (document_versions).
export interface LoadDocumentVersion {
  id: string;
  versionNumber: number;
  // The name the user uploaded, sanitized (docs/13 §4.3).
  fileName: string;
  mimeType: LoadDocumentMimeType;
  sizeBytes: number;
  // Lower-case hex SHA-256 of the stored bytes; null only for rows written without one.
  checksumSha256: string | null;
  // UTC ISO instant.
  uploadedAt: string;
  // Null for seeded placeholders.
  uploadedBy: LoadDocumentUserRef | null;
}

// One checklist slot of a load (documents), with its current (highest) version.
export interface LoadDocument {
  id: string;
  loadId: string;
  documentType: LoadDocumentType;
  status: LoadDocumentStatus;
  // Order of the load detail "Documents" card rows (1-based).
  position: number;
  // UTC ISO instant the first file was attached; null while pending.
  attachedAt: string | null;
  // Number of stored versions (0 while pending).
  versionCount: number;
  currentVersion: LoadDocumentVersion | null;
}

// GET /loads/:id/documents — meta is empty.
export type LoadDocumentListMeta = Record<string, never>;
