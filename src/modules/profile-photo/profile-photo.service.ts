import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DomainException } from '../../common/errors/domain.exception';
import type { Env } from '../../config/env.validation';
import type { AuthContext } from '../auth/auth.types';
import { ProfileService } from '../users/profile.service';
import { ObjectStoragePort } from './ports/object-storage.port';
import {
  ALLOWED_CONTENT_TYPES,
  ALLOWED_IMAGE_TYPES,
  MAGIC_BYTES_TO_READ,
  looksLike,
  photoPrefixFor,
  stagingPrefixFor,
} from './profile-photo.types';
import type { PhotoUploadDto } from './dto/photo-upload.dto';
import type {
  ConfirmPhotoInput,
  RequestPhotoUploadInput,
} from './dto/photo-input';

const NOT_AN_IMAGE = `A profile photo must be one of: ${ALLOWED_CONTENT_TYPES.join(', ')}.`;
const NOT_REALLY_AN_IMAGE = 'That file is not the image type it claims to be.';
const NOT_YOURS = 'That upload does not belong to you.';
const MISSING = 'No upload was found — send the file to the URL, then confirm.';

/**
 * Profile photo (US-DISC-11). The bytes never pass through this service: the
 * browser PUTs them straight to object storage using a short-lived presigned
 * URL, then confirms, and only then does the photo appear on the profile.
 *
 * Three rules carry the security, because a presigned URL is a capability:
 *
 * 1. **Keys are issued, never accepted.** Every key this module signs sits
 *    under `uploads/<callerId>/`, and confirm refuses anything outside the
 *    caller's own prefix — so one attendee cannot claim another's object.
 * 2. **The BYTES are checked, not the client's claim.** S3 records whatever
 *    content type the PUT declared, so re-reading it proves nothing; confirm
 *    reads the leading bytes and requires them to match the declared type.
 * 3. **A checked upload is then made immutable.** The verified object is
 *    copied to `avatars/<callerId>/…`, a key that was never presigned, and the
 *    staging object is deleted. Without that, the still-valid upload URL could
 *    replace the bytes after they passed inspection — and the copy rewrites the
 *    metadata, dropping any unsigned header the client attached.
 *
 * The URL is written to the profile through `ProfileService` — this module owns
 * no tables of its own.
 */
@Injectable()
export class ProfilePhotoService {
  private readonly maxBytes: number;

  constructor(
    private readonly storage: ObjectStoragePort,
    private readonly profile: ProfileService,
    config: ConfigService<Env, true>,
  ) {
    this.maxBytes = config.getOrThrow('UPLOAD_MAX_BYTES', { infer: true });
  }

  async requestUpload(
    auth: AuthContext,
    input: RequestPhotoUploadInput,
  ): Promise<PhotoUploadDto> {
    const image = this.requireAllowedType(input.contentType);
    this.assertWithinSize(input.byteSize);
    const key = `${stagingPrefixFor(auth.userId)}${randomUUID()}.${image.extension}`;
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

  /** Only after this does the photo become the profile's. */
  async confirm(
    auth: AuthContext,
    input: ConfirmPhotoInput,
  ): Promise<{ avatarUrl: string }> {
    this.assertOwnStagingKey(auth, input.key);
    const stored = await this.requireStored(input.key);
    const contentType = await this.verifyBytes(input.key, stored.contentType);
    const finalKey = this.finalKeyFor(auth, input.key);
    await this.storage.copy({ from: input.key, to: finalKey, contentType });
    await this.storage.remove(input.key);
    const avatarUrl = this.storage.publicUrl(finalKey);
    await this.profile.setAvatarUrl(auth, avatarUrl);
    return { avatarUrl };
  }

  /**
   * Clears whatever photo the profile actually shows — the key is read from the
   * saved URL, never taken from the caller, so a stale key cannot unset a newer
   * photo while leaving the live object served.
   */
  async remove(auth: AuthContext): Promise<void> {
    const current = await this.profile.get(auth);
    if (!current.avatarUrl) return;
    const key = this.storage.keyFromPublicUrl(current.avatarUrl);
    await this.profile.setAvatarUrl(auth, null);
    if (key) await this.storage.remove(key);
  }

  private requireAllowedType(contentType: string) {
    const image = ALLOWED_IMAGE_TYPES.get(contentType);
    if (!image) throw DomainException.validation(NOT_AN_IMAGE);
    return image;
  }

  private assertWithinSize(byteSize: number): void {
    if (byteSize <= 0 || byteSize > this.maxBytes) {
      throw DomainException.validation(
        `A profile photo must be between 1 byte and ${this.maxBytes} bytes.`,
      );
    }
  }

  /**
   * The ownership boundary. `..` is rejected outright rather than normalised —
   * a key that needs normalising is not one we issued.
   */
  private assertOwnStagingKey(auth: AuthContext, key: string): void {
    const mine = stagingPrefixFor(auth.userId);
    if (!key.startsWith(mine) || key.includes('..')) {
      throw DomainException.forbidden(NOT_YOURS);
    }
  }

  private async requireStored(key: string) {
    const stored = await this.storage.head(key);
    if (!stored) throw DomainException.validation(MISSING);
    if (
      stored.byteSize === null ||
      stored.byteSize <= 0 ||
      stored.byteSize > this.maxBytes
    ) {
      await this.storage.remove(key);
      throw DomainException.validation(
        `A profile photo must be between 1 byte and ${this.maxBytes} bytes.`,
      );
    }
    return stored;
  }

  /**
   * The only real evidence. A signed PUT forces the STORED type to equal the
   * DECLARED one, so the leading bytes are what distinguishes a photo from an
   * HTML document wearing `image/jpeg`.
   */
  private async verifyBytes(
    key: string,
    contentType: string | null,
  ): Promise<string> {
    const declared = contentType ?? '';
    if (!ALLOWED_IMAGE_TYPES.has(declared)) {
      await this.storage.remove(key);
      throw DomainException.validation(NOT_AN_IMAGE);
    }
    const bytes = await this.storage.readPrefix(key, MAGIC_BYTES_TO_READ);
    if (!bytes || !looksLike(declared, bytes)) {
      await this.storage.remove(key);
      throw DomainException.validation(NOT_REALLY_AN_IMAGE);
    }
    return declared;
  }

  private finalKeyFor(auth: AuthContext, stagingKey: string): string {
    const name = stagingKey.slice(stagingPrefixFor(auth.userId).length);
    return `${photoPrefixFor(auth.userId)}${name}`;
  }
}
