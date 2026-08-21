import { Injectable } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain.exception';
import { Paginated } from '../../common/http/paginated';
import { Permission } from '../../common/decorators/require-permissions.decorator';
import { TokenService } from '../auth/token.service';
import { PermissionsService } from './permissions.service';
import { AccessRepository } from './access.repository';
import type {
  InviteMemberInput,
  ListMembersQuery,
  MemberRow,
  MemberStatusCounts,
} from './access.types';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/** Team-member administration: invite, list, and re-assign a member's role. */
@Injectable()
export class AccessService {
  constructor(
    private readonly repo: AccessRepository,
    private readonly tokens: TokenService,
    private readonly permissions: PermissionsService,
  ) {}

  /** Invite a teammate: create an Invited user + membership, return an invite token. */
  async inviteMember(
    organizationId: number,
    input: InviteMemberInput,
  ): Promise<{ member: MemberRow; inviteToken: string }> {
    if (!(await this.repo.roleExists(organizationId, input.roleId))) {
      throw DomainException.notFound(
        `Role ${input.roleId} not found in this workspace.`,
      );
    }
    if (await this.repo.emailInOrg(organizationId, input.email)) {
      throw DomainException.conflict(
        'A member with this email already exists in the workspace.',
      );
    }
    const { membershipId, userId } = await this.repo.createInvitedMember(
      organizationId,
      input,
    );
    const inviteToken = await this.tokens.signInvite({
      userId,
      organizationId,
      membershipId,
    });
    const member = await this.repo.getMember(organizationId, membershipId);
    return { member, inviteToken };
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
      // A box somebody typed into and cleared must not become a filter for the
      // empty string, which matches nobody.
      search: query.search?.trim() || undefined,
      status: query.status,
      roleId: query.roleId,
    });
    return Paginated.of(items, total, page, limit);
  }

  /**
   * The Users tabs' counts (US-ACC-02).
   *
   * Search and role narrow them; status does not — a tab has to show its own
   * total while a different tab is selected, or every count collapses to the
   * size of the current view and the tabs stop meaning anything.
   */
  async countMembers(
    organizationId: number,
    query: ListMembersQuery,
  ): Promise<MemberStatusCounts> {
    const byStatus = await this.repo.countMembersByStatus(organizationId, {
      search: query.search?.trim() || undefined,
      roleId: query.roleId,
    });
    const at = (status: string) => byStatus[status] ?? 0;
    return {
      // "All" is every status summed, including Unconfirmed — which has no tab
      // of its own but is still somebody in the workspace, so leaving it out
      // would make the tabs fail to add up.
      all: Object.values(byStatus).reduce((sum, n) => sum + n, 0),
      active: at('Active'),
      invited: at('Invited'),
      suspended: at('Suspended'),
    };
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

  /** Pause access without losing the role, so reactivating restores it exactly. */
  async suspendMember(
    organizationId: number,
    membershipId: number,
  ): Promise<MemberRow> {
    await this.assertMemberExists(organizationId, membershipId);
    await this.assertNotLastAdmin(organizationId, membershipId);
    await this.repo.setMemberStatus(organizationId, membershipId, 'Suspended');
    return this.repo.getMember(organizationId, membershipId);
  }

  async reactivateMember(
    organizationId: number,
    membershipId: number,
  ): Promise<MemberRow> {
    await this.assertMemberExists(organizationId, membershipId);
    await this.repo.setMemberStatus(organizationId, membershipId, 'Active');
    return this.repo.getMember(organizationId, membershipId);
  }

  /** End access now; their past work is kept and the email can be re-invited. */
  async removeMember(
    organizationId: number,
    membershipId: number,
  ): Promise<void> {
    await this.assertMemberExists(organizationId, membershipId);
    await this.assertNotLastAdmin(organizationId, membershipId);
    await this.repo.removeMember(organizationId, membershipId);
  }

  /** The workspace must never be left with nobody able to manage users. */
  private async assertNotLastAdmin(
    organizationId: number,
    membershipId: number,
  ): Promise<void> {
    if (!(await this.repo.isActiveAdmin(organizationId, membershipId))) return;
    if ((await this.repo.countActiveAdmins(organizationId)) > 1) return;
    throw DomainException.conflict(
      'This is the last Admin — promote someone else first.',
    );
  }

  private async assertMemberExists(
    organizationId: number,
    membershipId: number,
  ): Promise<void> {
    if (!(await this.repo.memberExists(organizationId, membershipId))) {
      throw DomainException.notFound(
        `Member ${membershipId} not found in this workspace.`,
      );
    }
  }

  /**
   * You cannot hand out access you do not hold yourself (US-SET-12) — otherwise
   * an Organizer could promote themselves to refunds or user management.
   */
  async assertNoEscalation(
    organizationId: number,
    actorUserId: string,
    granting: readonly string[],
  ): Promise<void> {
    const held = await this.permissions.getFor(organizationId, actorUserId);
    if (held.includes(Permission.setUsers)) return; // an Admin holds everything
    const beyond = granting.filter((key) => !held.includes(key));
    if (beyond.length > 0) {
      throw DomainException.forbidden(
        `You cannot grant access you do not have: ${beyond.join(', ')}.`,
      );
    }
  }
}
