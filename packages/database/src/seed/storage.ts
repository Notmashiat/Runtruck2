import { HeadObjectCommand, NotFound, PutObjectCommand, S3Client, S3ServiceException } from '@aws-sdk/client-s3';
import { and, eq, isNull } from 'drizzle-orm';
import type { DbExecutor } from '../client.js';
import { documentVersions } from '../schema/documents.js';
import { PLACEHOLDER_PDF, PLACEHOLDER_PDF_MIME, PLACEHOLDER_PDF_SHA256 } from './demo/documents.js';

// Seeded document objects (docs/13-document-system.md §7). The demo seed and the test
// fixtures write document_versions rows that point at the placeholder PDF; this puts
// those bytes at every seeded key that is missing from the bucket, so downloads,
// integrity checks and the orphan-cleanup job find real objects. Idempotent: keys that
// already exist are left alone. Runs after the seed transaction has committed.

export interface SeedStorageConfig {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

// The S3_* variables (.env.example); null when object storage is not configured.
export function seedStorageConfigFromEnv(env: Record<string, string | undefined> = process.env): SeedStorageConfig | null {
  const { S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_FORCE_PATH_STYLE } = env;
  if (!S3_BUCKET || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) return null;
  return {
    ...(S3_ENDPOINT ? { endpoint: S3_ENDPOINT } : {}),
    region: S3_REGION || 'us-east-1',
    bucket: S3_BUCKET,
    accessKeyId: S3_ACCESS_KEY_ID,
    secretAccessKey: S3_SECRET_ACCESS_KEY,
    forcePathStyle: S3_FORCE_PATH_STYLE === 'true',
  };
}

export interface SeedUploadResult {
  // Seeded versions found in the database.
  keys: number;
  // Objects written because they were missing.
  uploaded: number;
}

const CONCURRENCY = 8;

async function exists(client: S3Client, bucket: string, key: string): Promise<boolean> {
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (err) {
    if (err instanceof NotFound || (err instanceof S3ServiceException && err.$metadata.httpStatusCode === 404)) return false;
    throw err;
  }
}

// Every seeded version (uploaded by nobody, the placeholder's checksum) of every
// organization in `db` — the demo and, in tests, the second tenant.
export async function uploadSeedDocuments(db: DbExecutor, config: SeedStorageConfig): Promise<SeedUploadResult> {
  const rows = await db
    .select({ storageKey: documentVersions.storageKey })
    .from(documentVersions)
    .where(and(isNull(documentVersions.uploadedByUserId), eq(documentVersions.checksumSha256, PLACEHOLDER_PDF_SHA256)));

  const client = new S3Client({
    region: config.region,
    ...(config.endpoint ? { endpoint: config.endpoint } : {}),
    forcePathStyle: config.forcePathStyle,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    maxAttempts: 2,
    requestHandler: { connectionTimeout: 5_000, requestTimeout: 60_000 },
  });
  const checksum = Buffer.from(PLACEHOLDER_PDF_SHA256, 'hex').toString('base64');
  let uploaded = 0;
  try {
    const keys = rows.map((r) => r.storageKey);
    for (let i = 0; i < keys.length; i += CONCURRENCY) {
      await Promise.all(
        keys.slice(i, i + CONCURRENCY).map(async (key) => {
          if (await exists(client, config.bucket, key)) return;
          await client.send(
            new PutObjectCommand({ Bucket: config.bucket, Key: key, Body: PLACEHOLDER_PDF, ContentType: PLACEHOLDER_PDF_MIME, ChecksumSHA256: checksum }),
          );
          uploaded += 1;
        }),
      );
    }
    return { keys: keys.length, uploaded };
  } finally {
    client.destroy();
  }
}
