import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../../db/drizzle.constants';
import { permissions, rolePermissions, roles } from '../../../db/schema';
import { withTenant } from '../../../db/tenant';
import type { Tx } from '../../../db/tenant';
import type { PermissionKey } from '../decorators/require-permissions.decorator';
import type {
  PermissionCatalogItem,
  RoleWithPermissions,
} from './access.types';

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
