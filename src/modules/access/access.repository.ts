import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
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

  /** Replace the role's granted keys (grant/revoke) atomically, tenant-checked. */
  async setRolePermissions(
    organizationId: number,
    roleId: number,
    keys: PermissionKey[],
  ): Promise<void> {
    await withTenant(this.db, organizationId, async (tx) => {
      await tx
        .delete(rolePermissions)
        .where(eq(rolePermissions.roleId, roleId));
      if (keys.length > 0) {
        await tx
          .insert(rolePermissions)
          .values(
            keys.map((key) => ({ roleId, permissionKey: key, granted: true })),
          );
      }
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
  async emailInOrg(organizationId: number, email: string): Promise<boolean> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            eq(users.organizationId, organizationId),
            eq(users.email, email),
            eq(users.persona, Persona.Admin),
            isNull(users.deletedAt),
          ),
        )
        .limit(1);
      return row !== undefined;
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

    const grants = await tx
      .select({
        roleId: rolePermissions.roleId,
        key: rolePermissions.permissionKey,
      })
      .from(rolePermissions)
      .where(
        and(
          inArray(
            rolePermissions.roleId,
            roleRows.map((r) => r.id),
          ),
          eq(rolePermissions.granted, true),
        ),
      );

    const byRole = new Map<number, string[]>();
    for (const g of grants) {
      const list = byRole.get(g.roleId);
      if (list) list.push(g.key);
      else byRole.set(g.roleId, [g.key]);
    }

    const counts = await tx
      .select({ roleId: memberships.roleId })
      .from(memberships)
      .where(
        and(
          eq(memberships.organizationId, organizationId),
          isNull(memberships.deletedAt),
        ),
      );
    const memberCount = new Map<number, number>();
    for (const row of counts) {
      memberCount.set(row.roleId, (memberCount.get(row.roleId) ?? 0) + 1);
    }

    return roleRows.map((r) => ({
      ...r,
      permissions: byRole.get(r.id) ?? [],
      memberCount: memberCount.get(r.id) ?? 0,
    }));
  }

  /** Permission keys granted to the user in this org (via their active membership's role). */
  async getPermissions(
    organizationId: number,
    userId: string,
  ): Promise<string[]> {
    const rows = await this.db
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
  }
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
