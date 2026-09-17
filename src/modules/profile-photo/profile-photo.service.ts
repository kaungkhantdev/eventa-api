import { Injectable } from '@nestjs/common';
import type { AuthContext } from '../auth/auth.types';
import {
  ImageUploadService,
  type UploadScope,
} from '../uploads/image-upload.service';
import { ProfileService } from '../users/profile.service';
import { photoPrefixFor, stagingPrefixFor } from './profile-photo.types';
import type { PhotoUploadDto } from './dto/photo-upload.dto';
import type {
  ConfirmPhotoInput,
  RequestPhotoUploadInput,
} from './dto/photo-input';

/**
 * Profile photo (US-DISC-11). The bytes never pass through this service: the
 * browser PUTs them straight to object storage using a short-lived presigned
 * URL, then confirms, and only then does the photo appear on the profile.
 *
 * Thin, like the workspace logo and the event cover. Every rule that makes an
 * upload safe — keys are issued and never accepted, the BYTES are checked
 * rather than the client's claim, and a verified object is promoted to a key
 * that was never presigned — lives once in `ImageUploadService`. This service
 * had its own copy of all three, which is how `ImageUploadService` came to
 * exist in the first place; the copy is now gone, so the magic-byte check
 * cannot be right in one place and subtly wrong in the other.
 *
 * What is genuinely profile-specific is all that remains: the photo is scoped
 * to the CALLER rather than to a workspace, and the confirmed URL is written to
 * the profile through `ProfileService` — this module owns no tables.
 */
@Injectable()
export class ProfilePhotoService {
  constructor(
    private readonly uploads: ImageUploadService,
    private readonly profile: ProfileService,
  ) {}

  requestUpload(
    auth: AuthContext,
    input: RequestPhotoUploadInput,
  ): Promise<PhotoUploadDto> {
    return this.uploads.requestUpload(scopeFor(auth.userId), input);
  }

  /** Only after this does the photo become the profile's. */
  async confirm(
    auth: AuthContext,
    input: ConfirmPhotoInput,
  ): Promise<{ avatarUrl: string }> {
    const avatarUrl = await this.uploads.confirm(
      scopeFor(auth.userId),
      input.key,
    );
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
    await this.profile.setAvatarUrl(auth, null);
    await this.uploads.removeAt(current.avatarUrl);
  }
}

/**
 * Scoped by USER, unlike the logo and the cover: a profile photo belongs to the
 * person, so one attendee can never confirm another's upload.
 */
function scopeFor(userId: string): UploadScope {
  return {
    stagingPrefix: stagingPrefixFor(userId),
    finalPrefix: photoPrefixFor(userId),
    noun: 'profile photo',
  };
}
