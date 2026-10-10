import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { DomainException } from '../../common/errors/domain.exception';
import { DRIZZLE, type Database } from '../../db/drizzle.constants';
import {
  authSessions,
  memberships,
  permissions,
  rolePermissions,
  roles,
  users,
} from '../../db/schema';
import { withTenant } from '../../db/tenant';
import type { Tx } from '../../db/tenant';
import { Persona } from '../auth/auth.types';
import type { PermissionKey } from '../../common/decorators/require-permissions.decorator';
import type {
  InviteMemberInput,
  ListMembersOptions,
  MemberRow,
  PermissionCatalogItem,
  RoleWithPermissions,
} from './access.types';
import { roleGrantStates } from './role-grants';
import type { RoleGrantRow } from './role-grants';

const ACTIVE_STATUS = 'Active' as const;
/** The role that must never be left without a holder. */
const ADMIN_ROLE = 'Admin' as const;

const MEMBER_COLUMNS = {
  id: memberships.id,
  userId: memberships.userId,
  name: users.name,
  email: users.email,
  roleId: memberships.roleId,
  role: roles.name,
  status: memberships.status,
};

/** Data access for RBAC management (roles ⇄ permissions). Roles are tenant-scoped. */
@Injectable()
export class AccessRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** The global permission catalog (not tenant-scoped). */
  listPermissions(): Promise<PermissionCatalogItem[]> {
    return this.db
      .select({
        key: permissions.key,
        group: permissions.group,
        label: permissions.label,
      })
      .from(permissions)
      .orderBy(asc(permissions.group), asc(permissions.key));
  }

  /** This org's roles, each with its grants and live member count. */
  listRoles(
    organizationId: number,
    search?: string,
  ): Promise<RoleWithPermissions[]> {
    return withTenant(this.db, organizationId, (tx) =>
      this.rolesWithGrants(tx, organizationId, undefined, search),
    );
  }

  async getRole(
    organizationId: number,
    roleId: number,
  ): Promise<RoleWithPermissions> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [role] = await this.rolesWithGrants(tx, organizationId, roleId);
      return role;
    });
  }

  async roleExists(organizationId: number, roleId: number): Promise<boolean> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .select({ id: roles.id })
        .from(roles)
        .where(
          and(eq(roles.id, roleId), eq(roles.organizationId, organizationId)),
        )
        .limit(1);
      return row !== undefined;
    });
  }

  /**
   * Record the organizer's decision about every permission key, for this role.
   *
   * A key that is turned off is RECORDED as `granted = false`, not deleted,
   * because deleting it left "the organizer took this away" and "nobody here
   * has ever been asked about this key" as the same absence on disk. Those are
   * different facts — one is a decision to leave alone, the other an open
   * question the roles editor has to put to somebody — and nothing else in the
   * schema tells them apart. Every read filters on `granted`, so a false row
   * grants nothing.
   *
   * The second statement therefore CREATES the rows it needs rather than only
   * updating the ones that exist. A save is a decision about the whole catalog,
   * because that is what the editor shows: a switch per key, every one of them
   * either on or off when the organizer presses save. So a key left off is
   * refused whether or not the role had a row for it, and the refusal is
   * written down.
   *
   * It did not used to be. While an automatic backfill existed, writing a row
   * for a key the role had never been offered would have sealed shut the gap
   * that backfill existed to fill, so this statement only ever UPDATED. The
   * backfill is gone — nothing grants a permission automatically now — so there
   * is no gap left to seal, and the old objection has become the opposite
   * argument: without these rows a key the organizer has decided about would go
   * on being reported as an open question, and they would be asked again
   * forever.
   *
   * Provisioning a workspace deliberately does NOT do this (see
   * `insertDefaultRoles`): the default matrix is the product's choice, not a
   * decision anybody at this workspace made, so a key outside it stays an open
   * question until an organizer answers it.
   */
  async setRolePermissions(
    organizationId: number,
    roleId: number,
    keys: PermissionKey[],
  ): Promise<void> {
    await withTenant(this.db, organizationId, async (tx) => {
      if (keys.length > 0) {
        await tx
          .insert(rolePermissions)
          .values(
            keys.map((key) => ({ roleId, permissionKey: key, granted: true })),
          )
          .onConflictDoUpdate({
            target: [rolePermissions.roleId, rolePermissions.permissionKey],
            set: { granted: true },
          });
      }
      // Driven by `permissions` rather than by a list from this process, so the
      // refusals cover exactly the keys the catalog actually has — a key this
      // code knew about but the database did not would violate the foreign key.
      // `::bigint` because the role id is a bound parameter in a SELECT list:
      // without the cast its type is Postgres' to infer, and an `unknown`
      // parameter there is a planner error rather than a coercion.
      await tx.execute(sql`
        insert into role_permissions (role_id, permission_key, granted)
        select ${roleId}::bigint, p.key, false
          from permissions p
         where p.key <> all(${keyArray(keys)})
        on conflict (role_id, permission_key) do update set granted = false
      `);
    });
  }

  /** A page of this org's members (membership ⋈ user ⋈ role), plus the total. */
  async listMembers(
    organizationId: number,
    opts: ListMembersOptions,
  ): Promise<{ items: MemberRow[]; total: number }> {
    return withTenant(this.db, organizationId, async (tx) => {
      const where = memberFilter(organizationId, opts);
      // The count carries the SAME joins as the rows. Counting `memberships`
      // alone was already a latent mismatch, and a search on a name or an email
      // makes it certain: the filter lives on `users`, so a count that never
      // joined it would describe a different set from the page beneath it.
      const [{ count }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .innerJoin(roles, eq(roles.id, memberships.roleId))
        .where(where);
      const items = await tx
        .select(MEMBER_COLUMNS)
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .innerJoin(roles, eq(roles.id, memberships.roleId))
        .where(where)
        .orderBy(asc(memberships.id))
        .limit(opts.limit)
        .offset(opts.offset);
      return { items, total: count };
    });
  }

  /**
   * How many members sit in each status, for the Users tabs (US-ACC-02).
   *
   * One grouped pass rather than four counting queries, and deliberately
   * unfiltered by status — a tab has to show its own total even while another
   * tab is the one selected, or the counts would all collapse to the current
   * view. Search and role DO apply: narrowing to "anong" should narrow the tabs.
   */
  async countMembersByStatus(
    organizationId: number,
    opts: Pick<ListMembersOptions, 'search' | 'roleId'>,
  ): Promise<Record<string, number>> {
    return withTenant(this.db, organizationId, async (tx) => {
      const rows = await tx
        .select({
          status: memberships.status,
          count: sql<number>`count(*)::int`,
        })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .innerJoin(roles, eq(roles.id, memberships.roleId))
        .where(memberFilter(organizationId, opts))
        .groupBy(memberships.status);
      return Object.fromEntries(rows.map((r) => [r.status, r.count]));
    });
  }

  async memberExists(
    organizationId: number,
    membershipId: number,
  ): Promise<boolean> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .select({ id: memberships.id })
        .from(memberships)
        .where(
          and(
            eq(memberships.id, membershipId),
            eq(memberships.organizationId, organizationId),
            isNull(memberships.deletedAt),
          ),
        )
        .limit(1);
      return row !== undefined;
    });
  }

  async getMember(
    organizationId: number,
    membershipId: number,
  ): Promise<MemberRow> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .select(MEMBER_COLUMNS)
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .innerJoin(roles, eq(roles.id, memberships.roleId))
        .where(
          and(
            eq(memberships.id, membershipId),
            eq(memberships.organizationId, organizationId),
          ),
        )
        .limit(1);
      return row;
    });
  }

  /** Is this email already a console member of the org? */
  /**
   * The teammate already holding this address, with the status that decides
   * what a second invite means.
   *
   * It used to answer a plain yes/no, which made both halves of US-SET-11's
   * third criterion the same answer: an ALREADY-INVITED colleague who lost
   * their link was refused with "already exists in the workspace" exactly as
   * an active one is, and nothing could re-send to them.
   */
  async findMemberByEmail(
    organizationId: number,
    email: string,
  ): Promise<{
    membershipId: number;
    userId: string;
    status: string;
  } | null> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .select({
          membershipId: memberships.id,
          userId: users.id,
          status: memberships.status,
        })
        .from(users)
        .innerJoin(
          memberships,
          and(
            eq(memberships.userId, users.id),
            eq(memberships.organizationId, organizationId),
          ),
        )
        .where(
          and(
            eq(users.organizationId, organizationId),
            eq(users.email, email),
            eq(users.persona, Persona.Admin),
            isNull(users.deletedAt),
          ),
        )
        .limit(1);
      return row ?? null;
    });
  }

  /** Create an Invited user + Invited membership (the target role must be in org). */
  async createInvitedMember(
    organizationId: number,
    input: InviteMemberInput,
  ): Promise<{ membershipId: number; userId: string }> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [role] = await tx
        .select({ name: roles.name })
        .from(roles)
        .where(
          and(
            eq(roles.id, input.roleId),
            eq(roles.organizationId, organizationId),
          ),
        )
        .limit(1);
      if (!role) throw DomainException.notFound('Role not found.');

      const [user] = await tx
        .insert(users)
        .values({
          organizationId,
          name: input.name,
          email: input.email,
          persona: Persona.Admin,
          status: 'Invited',
        })
        .returning({ id: users.id });
      const [membership] = await tx
        .insert(memberships)
        .values({
          organizationId,
          userId: user.id,
          roleId: input.roleId,
          role: role.name,
          status: 'Invited',
          invitedAt: new Date(),
        })
        .returning({ id: memberships.id });
      return { membershipId: membership.id, userId: user.id };
    });
  }

  /** Re-assign a membership to another role (also updates the denormalized name). */
  async updateMemberRole(
    organizationId: number,
    membershipId: number,
    roleId: number,
  ): Promise<void> {
    await withTenant(this.db, organizationId, async (tx) => {
      const [role] = await tx
        .select({ name: roles.name })
        .from(roles)
        .where(
          and(eq(roles.id, roleId), eq(roles.organizationId, organizationId)),
        )
        .limit(1);
      if (!role) return;
      await tx
        .update(memberships)
        .set({ roleId, role: role.name, updatedAt: new Date() })
        .where(
          and(
            eq(memberships.id, membershipId),
            eq(memberships.organizationId, organizationId),
          ),
        );
    });
  }

  /** Is this role name already used in the workspace? */
  async roleNameTaken(organizationId: number, name: string): Promise<boolean> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .select({ id: roles.id })
        .from(roles)
        .where(
          and(eq(roles.organizationId, organizationId), eq(roles.name, name)),
        )
        .limit(1);
      return row !== undefined;
    });
  }

  /** Create a custom (non-system) role and return its id. */
  async createRole(
    organizationId: number,
    name: string,
    description: string,
  ): Promise<number> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .insert(roles)
        .values({ organizationId, name, description, isSystem: false })
        .returning({ id: roles.id });
      return row.id;
    });
  }

  /** Does this role currently grant the given permission key? */
  async roleGrants(
    organizationId: number,
    roleId: number,
    key: PermissionKey,
  ): Promise<boolean> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .select({ id: rolePermissions.id })
        .from(rolePermissions)
        .innerJoin(roles, eq(roles.id, rolePermissions.roleId))
        .where(
          and(
            eq(roles.organizationId, organizationId),
            eq(rolePermissions.roleId, roleId),
            eq(rolePermissions.permissionKey, key),
            eq(rolePermissions.granted, true),
          ),
        )
        .limit(1);
      return row !== undefined;
    });
  }

  /** How many of this org's roles grant the key — the "never strand" guard. */
  async countRolesGranting(
    organizationId: number,
    key: PermissionKey,
  ): Promise<number> {
    const rows = await withTenant(this.db, organizationId, (tx) =>
      tx
        .select({ roleId: rolePermissions.roleId })
        .from(rolePermissions)
        .innerJoin(roles, eq(roles.id, rolePermissions.roleId))
        .where(
          and(
            eq(roles.organizationId, organizationId),
            eq(rolePermissions.permissionKey, key),
            eq(rolePermissions.granted, true),
          ),
        ),
    );
    return new Set(rows.map((r) => r.roleId)).size;
  }

  /** How many Active members hold an Admin role — the last-Admin guard. */
  async countActiveAdmins(organizationId: number): Promise<number> {
    return withTenant(this.db, organizationId, async (tx) => {
      const rows = await tx
        .select({ id: memberships.id })
        .from(memberships)
        .innerJoin(roles, eq(roles.id, memberships.roleId))
        .where(
          and(
            eq(memberships.organizationId, organizationId),
            eq(memberships.status, ACTIVE_STATUS),
            eq(roles.name, ADMIN_ROLE),
            isNull(memberships.deletedAt),
          ),
        );
      return rows.length;
    });
  }

  /** Is this membership an Active Admin? */
  async isActiveAdmin(
    organizationId: number,
    membershipId: number,
  ): Promise<boolean> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .select({ id: memberships.id })
        .from(memberships)
        .innerJoin(roles, eq(roles.id, memberships.roleId))
        .where(
          and(
            eq(memberships.id, membershipId),
            eq(memberships.organizationId, organizationId),
            eq(memberships.status, ACTIVE_STATUS),
            eq(roles.name, ADMIN_ROLE),
          ),
        )
        .limit(1);
      return row !== undefined;
    });
  }

  /**
   * Suspend or reactivate: the membership's ROLE is preserved either way, so
   * reactivating restores exactly the access they had. Suspending also flips the
   * user row so sign-in is refused, and revokes their live sessions.
   */
  async setMemberStatus(
    organizationId: number,
    membershipId: number,
    status: 'Active' | 'Suspended',
  ): Promise<void> {
    await withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .update(memberships)
        .set({ status, updatedAt: new Date() })
        .where(
          and(
            eq(memberships.id, membershipId),
            eq(memberships.organizationId, organizationId),
          ),
        )
        .returning({ userId: memberships.userId });
      if (!row) return;
      await tx
        .update(users)
        .set({ status, updatedAt: new Date() })
        .where(eq(users.id, row.userId));
      if (status === 'Suspended') {
        await tx
          .update(authSessions)
          .set({ revokedAt: new Date() })
          .where(
            and(
              eq(authSessions.userId, row.userId),
              isNull(authSessions.revokedAt),
            ),
          );
      }
    });
  }

  /**
   * End access now, keeping their past work for the record: the membership and
   * user are soft-deleted and every session revoked, so nothing they created is
   * lost and the email can be re-invited later.
   */
  async removeMember(
    organizationId: number,
    membershipId: number,
  ): Promise<void> {
    await withTenant(this.db, organizationId, async (tx) => {
      const now = new Date();
      const [row] = await tx
        .update(memberships)
        .set({ status: 'Suspended', deletedAt: now, updatedAt: now })
        .where(
          and(
            eq(memberships.id, membershipId),
            eq(memberships.organizationId, organizationId),
          ),
        )
        .returning({ userId: memberships.userId });
      if (!row) return;
      await tx
        .update(users)
        .set({ status: 'Suspended', deletedAt: now, updatedAt: now })
        .where(eq(users.id, row.userId));
      await tx
        .update(authSessions)
        .set({ revokedAt: now })
        .where(
          and(
            eq(authSessions.userId, row.userId),
            isNull(authSessions.revokedAt),
          ),
        );
    });
  }

  /** An existing Invited membership for this email, if any (re-invite, not duplicate). */
  async findInvitedByEmail(
    organizationId: number,
    email: string,
  ): Promise<{ membershipId: number; userId: string } | null> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .select({ membershipId: memberships.id, userId: users.id })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(
          and(
            eq(memberships.organizationId, organizationId),
            eq(users.email, email),
            eq(memberships.status, 'Invited'),
            isNull(memberships.deletedAt),
          ),
        )
        .limit(1);
      return row ?? null;
    });
  }

  private async rolesWithGrants(
    tx: Tx,
    organizationId: number,
    roleId?: number,
    search?: string,
  ): Promise<RoleWithPermissions[]> {
    const scope = roleId
      ? and(eq(roles.organizationId, organizationId), eq(roles.id, roleId))
      : eq(roles.organizationId, organizationId);
    const where = search ? and(scope, ilike(roles.name, `%${search}%`)) : scope;
    const roleRows = await tx
      .select({
        id: roles.id,
        name: roles.name,
        description: roles.description,
        isSystem: roles.isSystem,
      })
      .from(roles)
      .where(where)
      .orderBy(asc(roles.id));
    if (roleRows.length === 0) return [];

    const decisions = await this.decisionsByRole(
      tx,
      roleRows.map((r) => r.id),
    );
    const catalog = await this.catalogKeys(tx);
    const memberCount = await this.memberCountByRole(tx, organizationId);

    return roleRows.map((r) => {
      const states = roleGrantStates(catalog, decisions.get(r.id) ?? []);
      return {
        ...r,
        permissions: states.granted,
        neverOfferedPermissions: states.neverOffered,
        memberCount: memberCount.get(r.id) ?? 0,
      };
    });
  }

  /**
   * Every decision recorded for these roles — the refusals included.
   *
   * Deliberately NOT filtered to `granted`, unlike every enforcement read: a
   * refusal is what distinguishes a key an organizer turned off from one nobody
   * here has ever been asked about, so filtering it out would collapse the two
   * states this surface exists to report.
   */
  private async decisionsByRole(
    tx: Tx,
    roleIds: number[],
  ): Promise<Map<number, RoleGrantRow[]>> {
    const rows = await tx
      .select({
        roleId: rolePermissions.roleId,
        key: rolePermissions.permissionKey,
        granted: rolePermissions.granted,
      })
      .from(rolePermissions)
      .where(inArray(rolePermissions.roleId, roleIds));
    const byRole = new Map<number, RoleGrantRow[]>();
    for (const row of rows) {
      const list = byRole.get(row.roleId);
      if (list) list.push(row);
      else byRole.set(row.roleId, [row]);
    }
    return byRole;
  }

  /** The catalog's keys, in the order the roles editor lists them. */
  private async catalogKeys(tx: Tx): Promise<string[]> {
    const rows = await tx
      .select({ key: permissions.key })
      .from(permissions)
      .orderBy(asc(permissions.group), asc(permissions.key));
    return rows.map((row) => row.key);
  }

  private async memberCountByRole(
    tx: Tx,
    organizationId: number,
  ): Promise<Map<number, number>> {
    const rows = await tx
      .select({ roleId: memberships.roleId })
      .from(memberships)
      .where(
        and(
          eq(memberships.organizationId, organizationId),
          isNull(memberships.deletedAt),
        ),
      );
    const counts = new Map<number, number>();
    for (const row of rows) {
      counts.set(row.roleId, (counts.get(row.roleId) ?? 0) + 1);
    }
    return counts;
  }

  /**
   * Permission keys granted to the user in this org (via their active
   * membership's role).
   *
   * Tenant-scoped like every other read here, and for a reason that does not
   * show up on a developer's machine: `memberships` carries RLS, and the
   * owning role the local DATABASE_URL connects as bypasses it. Read outside
   * `withTenant` there is no `app.current_org`, so under the role the app
   * connects as in staging the policy matches nothing and this returns an
   * empty list — which every `@RequirePermissions` route then reads as "holds
   * nothing" and answers 403. Proven in test/rls.e2e-spec.ts under SET ROLE.
   */
  async getPermissions(
    organizationId: number,
    userId: string,
  ): Promise<string[]> {
    return withTenant(this.db, organizationId, async (tx) => {
      const rows = await tx
        .select({ key: rolePermissions.permissionKey })
        .from(memberships)
        .innerJoin(
          rolePermissions,
          eq(rolePermissions.roleId, memberships.roleId),
        )
        .where(
          and(
            eq(memberships.organizationId, organizationId),
            eq(memberships.userId, userId),
            eq(memberships.status, 'Active'),
            eq(rolePermissions.granted, true),
          ),
        );
      return rows.map((r) => r.key);
    });
  }
}

/**
 * The keys as a Postgres array, for `<> all(...)`.
 *
 * The cast is written out rather than left to inference because a role stripped
 * of everything sends no keys at all, and `array[]` with nothing in it gives
 * Postgres no element to take a type from.
 */
function keyArray(keys: readonly PermissionKey[]): SQL {
  const items = keys.map((key) => sql`${key}`);
  return sql`array[${sql.join(items, sql`, `)}]::permission_key[]`;
}

/**
 * The Users list's WHERE, shared by the page, its count and the tab counts so
 * the three cannot describe different sets of people.
 *
 * `search` is matched against name OR email because the box says "name or
 * email" — somebody pasting an address expects it to work.
 */
function memberFilter(
  organizationId: number,
  opts: Pick<ListMembersOptions, 'search' | 'status' | 'roleId'>,
) {
  return and(
    eq(memberships.organizationId, organizationId),
    isNull(memberships.deletedAt),
    opts.status ? eq(memberships.status, opts.status) : undefined,
    opts.roleId ? eq(memberships.roleId, opts.roleId) : undefined,
    opts.search
      ? or(
          ilike(users.name, `%${opts.search}%`),
          ilike(users.email, `%${opts.search}%`),
        )
      : undefined,
  );
}
