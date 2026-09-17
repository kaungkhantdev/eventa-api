import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../db/drizzle.constants';
import { organizations } from '../../db/schema';
import { OrganizationSetupPort } from '../dashboard/ports/workspace-setup.port';

/**
 * Organization's answer to "has this workspace been set up" (US-DASH-01).
 *
 * The definition lives here because it is a statement about invoices, and this
 * module owns them. A workspace is configured once it holds what a Thai tax
 * invoice needs beyond the name it was given at sign-up: a registered address
 * and a tax ID. Both are nullable and neither is written at sign-up, so their
 * presence is a real decision somebody made rather than a default.
 *
 * Branding is deliberately not part of it. A logo makes a receipt look like the
 * organizer's; its absence does not make the receipt wrong, and requiring one
 * would leave a workspace that has everything it legally needs staring at an
 * unticked box.
 *
 * Blank is not filled in: a space typed into the address field satisfies
 * `not null` and satisfies nobody else, so both are trimmed before the test.
 */
@Injectable()
export class OrganizationSetupAdapter extends OrganizationSetupPort {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {
    super();
  }

  async isConfigured(organizationId: number): Promise<boolean> {
    // The tenant root is not itself tenant-scoped, so this reads it directly —
    // the same way `OrganizationRepository.find` does.
    const [row] = await this.db
      .select({
        configured: sql<boolean>`btrim(coalesce(${organizations.taxId}, '')) <> ''
          and btrim(coalesce(${organizations.address}, '')) <> ''`,
      })
      .from(organizations)
      .where(
        and(
          eq(organizations.id, organizationId),
          isNull(organizations.deletedAt),
        ),
      )
      .limit(1);
    // No live workspace of that id is not "configured" — it is nothing at all.
    return row?.configured ?? false;
  }
}
