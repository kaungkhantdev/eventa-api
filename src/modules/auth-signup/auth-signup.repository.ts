import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, like, sql } from 'drizzle-orm';
import { PLATFORM_ORG_SLUG } from '../../common/tenancy/platform-org';
import { DRIZZLE, type Database } from '../../db/drizzle.constants';
import {
  memberships,
  organizations,
  permissions,
  rolePermissions,
  roles,
  users,
} from '../../db/schema';
import { withTenant, type Tx } from '../../db/tenant';
import {
  DEFAULT_ROLES,
  OWNER_ROLE,
  PERMISSION_CATALOG,
} from '../access/workspace-defaults';
import type { Persona } from '../auth/auth.types';

const ADMIN_PERSONA = 'admin';
const ATTENDEE_PERSONA = 'attendee';
/**
 * Signed up, email not yet proven — NOT `Invited`. Nobody invited someone who
 * filled in the sign-up form themselves, and an organizer reading the members
 * list should not be told otherwise.
 */
const PENDING_STATUS = 'Unconfirmed';
const ACTIVE_STATUS = 'Active';

export interface AttendeeAccountInput {
  name: string;
  email: string;
  passwordHash: string;
}

export interface BootstrapInput {
  organizationName: string;
  slug: string;
  name: string;
  email: string;
  /** Null for a social-only account (US-ACC-06) — there is no password to guess. */
  passwordHash: string | null;
}

export interface BootstrapResult {
  organizationId: number;
  userId: string;
  slug: string;
}

/** Data access for organizer sign-up (US-ACC-01): the workspace-bootstrap transaction. */
@Injectable()
export class SignupRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** Is this email already an organizer account anywhere? (Global, persona-scoped.) */
  async organizerEmailExists(email: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.email, email),
          eq(users.persona, ADMIN_PERSONA),
          isNull(users.deletedAt),
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  /**
   * Is this email already an ATTENDEE account? Persona-scoped like its organizer
   * counterpart: `users` is unique on (organization_id, email, persona), so one
   * person may hold both and neither blocks the other (US-DISC-08).
   */
  async attendeeEmailExists(email: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.email, email),
          eq(users.persona, ATTENDEE_PERSONA),
          isNull(users.deletedAt),
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  /**
   * Create an attendee in the ONE platform organization (US-DISC-08).
   *
   * No organization, no roles, no membership — an attendee owns no workspace,
   * and their tickets span every organizer on the platform. `Invited` until the
   * emailed link is opened, exactly like an organizer.
   *
   * Null when the platform organization is missing: it is seeded by migration
   * 0026, so its absence is a broken deployment for the caller to surface.
   */
  async createAttendeeAccount(
    input: AttendeeAccountInput,
  ): Promise<{ organizationId: number; userId: string } | null> {
    const [org] = await this.db
      .select({ id: organizations.id })
      .from(organizations)
      .where(
        and(
          eq(organizations.slug, PLATFORM_ORG_SLUG),
          isNull(organizations.deletedAt),
        ),
      )
      .limit(1);
    if (!org) return null;

    return withTenant(this.db, org.id, async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({
          organizationId: org.id,
          name: input.name,
          email: input.email,
          persona: ATTENDEE_PERSONA,
          status: PENDING_STATUS,
          passwordHash: input.passwordHash,
        })
        .returning({ id: users.id });
      return { organizationId: org.id, userId: user.id };
    });
  }

  /** First free workspace slug: `base`, then `base-2`, `base-3`, … (globally unique). */
  async uniqueSlug(base: string): Promise<string> {
    const rows = await this.db
      .select({ slug: organizations.slug })
      .from(organizations)
      .where(like(organizations.slug, `${base}%`));
    const taken = new Set(rows.map((r) => r.slug));
    if (!taken.has(base)) return base;
    for (let i = 2; ; i += 1) {
      const candidate = `${base}-${i}`;
      if (!taken.has(candidate)) return candidate;
    }
  }

  /**
   * Create a workspace and its owner in one transaction: organization → owner user
   * (persona=admin, status=Invited until email is confirmed) → the default role set
   * → the owner's Admin membership. Ensures the global permission catalog exists.
   */
  async bootstrapWorkspace(input: BootstrapInput): Promise<BootstrapResult> {
    return this.db.transaction(async (tx) => {
      const [org] = await tx
        .insert(organizations)
        .values({ name: input.organizationName, slug: input.slug })
        .returning({ id: organizations.id, slug: organizations.slug });
      // Now that the org exists, scope the rest to it (RLS WITH CHECK).
      await tx.execute(
        sql`select set_config('app.current_org', ${String(org.id)}, true)`,
      );

      const [owner] = await tx
        .insert(users)
        .values({
          organizationId: org.id,
          name: input.name,
          email: input.email,
          persona: ADMIN_PERSONA,
          status: PENDING_STATUS,
          passwordHash: input.passwordHash,
        })
        .returning({ id: users.id });

      await this.ensureCatalog(tx);
      const roleIdByName = await this.insertDefaultRoles(tx, org.id);
      await tx.insert(memberships).values({
        organizationId: org.id,
        userId: owner.id,
        roleId: roleIdByName[OWNER_ROLE],
        role: OWNER_ROLE,
        status: ACTIVE_STATUS,
        joinedAt: new Date(),
      });

      return { organizationId: org.id, userId: owner.id, slug: org.slug };
    });
  }

  /**
   * Activate an account once its email link is opened. Idempotent: a second click
   * (already Active) still returns the workspace slug. Returns null if unknown.
   *
   * The persona comes back too: the two audiences sign in at different pages,
   * and only an organizer's slug is ever typed into a workspace field.
   */
  async activateEmail(
    userId: string,
    organizationId: number,
  ): Promise<{ orgSlug: string; persona: Persona } | null> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [user] = await tx
        .select({ status: users.status, persona: users.persona })
        .from(users)
        .where(
          and(
            eq(users.id, userId),
            eq(users.organizationId, organizationId),
            isNull(users.deletedAt),
          ),
        )
        .limit(1);
      if (!user) return null;
      if (user.status === PENDING_STATUS) {
        await tx
          .update(users)
          .set({ status: ACTIVE_STATUS, updatedAt: new Date() })
          .where(eq(users.id, userId));
      }
      const [org] = await tx
        .select({ slug: organizations.slug })
        .from(organizations)
        .where(eq(organizations.id, organizationId))
        .limit(1);
      return org ? { orgSlug: org.slug, persona: user.persona } : null;
    });
  }

  private async ensureCatalog(tx: Tx): Promise<void> {
    await tx
      .insert(permissions)
      .values(PERMISSION_CATALOG)
      .onConflictDoNothing({ target: permissions.key });
  }

  private async insertDefaultRoles(
    tx: Tx,
    organizationId: number,
  ): Promise<Record<string, number>> {
    const idByName: Record<string, number> = {};
    for (const role of DEFAULT_ROLES) {
      const [inserted] = await tx
        .insert(roles)
        .values({
          organizationId,
          name: role.name,
          description: role.description,
        })
        .returning({ id: roles.id });
      idByName[role.name] = inserted.id;
      await tx.insert(rolePermissions).values(
        role.grants.map((key) => ({
          roleId: inserted.id,
          permissionKey: key,
          granted: true,
        })),
      );
    }
    return idByName;
  }
}
