// The object key of a document version (docs/13-document-system.md §2, 03 §5.7.2):
// org/{organization_id}/loads/{load_id}/documents/{version_id}. Built only from the
// caller's organization, the load found in it and the server-generated version id, never
// from input, and known before any row is locked (13 §4.4). The seed builds the same key
// for its placeholder objects (`documentStorageKey` in @runtruck/database/seed; a unit test
// keeps the two identical), but production code never loads the seed module.
export function documentStorageKey(organizationId: string, loadId: string, versionId: string): string {
  return `org/${organizationId}/loads/${loadId}/documents/${versionId}`;
}
