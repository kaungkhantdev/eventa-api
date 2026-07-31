import { Injectable } from '@nestjs/common';
import type { PermissionKey } from '../../common/decorators/require-permissions.decorator';
import { DomainException } from '../../common/errors/domain.exception';
import { AccessRepository } from './access.repository';
import type {
  PermissionCatalogItem,
  RoleWithPermissions,
} from './access.types';

/** RBAC role administration: the permission catalog and grant/revoke on a role. */
@Injectable()
export class RolesService {
  constructor(private readonly repo: AccessRepository) {}

  listPermissions(): Promise<PermissionCatalogItem[]> {
    return this.repo.listPermissions();
  }

  listRoles(organizationId: number): Promise<RoleWithPermissions[]> {
    return this.repo.listRoles(organizationId);
  }

  /** Replace a role's granted permission keys (must be a role in the caller org). */
  async setRolePermissions(
    organizationId: number,
    roleId: number,
    keys: PermissionKey[],
  ): Promise<RoleWithPermissions> {
    if (!(await this.repo.roleExists(organizationId, roleId))) {
      throw DomainException.notFound(
        `Role ${roleId} not found in this workspace.`,
      );
    }
    const unique = [...new Set(keys)];
    await this.repo.setRolePermissions(organizationId, roleId, unique);
    return this.repo.getRole(organizationId, roleId);
  }
}
