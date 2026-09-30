import { createHash, randomUUID } from 'node:crypto';
import type { DbExecutor } from '../../client.js';
import { documents, documentVersions } from '../../schema/documents.js';
import { BOARD_LOADS, UNINVOICED_LOADS } from './loads.js';
import { must, type DemoRefs } from './refs.js';

// Load documents (§7.12, §7.13): the D7 checklist slots of the board loads and the POD
// slot of every uninvoiced load. Each attached slot has one version whose object is the
// fixed placeholder PDF below (§7), keyed org/{organization_id}/loads/{load_id}/documents/{version_id}.

type DocumentType = (typeof documents.$inferInsert)['documentType'];

// When Runtruck1's "Attached" files arrived: 10:05 on the demo day (C4).
export const SEEDED_ATTACHED_AT = new Date('2026-09-03T17:05:00Z');

// A minimal one-page PDF with a valid cross-reference table. Every seeded version
// points at these same bytes; size_bytes and checksum_sha256 are computed from them.
function buildPlaceholderPdf(): Buffer {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefAt = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

export const PLACEHOLDER_PDF: Buffer = buildPlaceholderPdf();
export const PLACEHOLDER_PDF_SHA256: string = createHash('sha256').update(PLACEHOLDER_PDF).digest('hex');
export const PLACEHOLDER_PDF_MIME = 'application/pdf';

// §5.7.2: the object key of a document version in the runtruck-documents bucket. It is
// built from ids known before the upload transaction (the load and a pre-generated version
// id), so the object can be written before any row is locked (docs/13-document-system.md §4.4).
export const documentStorageKey = (organizationId: string, loadId: string, versionId: string): string =>
  `org/${organizationId}/loads/${loadId}/documents/${versionId}`;

const FILE_PREFIX: Record<DocumentType, string> = {
  rate_confirmation: 'rate-confirmation',
  customer_load_tender: 'customer-load-tender',
  bill_of_lading: 'bill-of-lading',
  proof_of_delivery: 'proof-of-delivery',
  lumper_receipt: 'lumper-receipt',
};

interface SlotSeed {
  loadNumber: number;
  documentType: DocumentType;
  position: number;
  attached: boolean;
}

// Runtruck1 LoadDetailPage.tsx:40-44 for the board loads: rate confirmation always,
// bill of lading once delivered or needing POD, POD once delivered.
function boardSlots(): SlotSeed[] {
  return BOARD_LOADS.flatMap((l) => {
    const delivered = l.status === 'delivered';
    return [
      { loadNumber: l.loadNumber, documentType: 'rate_confirmation' as const, position: 1, attached: true },
      { loadNumber: l.loadNumber, documentType: 'bill_of_lading' as const, position: 2, attached: delivered || l.status === 'needs_pod' },
      { loadNumber: l.loadNumber, documentType: 'proof_of_delivery' as const, position: 3, attached: delivered },
    ];
  });
}

// Runtruck1 UNINVOICED pod: one proof-of-delivery slot per load.
function uninvoicedSlots(): SlotSeed[] {
  return UNINVOICED_LOADS.map((l) => ({ loadNumber: l.loadNumber, documentType: 'proof_of_delivery' as const, position: 1, attached: l.podAttached }));
}

export const DEMO_DOCUMENT_SLOTS: readonly SlotSeed[] = [...boardSlots(), ...uninvoicedSlots()];

export async function seedDocuments(db: DbExecutor, refs: DemoRefs): Promise<void> {
  const { organizationId } = refs;
  const inserted = await db
    .insert(documents)
    .values(
      DEMO_DOCUMENT_SLOTS.map((s) => ({
        organizationId,
        loadId: must(refs.loads, s.loadNumber, 'load'),
        documentType: s.documentType,
        status: s.attached ? ('attached' as const) : ('pending' as const),
        position: s.position,
        attachedAt: s.attached ? SEEDED_ATTACHED_AT : null,
      })),
    )
    .returning({ id: documents.id, loadId: documents.loadId, documentType: documents.documentType, status: documents.status });

  const loadNumberById = new Map([...refs.loads].map(([n, id]) => [id, n]));
  const versions = inserted
    .filter((d) => d.status === 'attached')
    .map((d) => {
      const loadNumber = must(loadNumberById, d.loadId, 'load id');
      const id = randomUUID();
      return {
        id,
        organizationId,
        documentId: d.id,
        versionNumber: 1,
        fileName: `${FILE_PREFIX[d.documentType]}-L-${loadNumber}.pdf`,
        storageKey: documentStorageKey(organizationId, d.loadId, id),
        mimeType: PLACEHOLDER_PDF_MIME,
        sizeBytes: PLACEHOLDER_PDF.length,
        checksumSha256: PLACEHOLDER_PDF_SHA256,
        uploadedByUserId: null,
        uploadedAt: SEEDED_ATTACHED_AT,
      };
    });
  await db.insert(documentVersions).values(versions);
}
