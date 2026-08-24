import { Injectable } from '@nestjs/common';
import {
  ImageUploadService,
  type IssuedUpload,
  type UploadScope,
} from '../uploads/image-upload.service';

/**
 * The cover image an event shows on its landing page and in discover.
 *
 * Thin, like the workspace logo: every rule that makes an upload safe — the
 * content type, the magic-byte check, the size ceiling, the "that upload is not
 * yours" guard — lives once in `ImageUploadService`. All this adds is where the
 * bytes are staged and what the noun is called in a refusal.
 *
 * Scoped by ORGANIZATION rather than by event, and that is deliberate. The
 * create wizard offers the cover on step 1, before the draft exists to hang an
 * id on; keying the staging area to an event would make the field unusable
 * exactly where the kit puts it. The confirmed URL is then just a field value
 * the event carries, saved with the rest of the form.
 */
@Injectable()
export class EventCoverService {
  constructor(private readonly uploads: ImageUploadService) {}

  requestUpload(
    organizationId: number,
    input: { contentType: string; byteSize: number },
  ): Promise<IssuedUpload> {
    return this.uploads.requestUpload(scopeFor(organizationId), input);
  }

  /**
   * Promote the verified bytes and hand back the URL to store on the event.
   *
   * No previous cover is deleted here. Unlike a logo, which a workspace has one
   * of, a cover belongs to an event that may not be saved yet — and removing
   * the old one before the form is submitted would strip the image from an
   * event whose edit was then abandoned.
   */
  confirm(organizationId: number, key: string): Promise<string> {
    return this.uploads.confirm(scopeFor(organizationId), key);
  }
}

/**
 * Staging is keyed by organization so one workspace can never confirm another's
 * upload; the final prefix is a place no presigned URL ever points at.
 */
function scopeFor(organizationId: number): UploadScope {
  return {
    stagingPrefix: `staging/org/${organizationId}/event-covers/`,
    finalPrefix: `org/${organizationId}/event-covers/`,
    noun: 'cover image',
  };
}
