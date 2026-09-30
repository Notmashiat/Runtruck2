import type { LoadDocument, LoadDocumentListMeta, LoadDocumentType } from '@runtruck/types';
import { api } from './client';
import { apiQuery } from './query';

// Load documents (docs/api/documents.md §5). The load detail embeds the list, so the web
// reads GET /loads/:id/documents only as an API client would; uploads are multipart.

export const loadDocumentsQuery = (loadId: string) =>
  apiQuery<LoadDocument[], LoadDocumentListMeta>(['loads', 'documents', loadId], `/loads/${loadId}/documents`);

// One file into one slot (13 §4): `documentType` then the `file` part.
export function uploadLoadDocument(loadId: string, documentType: LoadDocumentType, file: File) {
  const form = new FormData();
  form.append('documentType', documentType);
  form.append('file', file);
  return api.upload<LoadDocument, LoadDocumentListMeta>(`/loads/${loadId}/documents`, form);
}
