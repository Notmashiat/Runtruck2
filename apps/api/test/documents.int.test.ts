import { S3Client } from '@aws-sdk/client-s3';
import { hashPassword, schema } from '@runtruck/database';
import { PLACEHOLDER_PDF, PLACEHOLDER_PDF_SHA256 } from '@runtruck/database/seed';
import type { Permission } from '@runtruck/permissions';
import type { LoadDetail, LoadDocument } from '@runtruck/types';
import { LOAD_DOCUMENT_MAX_BYTES } from '@runtruck/validation';
import { and, count, eq, inArray, isNull } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { StorageService } from '../src/storage/storage.service.js';
import { createTestContext, TEST_PASSWORD, type TestContext } from './helpers.js';

// docs/api/documents.md and docs/13-document-system.md: GET/POST /loads/:id/documents,
// the byte-sniffing allowlist, storage-before-transaction, T12 and the seeded objects.

type Agent = ReturnType<typeof request.agent>;

let t: TestContext;
let rosa: Agent;
let driver: Agent;
let accounting: Agent;
let other: Agent;
let uploadOnly: Agent;
let demo: string;
const loadIds = new Map<number, string>();

const db = () => t.db.db;
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n', 'latin1');
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]);

async function customMember(key: string, memberNumber: string, permissions: Permission[]): Promise<Agent> {
  const email = `${key}@sunridgefreight.test`;
  const [role] = await db().insert(schema.roles).values({ organizationId: demo, key: `custom_${key}`, name: key }).returning({ id: schema.roles.id });
  const perms = await db().select({ id: schema.permissions.id }).from(schema.permissions).where(inArray(schema.permissions.key, permissions));
  await db().insert(schema.rolePermissions).values(perms.map((p) => ({ roleId: role!.id, permissionId: p.id })));
  const [user] = await db()
    .insert(schema.users)
    .values({ email, fullName: `Custom ${key}`, passwordHash: await hashPassword(TEST_PASSWORD) })
    .returning({ id: schema.users.id });
  await db().insert(schema.organizationMembers).values({ organizationId: demo, userId: user!.id, memberNumber, title: 'Custom' });
  await db().insert(schema.userRoles).values({ organizationId: demo, userId: user!.id, roleId: role!.id });
  const agent = request.agent(t.server);
  await agent.post('/api/v1/auth/login').send({ email, password: TEST_PASSWORD }).expect(200);
  return agent;
}

const loadId = (n: number) => {
  const id = loadIds.get(n);
  if (!id) throw new Error(`no load ${n}`);
  return id;
};

const upload = (agent: Agent, n: number, documentType: string, file: Buffer, name: string) =>
  agent.post(`/api/v1/loads/${loadId(n)}/documents`).field('documentType', documentType).attach('file', file, name);

async function versionCount(): Promise<number> {
  const [row] = await db().select({ n: count() }).from(schema.documentVersions);
  return row!.n;
}

async function statusOf(n: number): Promise<string> {
  const [row] = await db().select({ status: schema.loads.status }).from(schema.loads).where(eq(schema.loads.id, loadId(n)));
  return row!.status;
}

async function audits(action: string, entityId: string) {
  return db()
    .select({ action: schema.auditLogs.action, next: schema.auditLogs.next, previous: schema.auditLogs.previous, entityLabel: schema.auditLogs.entityLabel })
    .from(schema.auditLogs)
    .where(and(eq(schema.auditLogs.action, action), eq(schema.auditLogs.entityId, entityId)));
}

async function events(type: string, aggregateId: string) {
  return db()
    .select({ payload: schema.events.payload, aggregateType: schema.events.aggregateType })
    .from(schema.events)
    .where(and(eq(schema.events.type, type), eq(schema.events.aggregateId, aggregateId)));
}

beforeAll(async () => {
  t = await createTestContext();
  demo = t.orgs.demoOrganizationId;
  rosa = await t.as('admin');
  driver = await t.as('driver');
  accounting = await t.as('accounting');
  other = await t.as('otherAdmin');
  uploadOnly = await customMember('uploader', '900000011', ['documents.upload']);
  const rows = await db().select({ id: schema.loads.id, n: schema.loads.loadNumber }).from(schema.loads).where(eq(schema.loads.organizationId, demo));
  for (const r of rows) loadIds.set(r.n, r.id);
});
afterAll(async () => {
  vi.restoreAllMocks();
  await t.close();
});

describe('seeded document objects (13 §7)', () => {
  it('stores the placeholder PDF at every seeded key', async () => {
    const storage = t.app.get(StorageService);
    const seeded = await db()
      .select({ key: schema.documentVersions.storageKey, size: schema.documentVersions.sizeBytes })
      .from(schema.documentVersions)
      .where(isNull(schema.documentVersions.uploadedByUserId));
    expect(seeded.length).toBe(22); // 21 demo versions + the Test Carrier Co fixture's one
    for (const v of seeded) {
      const head = await storage.head(v.key);
      expect(head).not.toBeNull();
      expect(head!.sizeBytes).toBe(PLACEHOLDER_PDF.length);
      expect(v.size).toBe(PLACEHOLDER_PDF.length);
    }
    const bytes = await storage.get(seeded[0]!.key);
    expect(bytes.equals(PLACEHOLDER_PDF)).toBe(true);
    expect(PLACEHOLDER_PDF_SHA256).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('GET /loads/:id/documents (§2)', () => {
  it('lists L-40218’s slots with the seeded version', async () => {
    const res = await rosa.get(`/api/v1/loads/${loadId(40218)}/documents`).expect(200);
    expect(res.body.meta).toEqual({});
    const docs = res.body.data as LoadDocument[];
    expect(docs.map((d) => [d.documentType, d.status, d.position, d.versionCount])).toEqual([
      ['rate_confirmation', 'attached', 1, 1],
      ['bill_of_lading', 'pending', 2, 0],
      ['proof_of_delivery', 'pending', 3, 0],
    ]);
    expect(docs[0]).toMatchObject({
      loadId: loadId(40218),
      attachedAt: '2026-09-03T17:05:00.000Z',
      currentVersion: {
        versionNumber: 1,
        fileName: 'rate-confirmation-L-40218.pdf',
        mimeType: 'application/pdf',
        sizeBytes: PLACEHOLDER_PDF.length,
        checksumSha256: PLACEHOLDER_PDF_SHA256,
        uploadedAt: '2026-09-03T17:05:00.000Z',
        uploadedBy: null,
      },
    });
    expect(docs[1]!.currentVersion).toBeNull();
    expect(docs[1]!.attachedAt).toBeNull();
    expect(JSON.stringify(res.body)).not.toContain('org/');
  });

  it('matches the other seeded checklists', async () => {
    const statuses = async (n: number) => ((await rosa.get(`/api/v1/loads/${loadId(n)}/documents`).expect(200)).body.data as LoadDocument[]).map((d) => [d.documentType, d.status]);
    expect(await statuses(40212)).toEqual([
      ['rate_confirmation', 'attached'],
      ['bill_of_lading', 'attached'],
      ['proof_of_delivery', 'attached'],
    ]);
    expect(await statuses(40209)).toEqual([['proof_of_delivery', 'attached']]);
    expect(await statuses(40207)).toEqual([['proof_of_delivery', 'pending']]);
    expect(await statuses(40198)).toEqual([]);
  });

  it('needs a session and documents.view; hides other tenants; validates the id', async () => {
    await request(t.server).get(`/api/v1/loads/${loadId(40218)}/documents`).expect(401);
    expect((await driver.get(`/api/v1/loads/${loadId(40218)}/documents`).expect(403)).body.error.code).toBe('FORBIDDEN');
    expect((await uploadOnly.get(`/api/v1/loads/${loadId(40218)}/documents`).expect(403)).body.error.code).toBe('FORBIDDEN');
    expect((await other.get(`/api/v1/loads/${loadId(40218)}/documents`).expect(404)).body.error.code).toBe('LOAD_NOT_FOUND');
    await rosa.get('/api/v1/loads/00000000-0000-4000-8000-000000000000/documents').expect(404);
    expect((await rosa.get('/api/v1/loads/nope/documents').expect(400)).body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /loads/:id/documents (§3)', () => {
  it('uploads a bill of lading: object first, then version, audit and event', async () => {
    const res = await upload(rosa, 40218, 'bill_of_lading', PDF, 'C:\\scans\\bol "40218".pdf').expect(201);
    const doc = res.body.data as LoadDocument;
    expect(doc).toMatchObject({ documentType: 'bill_of_lading', status: 'attached', position: 2, versionCount: 1 });
    expect(doc.currentVersion).toMatchObject({ versionNumber: 1, fileName: 'bol 40218.pdf', mimeType: 'application/pdf', sizeBytes: PDF.length, uploadedBy: { fullName: 'Rosa Medina' } });
    expect(doc.attachedAt).toBe(doc.currentVersion!.uploadedAt);
    expect(doc.attachedAt!.startsWith('2026-09-0')).toBe(true);

    const [version] = await db().select().from(schema.documentVersions).where(eq(schema.documentVersions.id, doc.currentVersion!.id));
    expect(version!.storageKey).toBe(`org/${demo}/loads/${loadId(40218)}/documents/${doc.currentVersion!.id}`);
    expect(version!.organizationId).toBe(demo);
    const head = await t.app.get(StorageService).head(version!.storageKey);
    expect(head).toEqual({ sizeBytes: PDF.length, contentType: 'application/pdf' });

    const [audit] = await audits('DOCUMENT_UPLOADED', doc.id);
    expect(audit).toMatchObject({ entityLabel: 'L-40218 · Bill of lading', previous: { status: 'pending' } });
    expect(audit!.next).toEqual({
      loadId: loadId(40218),
      documentType: 'bill_of_lading',
      versionNumber: 1,
      fileName: 'bol 40218.pdf',
      mimeType: 'application/pdf',
      sizeBytes: PDF.length,
      checksumSha256: version!.checksumSha256,
    });
    const [event] = await events('DocumentUploaded', doc.id);
    expect(event).toEqual({
      aggregateType: 'document',
      payload: { loadId: loadId(40218), documentId: doc.id, documentVersionId: doc.currentVersion!.id, documentType: 'bill_of_lading', versionNumber: 1 },
    });
    expect(await events('PODUploaded', doc.id)).toEqual([]);

    // The load detail reads it back; no load_activity row is written (13 §5).
    const detail = (await rosa.get('/api/v1/loads/by-number/40218').expect(200)).body.data as LoadDetail;
    expect(detail.documents!.find((d) => d.documentType === 'bill_of_lading')!.status).toBe('attached');
    expect(detail.activity).toHaveLength(4);
  });

  it('adds a version to an attached slot and creates a slot the load lacked', async () => {
    const v2 = (await upload(rosa, 40218, 'rate_confirmation', PNG, 'ratecon.png').expect(201)).body.data as LoadDocument;
    expect(v2).toMatchObject({ position: 1, versionCount: 2, attachedAt: '2026-09-03T17:05:00.000Z', currentVersion: { versionNumber: 2, mimeType: 'image/png', fileName: 'ratecon.png' } });
    const tender = (await upload(rosa, 40218, 'customer_load_tender', PDF, 'tender.pdf').expect(201)).body.data as LoadDocument;
    expect(tender).toMatchObject({ documentType: 'customer_load_tender', position: 4, versionCount: 1 });
    // Archived loads take uploads too.
    await upload(rosa, 40209, 'bill_of_lading', PDF, 'bol.pdf').expect(201);
  });

  it('attaches a POD without loads.update and leaves the load needs_pod (C32)', async () => {
    expect(await statusOf(40214)).toBe('needs_pod');
    const doc = (await upload(uploadOnly, 40214, 'proof_of_delivery', PDF, 'pod.pdf').expect(201)).body.data as LoadDocument;
    expect(doc).toMatchObject({ status: 'attached', versionCount: 1 });
    expect(await statusOf(40214)).toBe('needs_pod');
    expect(await audits('LOAD_STATUS_CHANGED', loadId(40214))).toEqual([]);
    expect(await events('LoadStatusChanged', loadId(40214))).toEqual([]);
    const [pod] = await events('PODUploaded', doc.id);
    expect(pod!.payload).toEqual({ loadId: loadId(40214), documentId: doc.id, documentVersionId: doc.currentVersion!.id });
  });

  it('moves a needs_pod load to delivered when the uploader holds loads.update (T12)', async () => {
    const doc = (await upload(rosa, 40214, 'proof_of_delivery', PDF, 'pod-signed.pdf').expect(201)).body.data as LoadDocument;
    expect(doc.versionCount).toBe(2);
    expect(await statusOf(40214)).toBe('delivered');
    const [audit] = await audits('LOAD_STATUS_CHANGED', loadId(40214));
    expect(audit).toMatchObject({ entityLabel: 'L-40214', previous: { status: 'needs_pod' }, next: { status: 'delivered' } });
    const [event] = await events('LoadStatusChanged', loadId(40214));
    expect(event).toEqual({ aggregateType: 'load', payload: { loadId: loadId(40214), loadNumber: 40214, from: 'needs_pod', to: 'delivered' } });
    const board = await rosa.get('/api/v1/loads').expect(200);
    expect(board.body.meta.summary).toMatchObject({ needsPod: 0, delivered: 3 });
    // A second POD on a delivered load changes nothing further.
    await upload(rosa, 40214, 'proof_of_delivery', PDF, 'pod-again.pdf').expect(201);
    expect(await audits('LOAD_STATUS_CHANGED', loadId(40214))).toHaveLength(1);
  });

  it('refuses files the allowlist does not cover, empty files and missing parts', async () => {
    const before = await versionCount();
    const code = async (req: request.Test) => (await req.expect(400)).body.error.code as string;
    expect(await code(upload(rosa, 40218, 'bill_of_lading', Buffer.from('BM<html><script>alert(1)</script></html>'), 'x.bmp'))).toBe('DOCUMENT_FILE_TYPE_NOT_ALLOWED');
    expect(await code(upload(rosa, 40218, 'bill_of_lading', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'x.svg'))).toBe('DOCUMENT_FILE_TYPE_NOT_ALLOWED');
    expect(await code(upload(rosa, 40218, 'bill_of_lading', Buffer.from('<!DOCTYPE html><p>hi</p>'), 'x.pdf'))).toBe('DOCUMENT_FILE_TYPE_NOT_ALLOWED');
    expect(await code(upload(rosa, 40218, 'bill_of_lading', Buffer.alloc(0), 'empty.pdf'))).toBe('DOCUMENT_FILE_EMPTY');
    expect(await code(rosa.post(`/api/v1/loads/${loadId(40218)}/documents`).field('documentType', 'bill_of_lading'))).toBe('DOCUMENT_FILE_MISSING');
    const refused = await upload(rosa, 40218, 'bill_of_lading', Buffer.from('<svg/>'), 'x.svg').expect(400);
    expect(refused.body.error.message).toBe('Attach a PDF or an image.');
    expect(await code(rosa.post(`/api/v1/loads/${loadId(40218)}/documents`).attach('file', PDF, 'a.pdf'))).toBe('VALIDATION_ERROR');
    expect(await code(upload(rosa, 40218, 'invoice', PDF, 'a.pdf'))).toBe('VALIDATION_ERROR');
    expect(await code(rosa.post(`/api/v1/loads/${loadId(40218)}/documents`).send({ documentType: 'bill_of_lading' }))).toBe('VALIDATION_ERROR');
    expect(
      await code(rosa.post(`/api/v1/loads/${loadId(40218)}/documents`).field('documentType', 'bill_of_lading').attach('file', PDF, 'a.pdf').attach('file', PDF, 'b.pdf')),
    ).toBe('VALIDATION_ERROR');
    expect(await code(rosa.post(`/api/v1/loads/${loadId(40218)}/documents`).field('documentType', 'bill_of_lading').attach('upload', PDF, 'a.pdf'))).toBe('VALIDATION_ERROR');
    expect(await code(rosa.post('/api/v1/loads/nope/documents').field('documentType', 'bill_of_lading').attach('file', PDF, 'a.pdf'))).toBe('VALIDATION_ERROR');
    expect(await versionCount()).toBe(before);
  });

  it('cuts a file over 25 MiB at the limit', async () => {
    const big = Buffer.alloc(LOAD_DOCUMENT_MAX_BYTES + 1, 0x20);
    big.write('%PDF-1.4', 0, 'latin1');
    const res = await upload(rosa, 40218, 'lumper_receipt', big, 'huge.pdf').expect(400);
    expect(res.body.error).toMatchObject({ code: 'DOCUMENT_FILE_TOO_LARGE', message: 'The file is larger than 25 MB.' });
  });

  it('answers 502 and records nothing when storage fails', async () => {
    const before = await versionCount();
    const auditBefore = (await db().select({ n: count() }).from(schema.auditLogs))[0]!.n;
    const spy = vi.spyOn(S3Client.prototype, 'send').mockRejectedValueOnce(new Error('socket hang up'));
    try {
      const res = await upload(rosa, 40212, 'lumper_receipt', PDF, 'lumper.pdf').expect(502);
      expect(res.body.error).toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE', message: 'Document storage is unavailable. Try again.' });
      expect(JSON.stringify(res.body)).not.toContain('socket');
    } finally {
      spy.mockRestore();
    }
    expect(await versionCount()).toBe(before);
    expect((await db().select({ n: count() }).from(schema.auditLogs))[0]!.n).toBe(auditBefore);
    const docs = (await rosa.get(`/api/v1/loads/${loadId(40212)}/documents`).expect(200)).body.data as LoadDocument[];
    expect(docs.map((d) => d.documentType)).not.toContain('lumper_receipt');
  });

  it('needs a session and documents.upload; never crosses tenants', async () => {
    await request(t.server).post(`/api/v1/loads/${loadId(40218)}/documents`).field('documentType', 'bill_of_lading').attach('file', PDF, 'a.pdf').expect(401);
    expect((await upload(accounting, 40218, 'bill_of_lading', PDF, 'a.pdf').expect(403)).body.error.code).toBe('FORBIDDEN');
    expect((await upload(driver, 40218, 'bill_of_lading', PDF, 'a.pdf').expect(403)).body.error.code).toBe('FORBIDDEN');
    expect((await upload(other, 40218, 'bill_of_lading', PDF, 'a.pdf').expect(404)).body.error.code).toBe('LOAD_NOT_FOUND');
    const cross = await rosa.post(`/api/v1/loads/${loadId(40218)}/documents`).set('Origin', 'https://evil.example').field('documentType', 'bill_of_lading').attach('file', PDF, 'a.pdf');
    expect(cross.status).toBe(403);
    // The other tenant's own uploads stay in its organization.
    const [otherLoad] = await db().select({ id: schema.loads.id }).from(schema.loads).where(eq(schema.loads.organizationId, t.orgs.otherOrganizationId)).limit(1);
    const doc = (await other.post(`/api/v1/loads/${otherLoad!.id}/documents`).field('documentType', 'bill_of_lading').attach('file', PDF, 'a.pdf').expect(201)).body.data as LoadDocument;
    const [version] = await db().select().from(schema.documentVersions).where(eq(schema.documentVersions.id, doc.currentVersion!.id));
    expect(version!.organizationId).toBe(t.orgs.otherOrganizationId);
    expect(version!.storageKey.startsWith(`org/${t.orgs.otherOrganizationId}/`)).toBe(true);
    await rosa.get(`/api/v1/loads/${otherLoad!.id}/documents`).expect(404);
  });
});
