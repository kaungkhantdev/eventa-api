import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../db/drizzle.constants';
import { organizations } from '../../db/schema';
import { withTenant } from '../../db/tenant';
import type { OrganizationRow } from './organization.types';

/** Data access for the workspace (tenant root) record. */
@Injectable()
export class OrganizationRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async find(organizationId: number): Promise<OrganizationRow | null> {
    const [row] = await this.db
      .select()
      .from(organizations)
      .where(
        and(
          eq(organizations.id, organizationId),
          isNull(organizations.deletedAt),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  /** Apply the given columns and return the saved row. */
  async update(
    organizationId: number,
    values: Partial<OrganizationRow>,
  ): Promise<OrganizationRow | null> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .update(organizations)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(organizations.id, organizationId))
        .returning();
      return row ?? null;
    });
  }
}
