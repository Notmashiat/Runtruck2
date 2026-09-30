import { GetObjectCommand, HeadObjectCommand, NotFound, PutObjectCommand, S3Client, S3ServiceException } from '@aws-sdk/client-s3';
import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import type { ApiEnv } from '@runtruck/config';
import { AppError } from '../common/errors/app-error.js';
import { API_ENV } from '../config/config.module.js';

// Client limits (docs/13-document-system.md §2): two attempts, 5 s to connect, 60 s per
// socket read, and a hard 120 s ceiling on an upload, so a slow or hanging store fails
// fast. No storage call is ever made inside a database transaction (13 §4.4).
export const STORAGE_MAX_ATTEMPTS = 2;
export const STORAGE_CONNECTION_TIMEOUT_MS = 5_000;
export const STORAGE_REQUEST_TIMEOUT_MS = 60_000;
export const STORAGE_PUT_DEADLINE_MS = 120_000;

export interface StoredObjectHead {
  sizeBytes: number;
  contentType: string | null;
}

// The one gateway to S3-compatible object storage (architecture §21, §25: the provider
// stays replaceable). Only the documents module uses it; other groups never touch storage.
// Any storage failure surfaces as 502 DEPENDENCY_UNAVAILABLE with a user-safe message
// (04 §3); the underlying error is logged, never returned.
@Injectable()
export class StorageService implements OnModuleDestroy {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client;
  readonly bucket: string;

  constructor(@Inject(API_ENV) env: ApiEnv) {
    this.bucket = env.S3_BUCKET;
    this.client = new S3Client({
      region: env.S3_REGION,
      ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
      maxAttempts: STORAGE_MAX_ATTEMPTS,
      requestHandler: { connectionTimeout: STORAGE_CONNECTION_TIMEOUT_MS, requestTimeout: STORAGE_REQUEST_TIMEOUT_MS },
    });
  }

  onModuleDestroy(): void {
    this.client.destroy();
  }

  // Writes one object. `checksumSha256Hex` is the lower-case hex digest stored in
  // document_versions; S3 verifies the base64 form on receipt.
  async put(key: string, body: Buffer, contentType: string, checksumSha256Hex: string): Promise<void> {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          ContentLength: body.length,
          ChecksumSHA256: Buffer.from(checksumSha256Hex, 'hex').toString('base64'),
        }),
        { abortSignal: AbortSignal.timeout(STORAGE_PUT_DEADLINE_MS) },
      );
    } catch (err) {
      throw this.unavailable('put', err);
    }
  }

  // Reads one object into memory (documents are at most 25 MiB).
  async get(key: string): Promise<Buffer> {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      if (!res.Body) throw new Error('empty body');
      return Buffer.from(await res.Body.transformToByteArray());
    } catch (err) {
      throw this.unavailable('get', err);
    }
  }

  // Size and type of an object, or null when it does not exist.
  async head(key: string): Promise<StoredObjectHead | null> {
    try {
      const res = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { sizeBytes: res.ContentLength ?? 0, contentType: res.ContentType ?? null };
    } catch (err) {
      if (err instanceof NotFound || (err instanceof S3ServiceException && err.$metadata.httpStatusCode === 404)) return null;
      throw this.unavailable('head', err);
    }
  }

  private unavailable(operation: string, err: unknown): AppError {
    const message = err instanceof Error ? err.message : String(err);
    this.logger.error({ message: 'Object storage call failed', operation, error: message });
    return new AppError('INTEGRATION_ERROR', 'DEPENDENCY_UNAVAILABLE', 'Document storage is unavailable. Try again.');
  }
}
