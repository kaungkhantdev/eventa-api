import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../db/drizzle.constants';
import { organizations, users } from '../../db/schema';
import type { OrganizationRow, Persona, UserRow } from '../auth/auth.types';

/**
 * Data access for the `users` table — the user record other contexts read through.
 * NOTE: the pre-auth lookups (findLoginUser) run before a tenant is known; under a
 * non-owner DB role they must go through a SECURITY DEFINER path — see the RLS note
 * in the 0002 migration.
 */
@Injectable()
export class UsersRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** The sign-in candidate for an org + email + audience (null if absent). */
  async findLoginUser(
    orgSlug: string,
    email: string,
    persona: Persona,
  ): Promise<{ user: UserRow; org: OrganizationRow } | null> {
    const rows = await this.db
      .select({ user: users, org: organizations })
      .from(users)
      .innerJoin(organizations, eq(users.organizationId, organizations.id))
      .where(
        and(
          eq(organizations.slug, orgSlug),
          eq(users.email, email),
          eq(users.persona, persona),
          isNull(users.deletedAt),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Every sign-in candidate on an address, across workspaces (US-ACC-02).
   *
   * A user row belongs to exactly one organization, so a person invited into a
   * second workspace has a second account that merely shares an email. Sign-in
   * no longer asks which one — nobody knows their workspace slug, and the
   * product invented it for them — so the caller checks the password against
   * each of these and lets that decide.
   *
   * Capped: this runs one password verification per row, and argon2 is
   * deliberately expensive. Beyond the cap the caller asks for the workspace.
   */
  async findLoginCandidates(
    email: string,
    persona: Persona,
    limit: number,
  ): Promise<{ user: UserRow; org: OrganizationRow }[]> {
    return this.db
      .select({ user: users, org: organizations })
      .from(users)
      .innerJoin(organizations, eq(users.organizationId, organizations.id))
      .where(
        and(
          eq(users.email, email),
          eq(users.persona, persona),
          isNull(users.deletedAt),
          isNull(organizations.deletedAt),
        ),
      )
      .limit(limit);
  }

  /** Load a user + their organization (for /auth/me). */
  async findProfile(
    userId: string,
  ): Promise<{ user: UserRow; org: OrganizationRow } | null> {
    const rows = await this.db
      .select({ user: users, org: organizations })
      .from(users)
      .innerJoin(organizations, eq(users.organizationId, organizations.id))
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  async touchLastActive(userId: string): Promise<void> {
    await this.db
      .update(users)
      .set({ lastActiveAt: new Date() })
      .where(eq(users.id, userId));
  }
}
