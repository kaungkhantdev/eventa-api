import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { DomainException } from '../../../common/errors/domain.exception';
import { DRIZZLE, type Database } from '../../../db/drizzle.constants';
import {
  memberships,
  permissions,
  rolePermissions,
  roles,
  users,
} from '../../../db/schema';
import { withTenant } from '../../../db/tenant';
import type { Tx } from '../../../db/tenant';
import { Persona } from '../auth.types';
import type { PermissionKey } from '../decorators/require-permissions.decorator';
import type {
  InviteMemberInput,
  ListMembersOptions,
  MemberRow,
  PermissionCatalogItem,
  RoleWithPermissions,
} from './access.types';

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

  /** This org's roles, each with the permission keys it grants. */
  listRoles(organizationId: number): Promise<RoleWithPermissions[]> {
    return withTenant(this.db, organizationId, (tx) =>
      this.rolesWithGrants(tx, organizationId),
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
      const where = and(
        eq(memberships.organizationId, organizationId),
        isNull(memberships.deletedAt),
      );
      const [{ count }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(memberships)
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

  private async rolesWithGrants(
    tx: Tx,
    organizationId: number,
    roleId?: number,
  ): Promise<RoleWithPermissions[]> {
    const roleRows = await tx
      .select({
        id: roles.id,
        name: roles.name,
        description: roles.description,
      })
      .from(roles)
      .where(
        roleId
          ? and(eq(roles.organizationId, organizationId), eq(roles.id, roleId))
          : eq(roles.organizationId, organizationId),
      )
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
    return roleRows.map((r) => ({ ...r, permissions: byRole.get(r.id) ?? [] }));
  }
}
