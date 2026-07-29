import { Injectable } from '@nestjs/common';
import { DomainException } from '../../../common/errors/domain.exception';
import { Paginated } from '../../../common/http/paginated';
import type { PermissionKey } from '../decorators/require-permissions.decorator';
import { AccessRepository } from './access.repository';
import type {
  ListMembersQuery,
  MemberRow,
  PermissionCatalogItem,
  RoleWithPermissions,
} from './access.types';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/** RBAC management rules: view the catalog/roles and grant/revoke on a role. */
@Injectable()
export class AccessService {
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

  /** A page of the workspace's members with their role. */
  async listMembers(
    organizationId: number,
    query: ListMembersQuery,
  ): Promise<Paginated<MemberRow>> {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(
      MAX_LIMIT,
      Math.max(1, query.limit ?? DEFAULT_LIMIT),
    );
    const { items, total } = await this.repo.listMembers(organizationId, {
      limit,
      offset: (page - 1) * limit,
    });
    return Paginated.of(items, total, page, limit);
  }

  /** Re-assign a member to another role (both must belong to the caller org). */
  async changeMemberRole(
    organizationId: number,
    membershipId: number,
    roleId: number,
  ): Promise<MemberRow> {
    if (!(await this.repo.memberExists(organizationId, membershipId))) {
      throw DomainException.notFound(
        `Member ${membershipId} not found in this workspace.`,
      );
    }
    if (!(await this.repo.roleExists(organizationId, roleId))) {
      throw DomainException.notFound(
        `Role ${roleId} not found in this workspace.`,
      );
    }
    await this.repo.updateMemberRole(organizationId, membershipId, roleId);
    return this.repo.getMember(organizationId, membershipId);
  }
}
