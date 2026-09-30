# API — Documents (load paperwork)

Endpoints for a load's document slots and their files. Conventions: [04-api.md](../04-api.md). Storage model, upload rules and security: [13-document-system.md](../13-document-system.md). Tables: [03 §5.7](../03-database.md).

Contracts in code:
- DTOs: `packages/types/src/documents.ts` — `LoadDocument`, `LoadDocumentVersion`, `LoadDocumentUserRef`, `LoadDocumentType`, `LoadDocumentStatus`, `LoadDocumentMimeType`, `LoadDocumentListMeta`.
- Inputs: `packages/validation/src/documents.ts` — `uploadLoadDocumentSchema`, `loadDocumentTypeSchema`, `loadDocumentFileMetaSchema`, `loadDocumentParamsSchema`, `LOAD_DOCUMENT_TYPES`, `LOAD_DOCUMENT_MIME_TYPES`, `LOAD_DOCUMENT_MAX_BYTES`, `LOAD_DOCUMENT_MAX_FILE_NAME`; the path id uses `loadIdParamSchema` (`validation/src/loads.ts`).

| # | Method & path | Permission | Built in this release |
|---|---|---|---|
| 1 | `GET /api/v1/loads/:id/documents` | `documents.view` | yes |
| 2 | `POST /api/v1/loads/:id/documents` (multipart) | `documents.upload` | yes |
| 3 | `GET /api/v1/loads/:id/documents/:documentId/file` | `documents.view` | no — contract only ([13 §6](../13-document-system.md)) |

The load detail (`GET /loads/by-number/:loadNumber`, `GET /loads/:id`) embeds the same `LoadDocument[]` when the caller holds `documents.view` ([loads.md §4](loads.md)).

---

## 1. The `LoadDocument` DTO

| field | type | computed from |
|---|---|---|
| `id` | uuid | `documents.id` |
| `loadId` | uuid | `documents.load_id` |
| `documentType` | `LoadDocumentType` | `documents.document_type` |
| `status` | `'pending' \| 'attached'` | `documents.status` |
| `position` | number | `documents.position` (1-based card order) |
| `attachedAt` | ISO instant \| null | `documents.attached_at` |
| `versionCount` | number | `count(document_versions)` of the slot |
| `currentVersion` | `LoadDocumentVersion \| null` | the version with the highest `version_number`; null when there is none |

`LoadDocumentVersion`:

| field | type | from |
|---|---|---|
| `id` | uuid | `document_versions.id` |
| `versionNumber` | number | `version_number` |
| `fileName` | string | `file_name` (sanitized at upload, 13 §4.3) |
| `mimeType` | `LoadDocumentMimeType` | `mime_type` (detected at upload) |
| `sizeBytes` | number | `size_bytes` |
| `checksumSha256` | string \| null | `checksum_sha256` |
| `uploadedAt` | ISO instant | `uploaded_at` |
| `uploadedBy` | `{id, fullName}` \| null | `uploaded_by_user_id` → `users.full_name`; null for seeded placeholders |

`storage_key` is never returned (internal detail, architecture §29).

## 2. `GET /loads/:id/documents` — a load's slots

- **Permission:** `documents.view`.
- **Params:** `loadIdParamSchema` (`id` uuid). No query.
- **Response:** `{ data: LoadDocument[], meta: {} }` (`LoadDocumentListMeta`), ordered `position, id`.
- **Tenancy:** the load is looked up by `(organization_id = ctx.organizationId, id)`; a load of another organization is 404 like a missing one. Board and archived loads both resolve.
- **Queries (no N+1):** (1) the load's existence `SELECT id FROM loads WHERE organization_id = $1 AND id = $2`; (2) the slots with their current version and uploader in one statement: `documents d LEFT JOIN LATERAL (SELECT … FROM document_versions v WHERE v.organization_id = d.organization_id AND v.document_id = d.id ORDER BY v.version_number DESC LIMIT 1) cur ON true LEFT JOIN users u ON u.id = cur.uploaded_by_user_id`, plus `count(*)` of versions per slot (a second lateral or a grouped sub-select). Indexes: `documents_org_load_type_uq`, `document_versions_document_version_uq`.
- **Errors:** 400 `VALIDATION_ERROR` (malformed id) · 401 · 403 `FORBIDDEN` · 404 `LOAD_NOT_FOUND`.
- **Seed:** L-40218 → 3 slots: `rate_confirmation` attached (v1 `rate-confirmation-L-40218.pdf`, `application/pdf`, uploaded 2026-09-03T17:05:00Z, `uploadedBy` null), `bill_of_lading` pending, `proof_of_delivery` pending. L-40212 and L-40210 → all 3 attached. L-40214 → rate confirmation and bill of lading attached, POD pending. L-40209 (archived) → 1 slot `proof_of_delivery` attached. L-40198 (invoice-only) → `[]`.

## 3. `POST /loads/:id/documents` — upload a file into a slot

- **Permission:** `documents.upload`. The upload returns only the slot, so `loads.view` is not needed. Moving a `needs_pod` load to `delivered` (T12) additionally needs `loads.update`, checked in the service with `hasPermissions(ctx.permissions, ['loads.update'])`; without it the POD is attached and the load status is left unchanged.
- **Params:** `loadIdParamSchema`.
- **Body:** `multipart/form-data`: text field `documentType` validated by `uploadLoadDocumentSchema`; one file part `file`. After reading the file the API validates `{fileName, mimeType (detected), sizeBytes}` with `loadDocumentFileMetaSchema` (architecture §16: file metadata). Limits and the type allowlist: [13 §4](../13-document-system.md).
- **Behaviour:** [13 §4.4](../13-document-system.md): check the file and the load, generate the version id, **put the object before any transaction** (key `org/{org}/loads/{load}/documents/{versionId}`, S3 client limits of 13 §2), then in one transaction create the slot if missing (position `max + 1`), lock it, add version `n + 1` with that id, mark the slot `attached` (first `attached_at` kept), and move a `needs_pod` load to `delivered` when the file is a proof of delivery and the caller holds `loads.update` ([08](../08-load-lifecycle.md) T12). Business instants use `ClockService.now(org timezone)`.
- **Response:** `201 { data: LoadDocument, meta: {} }` — the slot with its new `currentVersion`.
- **Audit:** `DOCUMENT_UPLOADED` (entity `document`, `entity_label` `L-<n> · <type label>`); plus `LOAD_STATUS_CHANGED` when T12 applies (never without `loads.update`).
- **Events** (payloads as [13 §5](../13-document-system.md) and [17 §5](../17-event-architecture.md)): `DocumentUploaded` `{loadId, documentId, documentVersionId, documentType, versionNumber}`; `PODUploaded` `{loadId, documentId, documentVersionId}` for `proof_of_delivery`; `LoadStatusChanged` `{loadId, loadNumber, from, to}` when T12 applies.
- **Tests (in addition to 04/20):** a member of a custom role holding `documents.upload` but not `loads.update` uploads a POD to a `needs_pod` load → 201, the slot is attached, the load stays `needs_pod`, and no `LOAD_STATUS_CHANGED` audit row or `LoadStatusChanged` event exists; the same upload by Rosa moves the load to `delivered` with both. Storage failure or timeout → 502 and no row written. A file `BM<html>…` → 400 `DOCUMENT_FILE_TYPE_NOT_ALLOWED`.
- **Errors:**

| HTTP | code | when |
|---|---|---|
| 400 | `VALIDATION_ERROR` | `documentType` missing or not a type; malformed id; not multipart |
| 400 | `DOCUMENT_FILE_MISSING` | no `file` part ("Attach a file.") |
| 400 | `DOCUMENT_FILE_EMPTY` | 0 bytes ("The file is empty.") |
| 400 | `DOCUMENT_FILE_TOO_LARGE` | over 25 MiB ("The file is larger than 25 MB.") — the stream is cut at the limit |
| 400 | `DOCUMENT_FILE_TYPE_NOT_ALLOWED` | bytes are not a PDF or an allowed image ("Attach a PDF or an image.") |
| 401 / 403 | `UNAUTHORIZED` / `FORBIDDEN`, `CROSS_ORIGIN_REJECTED` | no session / no `documents.upload` / cross-site write |
| 404 | `LOAD_NOT_FOUND` | unknown load or another organization's |
| 502 | `DEPENDENCY_UNAVAILABLE` | object storage failed or timed out (13 §2 limits); nothing was recorded |

- **Tenancy:** the organization comes from the session only; the slot and version rows carry `ctx.organizationId`; the composite FKs make a cross-tenant slot impossible; the object key is built from the caller's organization id, the load id found in that organization and the server-generated version id, never from input.
- **Implementation notes:** Nest `FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: LOAD_DOCUMENT_MAX_BYTES, files: 1, fields: 1, fieldSize: 1024 } })` (multer ships with `@nestjs/platform-express`; `@types/multer` is a dev dependency to add); the controller maps multer's limit errors to the codes above.

## 4. `GET /loads/:id/documents/:documentId/file` — download (contract only)

`documents.view`; params `loadDocumentParamsSchema`; optional `?version=n`. Streams the current (or requested) version with the headers of [13 §6](../13-document-system.md). 404 `DOCUMENT_NOT_FOUND` when the slot is not on that load in the caller's organization or has no version. Not built in this release (no screen uses it).

## 5. Web mapping

### 5.1 Load detail — "Documents" card (`/app/loads/:loadNumber`)

- **Source:** `LoadDetail.documents` from `GET /loads/by-number/:loadNumber` (no separate call). When it is `null` (no `documents.view`) the card is not rendered (07 §8 item 1).
- **Rows:** in `position` order, `rowStyle(i)` exactly as Runtruck1:

| Runtruck1 | from the DTO |
|---|---|
| `d.name` | `LOAD_DOCUMENT_TYPE_LABEL[documentType]` — "Rate confirmation", "Customer load tender", "Bill of lading", "Proof of delivery", "Lumper receipt" |
| `d.state` | `status === 'attached' ? 'Attached' : 'Pending'` |
| `tagClass` | Attached → green (`tag-green`), Pending → amber (`tag-outline`) |

- **Seed result** (identical to Runtruck1): L-40218/19/20/21/22 → Rate confirmation Attached, Bill of lading Pending, Proof of delivery Pending; L-40214 → Attached, Attached, Pending; L-40212, L-40210 → all Attached. A New Load → five rows, Attached where a file was uploaded.

### 5.2 New Load — "Documents" section and upload after create

- The section is presentation state until Create: per type the web keeps the chosen `File` (Runtruck1 kept only its name). "Not attached" / file name, "Attach" / "Replace", "Remove" behave as in Runtruck1 (new-load §6.8), including the quirk that re-choosing the same file after Remove fires no `change` event.
- `accept=".pdf,image/*"` stays on the input.
- After `POST /loads` succeeds, the web uploads each chosen file in `LOAD_DOCUMENT_TYPES` order, one `api.upload('/loads/{id}/documents', form)` per file (`form.append('documentType', type)`, `form.append('file', file)`), sequentially, then navigates to `/app/loads/L-<n>` (Runtruck1 navigated right after create; the wait keeps the new detail page from showing Pending for a file that is still uploading). Label → type: "Rate confirmation" → `rate_confirmation`, "Customer load tender" → `customer_load_tender`, "Bill of lading" → `bill_of_lading`, "Proof of delivery" → `proof_of_delivery`, "Lumper receipt" → `lumper_receipt`.
- **Upload failure** (any 4xx/5xx above): the load already exists, so the web still closes the dialog and navigates; that slot shows Pending. Runtruck1 had no error surface here; this is recorded in [13 §8](../13-document-system.md). A client may pre-check `file.size <= LOAD_DOCUMENT_MAX_BYTES` but must not rely on it.
- Without `documents.upload` the Attach buttons are hidden (07 §5 rule) — invisible for Rosa (Admin).
- After the uploads the web invalidates the load detail, board and dashboard queries.

### 5.3 Other consumers

- Accounting › Uninvoiced "POD" chip reads the `proof_of_delivery` slot status through `GET /billing/uninvoiced-loads` (billing group; rule 03 §6.0.4), not this endpoint.
