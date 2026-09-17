import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../src/config/env.validation';
import {
  ObjectStoragePort,
  type CopyObjectInput,
  type PresignPutInput,
  type PresignedUpload,
  type StoredObject,
} from '../../src/modules/profile-photo/ports/object-storage.port';

const LOCAL_BASE = 'http://localhost/object-storage';

interface StoredBytes extends StoredObject {
  bytes: Uint8Array;
}

/**
 * In-process object storage, FOR TESTS ONLY. A suite installs it with
 * `.overrideProvider(ObjectStoragePort)`; nothing in `src/` can reach it and no
 * environment variable selects it.
 *
 * It used to be reachable from the app as `STORAGE_PROVIDER=memory`, which was
 * the wrong shape twice over. It hands the browser
 * `http://localhost/object-storage/…` — an address nothing serves — so as a
 * running configuration it is not "storage without AWS", it is uploads that
 * always fail; and being the DEFAULT meant an env that simply forgot to name a
 * bucket booted clean and broke at the first PUT. Local development uses MinIO,
 * a real bucket at a different address.
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
