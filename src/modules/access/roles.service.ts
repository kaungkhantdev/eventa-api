import { Injectable } from '@nestjs/common';
import type { PermissionKey } from '../../common/decorators/require-permissions.decorator';
import { DomainException } from '../../common/errors/domain.exception';
import { AccessRepository } from './access.repository';
import { AccessService } from './access.service';
import type {
  Actor,
  PermissionCatalogItem,
  RoleWithPermissions,
} from './access.types';
import {
  type PermAuditRecord,
  permAuditRecord,
  roleCreatedAudit,
  rolePermissionsAudit,
} from './permission-change.audit';

/** Without this key nobody can administer the workspace's people. */
const MANAGE_USERS: PermissionKey = 'setUsers';

/** RBAC role administration: the permission catalog and grant/revoke on a role. */
@Injectable()
export class RolesService {
  constructor(
    private readonly repo: AccessRepository,
    private readonly access: AccessService,
  ) {}

  listPermissions(): Promise<PermissionCatalogItem[]> {
    return this.repo.listPermissions();
  }

  /** The roles overview: each role with its member count, description and grants. */
  listRoles(
    organizationId: number,
    search?: string,
  ): Promise<RoleWithPermissions[]> {
    return this.repo.listRoles(organizationId, search);
  }

  /**
   * Create a custom role (US-SET-13) — e.g. "Volunteer" — with exactly the
   * capabilities chosen. The creator cannot hand out access they don't hold,
   * and the creation is recorded with who made it and what it grants
   * (NFR-SUP-02), a sensitive grant flagged (US-SET-12).
   */
  async createRole(
    organizationId: number,
    actor: Actor,
    input: { name: string; description: string; permissions: PermissionKey[] },
  ): Promise<RoleWithPermissions> {
    const name = input.name.trim();
    await this.access.assertNoEscalation(
      organizationId,
      actor.userId,
      input.permissions,
    );
    if (await this.repo.roleNameTaken(organizationId, name)) {
      throw DomainException.conflict(
        `A role called "${name}" already exists — choose a unique name.`,
      );
    }
    const roleId = await this.repo.createRole(
      organizationId,
      name,
      input.description,
    );
    const keys = [...new Set(input.permissions)];
    await this.repo.setRolePermissions(
      organizationId,
      roleId,
      keys,
      permAuditRecord(roleCreatedAudit(name, keys), actor),
    );
    return this.repo.getRole(organizationId, roleId);
  }

  /**
   * Replace a role's granted permission keys (must be a role in the caller
   * org). A save that changes a grant is recorded with who made it, what was
   * granted and revoked (NFR-SUP-02), a sensitive grant flagged (US-SET-12).
   */
  async setRolePermissions(
    organizationId: number,
    actor: Actor,
    roleId: number,
    keys: PermissionKey[],
  ): Promise<RoleWithPermissions> {
    await this.access.assertNoEscalation(organizationId, actor.userId, keys);
    await this.assertUserManagementSurvives(organizationId, roleId, keys);
    if (!(await this.repo.roleExists(organizationId, roleId))) {
      throw DomainException.notFound(
        `Role ${roleId} not found in this workspace.`,
      );
    }
    const unique = [...new Set(keys)];
    await this.repo.setRolePermissions(
      organizationId,
      roleId,
      unique,
      await this.permissionChange(organizationId, roleId, unique, actor),
    );
    return this.repo.getRole(organizationId, roleId);
  }

  /** The audit row for a save, or `null` when it changes no grant. */
  private async permissionChange(
    organizationId: number,
    roleId: number,
    keys: readonly PermissionKey[],
    actor: Actor,
  ): Promise<PermAuditRecord | null> {
    const before = await this.repo.getRole(organizationId, roleId);
    const text = rolePermissionsAudit(before.name, before.permissions, keys);
    return text && permAuditRecord(text, actor);
  }

  /**
   * An edit must never leave the workspace with no role able to manage users and
   * roles — otherwise nobody could ever grant it back (US-SET-13).
   */
  private async assertUserManagementSurvives(
    organizationId: number,
    roleId: number,
    keys: readonly PermissionKey[],
  ): Promise<void> {
    if (keys.includes(MANAGE_USERS)) return; // still granted — nothing to lose
    if (!(await this.repo.roleGrants(organizationId, roleId, MANAGE_USERS))) {
      return; // this role never granted it
    }
    if (
      (await this.repo.countRolesGranting(organizationId, MANAGE_USERS)) > 1
    ) {
      return; // another role still does
    }
    throw DomainException.conflict(
      'This is the only role that can manage users and roles — grant it to another role first.',
    );
  }
}
