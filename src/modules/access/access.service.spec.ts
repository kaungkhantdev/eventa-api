import { DomainException } from '../../common/errors/domain.exception';
import { TokenService } from '../auth/token.service';
import { AccessRepository } from './access.repository';
import { AccessService } from './access.service';

const orgId = 1;

describe('AccessService', () => {
  let repo: jest.Mocked<AccessRepository>;
  let tokens: jest.Mocked<TokenService>;
  let service: AccessService;

  beforeEach(() => {
    repo = {
      roleExists: jest.fn(),
      listMembers: jest.fn(),
      memberExists: jest.fn(),
      updateMemberRole: jest.fn().mockResolvedValue(undefined),
      getMember: jest.fn(),
      emailInOrg: jest.fn(),
      createInvitedMember: jest.fn(),
    } as unknown as jest.Mocked<AccessRepository>;
    tokens = {
      signInvite: jest.fn().mockResolvedValue('invite.jwt'),
    } as unknown as jest.Mocked<TokenService>;
    service = new AccessService(repo, tokens);
  });

  describe('changeMemberRole', () => {
    const member = {
      id: 10,
      userId: 'u2',
      name: 'Sam',
      email: 's@acme.test',
      roleId: 7,
      role: 'Organizer',
      status: 'Active',
    };

    it('rejects a membership not in the caller org with 404', async () => {
      repo.memberExists.mockResolvedValue(false);

      const err = await service
        .changeMemberRole(orgId, 999, 7)
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(DomainException);
      expect((err as DomainException).getStatus()).toBe(404);
      expect(repo.updateMemberRole).not.toHaveBeenCalled();
    });

    it('rejects a target role not in the caller org with 404', async () => {
      repo.memberExists.mockResolvedValue(true);
      repo.roleExists.mockResolvedValue(false);

      const err = await service
        .changeMemberRole(orgId, 10, 999)
        .catch((e: unknown) => e);

      expect((err as DomainException).getStatus()).toBe(404);
      expect(repo.updateMemberRole).not.toHaveBeenCalled();
    });

    it('updates the member role and returns the updated member', async () => {
      repo.memberExists.mockResolvedValue(true);
      repo.roleExists.mockResolvedValue(true);
      repo.getMember.mockResolvedValue(member);

      const result = await service.changeMemberRole(orgId, 10, 7);

      expect(repo.updateMemberRole).toHaveBeenCalledWith(orgId, 10, 7);
      expect(result).toMatchObject({ id: 10, roleId: 7, role: 'Organizer' });
    });
  });

  describe('inviteMember', () => {
    const input = { name: 'New Person', email: 'new@acme.test', roleId: 7 };

    it('rejects an unknown role with 404 (no create)', async () => {
      repo.roleExists.mockResolvedValue(false);

      const err = await service
        .inviteMember(orgId, input)
        .catch((e: unknown) => e);

      expect((err as DomainException).getStatus()).toBe(404);
      expect(repo.createInvitedMember).not.toHaveBeenCalled();
    });

    it('rejects a duplicate email with 409 (no create)', async () => {
      repo.roleExists.mockResolvedValue(true);
      repo.emailInOrg.mockResolvedValue(true);

      const err = await service
        .inviteMember(orgId, input)
        .catch((e: unknown) => e);

      expect((err as DomainException).getStatus()).toBe(409);
      expect(repo.createInvitedMember).not.toHaveBeenCalled();
    });

    it('creates an invited member and returns it with an invite token', async () => {
      repo.roleExists.mockResolvedValue(true);
      repo.emailInOrg.mockResolvedValue(false);
      repo.createInvitedMember.mockResolvedValue({
        membershipId: 11,
        userId: 'u9',
      });
      repo.getMember.mockResolvedValue({
        id: 11,
        userId: 'u9',
        name: 'New Person',
        email: 'new@acme.test',
        roleId: 7,
        role: 'Organizer',
        status: 'Invited',
      });

      const result = await service.inviteMember(orgId, input);

      expect(repo.createInvitedMember).toHaveBeenCalledWith(orgId, input);
      expect(tokens.signInvite).toHaveBeenCalledWith({
        userId: 'u9',
        organizationId: orgId,
        membershipId: 11,
      });
      expect(result.inviteToken).toBe('invite.jwt');
      expect(result.member).toMatchObject({ id: 11, status: 'Invited' });
    });
  });

  describe('listMembers', () => {
    it('returns a mapped Paginated with default paging', async () => {
      repo.listMembers.mockResolvedValue({
        items: [
          {
            id: 10,
            userId: 'u2',
            name: 'Sam',
            email: 's@acme.test',
            roleId: 7,
            role: 'Organizer',
            status: 'Active',
          },
        ],
        total: 1,
      });

      const page = await service.listMembers(orgId, {});

      expect(repo.listMembers).toHaveBeenCalledWith(orgId, {
        limit: 20,
        offset: 0,
      });
      expect(page.meta).toMatchObject({ page: 1, limit: 20, total: 1 });
      expect(page.items[0]).toMatchObject({ id: 10, role: 'Organizer' });
    });
  });
});
