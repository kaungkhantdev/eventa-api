import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../db/drizzle.constants';
import { events, memberships, organizations } from '../../db/schema';
import { withTenant } from '../../db/tenant';
import type { OrganizationRow } from './organization.types';

/** Data access for the workspace (tenant root) record. */
@Injectable()
export class OrganizationRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /**
   * The two figures the Organization card shows beside the logo.
   *
   * Counted, not stored — a cached tally is a second source of truth that goes
   * stale the moment somebody is removed or an event is deleted, and nothing
   * here is hot enough to need one.
   *
   * Deleted rows are excluded from both: a workspace that removed a colleague
   * should not still be told it has them.
   */
  async summarise(
    organizationId: number,
  ): Promise<{ eventsHosted: number; teamMembers: number }> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [hosted] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(events)
        .where(
          and(
            eq(events.organizationId, organizationId),
            isNull(events.deletedAt),
          ),
        );
      const [team] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(memberships)
        .where(
          and(
            eq(memberships.organizationId, organizationId),
            isNull(memberships.deletedAt),
          ),
        );
      return { eventsHosted: hosted.count, teamMembers: team.count };
    });
  }

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

  /**
   * Is another live workspace already called this?
   *
   * `uq_organizations_name` is the guarantee — normalized (lowercased,
   * trimmed) and partial, so a deleted workspace does not hold its name
   * forever. This exists so a rename answers with a sentence rather than a
   * 500, and matches that index exactly.
   */
  async nameTaken(name: string, exceptOrgId: number): Promise<boolean> {
    const [row] = await this.db
      .select({ id: organizations.id })
      .from(organizations)
      .where(
        and(
          sql`lower(btrim(${organizations.name})) = lower(btrim(${name}))`,
          isNull(organizations.deletedAt),
          ne(organizations.id, exceptOrgId),
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  /** Optimistic update: writes only when `version` still matches, bumping it. */
  async update(
    organizationId: number,
    values: Partial<OrganizationRow>,
    currentVersion: number,
  ): Promise<OrganizationRow | null> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .update(organizations)
        .set({
          ...values,
          version: currentVersion + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(organizations.id, organizationId),
            eq(organizations.version, currentVersion),
          ),
        )
        .returning();
      return row ?? null;
    });
  }
}
