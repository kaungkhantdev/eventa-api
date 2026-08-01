import { DomainException } from '../../common/errors/domain.exception';
import { AccessRepository } from './access.repository';
import { AccessService } from './access.service';
import type { PermissionsService } from './permissions.service';
import type { TokenService } from '../auth/token.service';

const orgId = 1;

describe('AccessService — member lifecycle & escalation (US-SET-11/12)', () => {
  let repo: jest.Mocked<AccessRepository>;
  let permissions: jest.Mocked<PermissionsService>;
  let service: AccessService;

  beforeEach(() => {
    repo = {
      memberExists: jest.fn().mockResolvedValue(true),
      isActiveAdmin: jest.fn().mockResolvedValue(false),
      countActiveAdmins: jest.fn().mockResolvedValue(2),
      setMemberStatus: jest.fn().mockResolvedValue(undefined),
      removeMember: jest.fn().mockResolvedValue(undefined),
      getMember: jest.fn().mockResolvedValue({ id: 7, status: 'Suspended' }),
    } as unknown as jest.Mocked<AccessRepository>;
    permissions = {
      getFor: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<PermissionsService>;
    service = new AccessService(
      repo,
      {} as unknown as TokenService,
      permissions,
    );
  });

  describe('suspend / reactivate', () => {
    it('suspends a member, preserving their role for reactivation', async () => {
      await service.suspendMember(orgId, 7);
      expect(repo.setMemberStatus).toHaveBeenCalledWith(orgId, 7, 'Suspended');
    });

    it('reactivates a member', async () => {
      await service.reactivateMember(orgId, 7);
      expect(repo.setMemberStatus).toHaveBeenCalledWith(orgId, 7, 'Active');
    });

    it('404s an unknown member', async () => {
      repo.memberExists.mockResolvedValue(false);
      await expect(service.suspendMember(orgId, 99)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });
  });

  describe('the last Admin is protected', () => {
    beforeEach(() => {
      repo.isActiveAdmin.mockResolvedValue(true);
      repo.countActiveAdmins.mockResolvedValue(1);
    });

    it('refuses to suspend the last Admin', async () => {
      await expect(service.suspendMember(orgId, 7)).rejects.toBeInstanceOf(
        DomainException,
      );
      expect(repo.setMemberStatus).not.toHaveBeenCalled();
    });

    it('refuses to remove the last Admin', async () => {
      await expect(service.removeMember(orgId, 7)).rejects.toMatchObject({
        code: 'CONFLICT',
      });
      expect(repo.removeMember).not.toHaveBeenCalled();
    });

    it('allows it while another Admin remains', async () => {
      repo.countActiveAdmins.mockResolvedValue(2);
      await service.removeMember(orgId, 7);
      expect(repo.removeMember).toHaveBeenCalledWith(orgId, 7);
    });
  });

  describe('privilege escalation is blocked', () => {
    it('refuses to grant a permission the actor does not hold', async () => {
      permissions.getFor.mockResolvedValue(['evCreate']);
      await expect(
        service.assertNoEscalation(orgId, 'u1', ['evCreate', 'finRefund']),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('allows granting what the actor already holds', async () => {
      permissions.getFor.mockResolvedValue(['evCreate', 'regView']);
      await expect(
        service.assertNoEscalation(orgId, 'u1', ['evCreate']),
      ).resolves.toBeUndefined();
    });

    it('an Admin (setUsers) may grant anything', async () => {
      permissions.getFor.mockResolvedValue(['setUsers']);
      await expect(
        service.assertNoEscalation(orgId, 'u1', ['finRefund']),
      ).resolves.toBeUndefined();
    });
  });
});
