import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DomainException } from '../../common/errors/domain.exception';
import type { Env } from '../../config/env.validation';
import { ObjectStoragePort } from '../profile-photo/ports/object-storage.port';
import {
  ALLOWED_CONTENT_TYPES,
  ALLOWED_IMAGE_TYPES,
  MAGIC_BYTES_TO_READ,
  looksLike,
} from '../profile-photo/profile-photo.types';

/**
 * Uploading an image, for anything that owns one.
 *
 * The sequence below carries the security, and it exists exactly once because
 * getting it subtly different in two places is how one of them ends up wrong.
 * A profile photo and a workspace logo differ only in who owns the object and
 * where it is filed; everything that makes the upload safe is identical.
 *
 * Three rules, unchanged from the profile-photo module this was lifted out of:
 *
 * 1. **Keys are issued, never accepted.** Every key signed here sits under the
 *    caller's own staging prefix, and confirm refuses anything outside it — so
 *    one owner cannot claim another's object.
 * 2. **The BYTES are checked, not the client's claim.** Storage records
 *    whatever content type the PUT declared, so re-reading it proves nothing;
 *    confirm reads the leading bytes and requires them to match.
 * 3. **A checked upload is then made immutable.** The verified object is copied
 *    to a key that was never presigned and the staging object deleted —
 *    otherwise the still-valid upload URL could replace the bytes after they
 *    passed inspection. The copy also rewrites the metadata, dropping any
 *    unsigned header the client attached.
 *
 * Persistence is the caller's: this returns a URL and writes to no table.
 */

/** Where one owner's uploads live, and what to call them in a message. */
export interface UploadScope {
  /** Presigned keys sit here. Must end with `/`. */
  stagingPrefix: string;
  /** Verified objects are copied here. Must end with `/`. */
  finalPrefix: string;
  /** For the messages — "A workspace logo must be…". */
  noun: string;
}

export interface IssuedUpload {
  key: string;
  uploadUrl: string;
  headers: Record<string, string>;
  expiresInSeconds: number;
  maxBytes: number;
}

const NOT_AN_IMAGE = (noun: string): string =>
  `A ${noun} must be one of: ${ALLOWED_CONTENT_TYPES.join(', ')}.`;
const NOT_REALLY_AN_IMAGE = 'That file is not the image type it claims to be.';
const NOT_YOURS = 'That upload does not belong to you.';
const MISSING = 'No upload was found — send the file to the URL, then confirm.';

@Injectable()
export class ImageUploadService {
  private readonly maxBytes: number;

  constructor(
    private readonly storage: ObjectStoragePort,
    config: ConfigService<Env, true>,
  ) {
    this.maxBytes = config.getOrThrow('UPLOAD_MAX_BYTES', { infer: true });
  }

  // `async`, deliberately: these guards throw, and a synchronous throw from a
  // method that returns a promise escapes any caller using `.catch()`.
  async requestUpload(
    scope: UploadScope,
    input: { contentType: string; byteSize: number },
  ): Promise<IssuedUpload> {
    const image = ALLOWED_IMAGE_TYPES.get(input.contentType);
    if (!image) throw DomainException.validation(NOT_AN_IMAGE(scope.noun));
    this.assertWithinSize(scope.noun, input.byteSize);
    const key = `${scope.stagingPrefix}${randomUUID()}.${image.extension}`;
    return this.presign(key, input);
  }

  /** Verify what landed, promote it, and report where it is served from. */
  async confirm(scope: UploadScope, key: string): Promise<string> {
    this.assertOwnStagingKey(scope, key);
    const stored = await this.requireStored(scope, key);
    const contentType = await this.verifyBytes(scope, key, stored.contentType);
    const finalKey = `${scope.finalPrefix}${key.slice(scope.stagingPrefix.length)}`;
    await this.storage.copy({ from: key, to: finalKey, contentType });
    await this.storage.remove(key);
    return this.storage.publicUrl(finalKey);
  }

  /**
   * Remove the object a saved URL points at. The key is derived from that URL
   * rather than taken from a caller, so a stale key cannot delete a newer one.
   */
  async removeAt(publicUrl: string | null): Promise<void> {
    if (!publicUrl) return;
    const key = this.storage.keyFromPublicUrl(publicUrl);
    if (key) await this.storage.remove(key);
  }

  private async presign(
    key: string,
    input: { contentType: string; byteSize: number },
  ): Promise<IssuedUpload> {
    const presigned = await this.storage.presignPut({
      key,
      contentType: input.contentType,
      byteSize: input.byteSize,
    });
    return {
      key,
      uploadUrl: presigned.uploadUrl,
      headers: presigned.headers,
      expiresInSeconds: presigned.expiresInSeconds,
      maxBytes: this.maxBytes,
    };
  }

  private assertWithinSize(noun: string, byteSize: number): void {
    if (byteSize <= 0 || byteSize > this.maxBytes) {
      throw DomainException.validation(
        `A ${noun} must be between 1 byte and ${this.maxBytes} bytes.`,
      );
    }
  }

  /**
   * The ownership boundary. `..` is rejected outright rather than normalised —
   * a key that needs normalising is not one we issued.
   */
  private assertOwnStagingKey(scope: UploadScope, key: string): void {
    if (!key.startsWith(scope.stagingPrefix) || key.includes('..')) {
      throw DomainException.forbidden(NOT_YOURS);
    }
  }

  private async requireStored(scope: UploadScope, key: string) {
    const stored = await this.storage.head(key);
    if (!stored) throw DomainException.validation(MISSING);
    if (
      stored.byteSize === null ||
      stored.byteSize <= 0 ||
      stored.byteSize > this.maxBytes
    ) {
      await this.storage.remove(key);
      this.assertWithinSize(scope.noun, stored.byteSize ?? 0);
    }
    return stored;
  }

  /**
   * The only real evidence. A signed PUT forces the STORED type to equal the
   * DECLARED one, so the leading bytes are what distinguishes an image from an
   * HTML document wearing `image/jpeg`.
   */
  private async verifyBytes(
    scope: UploadScope,
    key: string,
    contentType: string | null,
  ): Promise<string> {
    const declared = contentType ?? '';
    if (!ALLOWED_IMAGE_TYPES.has(declared)) {
      await this.storage.remove(key);
      throw DomainException.validation(NOT_AN_IMAGE(scope.noun));
    }
    const bytes = await this.storage.readPrefix(key, MAGIC_BYTES_TO_READ);
    if (!bytes || !looksLike(declared, bytes)) {
      await this.storage.remove(key);
      throw DomainException.validation(NOT_REALLY_AN_IMAGE);
    }
    return declared;
  }
}
