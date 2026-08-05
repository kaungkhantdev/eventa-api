import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/env.validation';
import {
  ObjectStoragePort,
  type CopyObjectInput,
  type PresignPutInput,
  type PresignedUpload,
  type StoredObject,
} from '../ports/object-storage.port';

const LOCAL_BASE = 'http://localhost/object-storage';

interface StoredBytes extends StoredObject {
  bytes: Uint8Array;
}

/**
 * In-process object storage for tests and local development
 * (`STORAGE_PROVIDER=memory`, the default so the app runs without AWS
 * credentials).
 *
 * It is a double, not a stub: `head` answers only for keys something was
 * actually stored under, so the "confirmed an upload that never happened" path
 * is real rather than assumed. `receive` stands in for the browser's PUT, which
 * has no counterpart in-process.
 */
@Injectable()
export class MemoryObjectStorageAdapter extends ObjectStoragePort {
  private readonly objects = new Map<string, StoredBytes>();
  private readonly ttlSeconds: number;

  constructor(config: ConfigService<Env, true>) {
    super();
    this.ttlSeconds = config.getOrThrow('UPLOAD_URL_TTL_SECONDS', {
      infer: true,
    });
  }

  presignPut(input: PresignPutInput): Promise<PresignedUpload> {
    return Promise.resolve({
      uploadUrl: `${LOCAL_BASE}/${input.key}`,
      headers: {
        'content-type': input.contentType,
        'content-length': String(input.byteSize),
      },
      expiresInSeconds: this.ttlSeconds,
    });
  }

  /**
   * What the browser's PUT would have done, for local development and tests.
   * The bytes are stored, not just the declared type — that is what `confirm`
   * inspects, and a real bucket stores exactly what it was sent.
   */
  receive(key: string, object: StoredObject, bytes: Uint8Array): void {
    this.objects.set(key, { ...object, bytes });
  }

  head(key: string): Promise<StoredObject | null> {
    const found = this.objects.get(key);
    return Promise.resolve(
      found
        ? { contentType: found.contentType, byteSize: found.byteSize }
        : null,
    );
  }

  readPrefix(key: string, byteCount: number): Promise<Uint8Array | null> {
    const found = this.objects.get(key);
    return Promise.resolve(found ? found.bytes.slice(0, byteCount) : null);
  }

  copy(input: CopyObjectInput): Promise<void> {
    const source = this.objects.get(input.from);
    if (source) {
      this.objects.set(input.to, { ...source, contentType: input.contentType });
    }
    return Promise.resolve();
  }

  remove(key: string): Promise<void> {
    this.objects.delete(key);
    return Promise.resolve();
  }

  publicUrl(key: string): string {
    return `${LOCAL_BASE}/${key}`;
  }

  keyFromPublicUrl(url: string): string | null {
    const prefix = `${LOCAL_BASE}/`;
    return url.startsWith(prefix) ? url.slice(prefix.length) : null;
  }
}
