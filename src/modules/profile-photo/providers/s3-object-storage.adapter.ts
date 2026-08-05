import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/env.validation';
import {
  ObjectStoragePort,
  type CopyObjectInput,
  type PresignPutInput,
  type PresignedUpload,
  type StoredObject,
} from '../ports/object-storage.port';

/** S3's error name when the key simply is not there. */
const NOT_FOUND = 'NotFound';
const NOT_FOUND_STATUS = 404;

/**
 * Amazon S3 behind `ObjectStoragePort`. Two SDK behaviours are corrected here,
 * both of which silently break uploads if left at their defaults:
 *
 * - **`content-type` is NOT signed by default.** The presigner adds it to
 *   `unsignableHeaders` unconditionally, so a URL signed with `ContentType`
 *   still accepts `text/html`. `signableHeaders` puts it back under the
 *   signature, which is what makes the declared type binding.
 * - **The default checksum mode poisons the URL.** With
 *   `requestChecksumCalculation` left at `WHEN_SUPPORTED`, the SDK computes a
 *   CRC32 over the *absent* body and hoists it into the signed query, so every
 *   real upload then fails the checksum. `WHEN_REQUIRED` omits it.
 *
 * `ContentLength` is signed by default, and is an exact-equality binding rather
 * than a range — the client cannot send more or fewer bytes than it declared.
 */
@Injectable()
export class S3ObjectStorageAdapter extends ObjectStoragePort {
  private readonly logger = new Logger(S3ObjectStorageAdapter.name);
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly ttlSeconds: number;
  private readonly publicBaseUrl: string;

  constructor(config: ConfigService<Env, true>, client?: S3Client) {
    super();
    this.bucket = config.getOrThrow('S3_BUCKET', { infer: true });
    this.ttlSeconds = config.getOrThrow('UPLOAD_URL_TTL_SECONDS', {
      infer: true,
    });
    const region = config.getOrThrow('S3_REGION', { infer: true });
    const endpoint = config.get('S3_ENDPOINT', { infer: true });
    this.publicBaseUrl =
      config.get('S3_PUBLIC_BASE_URL', { infer: true }) ??
      // An S3-compatible endpoint (MinIO) serves path-style from itself; the
      // AWS hostname would be a dead link saved onto someone's profile.
      (endpoint
        ? `${endpoint.replace(/\/+$/, '')}/${this.bucket}`
        : `https://${this.bucket}.s3.${region}.amazonaws.com`);
    this.client = client ?? this.buildClient(config, region, endpoint);
  }

  async presignPut(input: PresignPutInput): Promise<PresignedUpload> {
    const uploadUrl = await getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
        ContentType: input.contentType,
        ContentLength: input.byteSize,
      }),
      {
        expiresIn: this.ttlSeconds,
        // Without this the type is advisory; with it, S3 enforces it.
        signableHeaders: new Set(['content-type']),
      },
    );
    return {
      uploadUrl,
      headers: {
        'content-type': input.contentType,
        'content-length': String(input.byteSize),
      },
      expiresInSeconds: this.ttlSeconds,
    };
  }

  async head(key: string): Promise<StoredObject | null> {
    try {
      const found = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return {
        contentType: found.ContentType ?? null,
        byteSize: found.ContentLength ?? null,
      };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  /** Just the leading bytes — enough to tell a JPEG from an HTML document. */
  async readPrefix(key: string, byteCount: number): Promise<Uint8Array | null> {
    try {
      const found = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Range: `bytes=0-${byteCount - 1}`,
        }),
      );
      return (await found.Body?.transformToByteArray()) ?? null;
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  /**
   * `MetadataDirective: REPLACE` is the point: the destination gets the content
   * type WE verified and nothing the client attached to the original PUT.
   */
  async copy(input: CopyObjectInput): Promise<void> {
    await this.client.send(
      new CopyObjectCommand({
        Bucket: this.bucket,
        CopySource: `${this.bucket}/${input.from}`,
        Key: input.to,
        ContentType: input.contentType,
        ContentDisposition: 'inline',
        MetadataDirective: 'REPLACE',
      }),
    );
  }

  /** Never fails the caller: a leftover object is cheaper than a failed request. */
  async remove(key: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
      );
    } catch (err) {
      this.logger.warn({ err, key }, 'could not delete object');
    }
  }

  publicUrl(key: string): string {
    return `${this.publicBaseUrl}/${key}`;
  }

  keyFromPublicUrl(url: string): string | null {
    const prefix = `${this.publicBaseUrl}/`;
    return url.startsWith(prefix) ? url.slice(prefix.length) : null;
  }

  /**
   * Credentials are passed ONLY when both are configured (local MinIO); with
   * neither, the default provider chain supplies the deployment's IAM role.
   * Passing a half-empty object instead would defeat the chain and fail at
   * signing time.
   */
  private buildClient(
    config: ConfigService<Env, true>,
    region: string,
    endpoint: string | undefined,
  ): S3Client {
    const accessKeyId = config.get('S3_ACCESS_KEY_ID', { infer: true });
    const secretAccessKey = config.get('S3_SECRET_ACCESS_KEY', { infer: true });
    return new S3Client({
      region,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
      ...(accessKeyId && secretAccessKey
        ? { credentials: { accessKeyId, secretAccessKey } }
        : {}),
    });
  }
}

function isNotFound(err: unknown): boolean {
  const candidate = err as
    { name?: string; $metadata?: { httpStatusCode?: number } } | undefined;
  return (
    candidate?.name === NOT_FOUND ||
    candidate?.$metadata?.httpStatusCode === NOT_FOUND_STATUS
  );
}
