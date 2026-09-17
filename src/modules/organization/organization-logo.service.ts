import { Injectable } from '@nestjs/common';
import {
  ImageUploadService,
  type IssuedUpload,
  type UploadScope,
} from '../uploads/image-upload.service';
import { OrganizationService } from './organization.service';

/**
 * The workspace logo (US-SET-07) — what attendees see on public pages,
 * invoices and receipts.
 *
 * Thin on purpose: every rule that makes an upload safe lives in
 * `ImageUploadService`, shared with the profile photo, so there is one
 * implementation of "issue a key, check the bytes, promote to an unsigned key"
 * rather than two that can drift. All this adds is whose logo it is and where
 * the resulting URL is written.
 *
 * Scoped by organization, not by user: a logo belongs to the workspace, and any
 * Admin with `setSettings` may change it — the same permission that guards the
 * rest of the company details.
 */
@Injectable()
export class OrganizationLogoService {
  constructor(
    private readonly uploads: ImageUploadService,
    private readonly organization: OrganizationService,
  ) {}

  requestUpload(
    organizationId: number,
    input: { contentType: string; byteSize: number },
  ): Promise<IssuedUpload> {
    return this.uploads.requestUpload(scopeFor(organizationId), input);
  }

  /** Only after this does the logo become the workspace's. */
  async confirm(
    organizationId: number,
    key: string,
  ): Promise<{ logoUrl: string }> {
    const logoUrl = await this.uploads.confirm(scopeFor(organizationId), key);
    // The old one is dropped only once the new one is saved: a failure here
    // leaves the workspace with the logo it already had, not with none.
    const previous = await this.currentLogo(organizationId);
    await this.organization.update(organizationId, { logoUrl });
    await this.uploads.removeAt(previous);
    return { logoUrl };
  }

  /**
   * Clear it. The stored URL is read first, so the object removed is the one
   * the workspace actually shows — never a key handed in by a caller.
   */
  async remove(organizationId: number): Promise<void> {
    const current = await this.currentLogo(organizationId);
    if (!current) return;
    await this.organization.update(organizationId, { logoUrl: null });
    await this.uploads.removeAt(current);
  }

  private async currentLogo(organizationId: number): Promise<string | null> {
    const org = await this.organization.get(organizationId);
    return org.logoUrl;
  }
}

/**
 * Staging is keyed by organization so one workspace can never confirm another's
 * upload; the final prefix is a place no presigned URL ever points at.
 */
function scopeFor(organizationId: number): UploadScope {
  return {
    stagingPrefix: `uploads/org/${organizationId}/`,
    finalPrefix: `logos/${organizationId}/`,
    noun: 'workspace logo',
  };
}
