import { DomainException } from '../../common/errors/domain.exception';
import { AccessRepository } from './access.repository';
import { AccessService } from './access.service';
import type { PermissionsService } from './permissions.service';
import type { TokenService } from '../auth/token.service';

const orgId = 1;
const actor = { userId: 'u1', ip: null };

/** A role as the repository returns it — only the name and grants matter here. */
function role(name: string, permissions: string[]) {
  return {
    id: 3,
    name,
    description: '',
    permissions,
    neverOfferedPermissions: [],
    memberCount: 1,
    isSystem: true,
  };
}

describe('AccessService — member lifecycle & escalation (US-SET-11/12)', () => {
  let repo: jest.Mocked<AccessRepository>;
  let permissions: jest.Mocked<PermissionsService>;
  let service: AccessService;

  beforeEach(() => {
    repo = {
      memberExists: jest.fn().mockResolvedValue(true),
      isActiveAdmin: jest.fn().mockResolvedValue(false),
      isActiveAdminUser: jest.fn().mockResolvedValue(false),
      countActiveAdmins: jest.fn().mockResolvedValue(2),
      setMemberStatus: jest.fn().mockResolvedValue(undefined),
      removeMember: jest.fn().mockResolvedValue(undefined),
      getMember: jest.fn().mockResolvedValue({
        id: 7,
        name: 'Ann',
        roleId: 2,
        role: 'Admin',
        status: 'Suspended',
      }),
      roleExists: jest.fn().mockResolvedValue(true),
      getRole: jest.fn().mockResolvedValue(role('Organizer', ['evCreate'])),
      updateMemberRole: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<AccessRepository>;
    permissions = {
      getFor: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<PermissionsService>;
    service = new AccessService(
      repo,
      {} as unknown as TokenService,
      permissions,
      // Suspend/reactivate/remove send nothing; only the invite does.
      { enqueue: jest.fn(), enqueueIn: jest.fn() },
      { now: () => new Date('2026-10-10T08:00:00.000Z') },
      { getOrThrow: () => 'https://app.eventa.test' } as never,
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
      // An Admin acting: they hold whatever the target role grants.
      permissions.getFor.mockResolvedValue(['setUsers', 'evCreate']);
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

    /*
     * US-SET-11: "Given the last remaining Admin, when I try to remove, suspend
     * or DEMOTE them (or myself), then the action is blocked." Suspend and
     * remove were guarded; a role change was not, so the only Admin could be
     * moved to Organizer and the workspace left with nobody to manage it.
     */
    it('refuses to demote the last Admin to another role', async () => {
      repo.getRole.mockResolvedValue(role('Organizer', ['evCreate']));
      await expect(
        service.changeMemberRole(orgId, 7, 3, actor),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(repo.updateMemberRole).not.toHaveBeenCalled();
    });

    it('allows demoting an Admin while another Admin remains', async () => {
      repo.countActiveAdmins.mockResolvedValue(2);
      await service.changeMemberRole(orgId, 7, 3, actor);
      expect(repo.updateMemberRole).toHaveBeenCalledWith(
        orgId,
        7,
        3,
        expect.anything(),
      );
    });

    it('does not block the last Admin being given the Admin role', async () => {
      repo.getRole.mockResolvedValue(role('Admin', ['setUsers']));
      await service.changeMemberRole(orgId, 7, 1, actor);
      expect(repo.updateMemberRole).toHaveBeenCalledWith(
        orgId,
        7,
        1,
        expect.anything(),
      );
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

    /*
     * US-SET-12: "Given I try to grant myself more access than I currently
     * have, when I save, then it's blocked." Holding setUsers used to wave
     * every grant through, so a custom role with user management but no
     * refunds could add finRefund to itself. A standard Admin holds every
     * key, so it is never refused by this.
     */
    it('refuses a setUsers holder a key they do not hold', async () => {
      permissions.getFor.mockResolvedValue(['setUsers']);
      await expect(
        service.assertNoEscalation(orgId, 'u1', ['finRefund']),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    /*
     * US-SET-12: "Admin can do everything". A key taken off the Admin role is
     * one only an Admin could ever put back, so an Admin is never refused —
     * otherwise one unticked box on the Admin role would lock the whole
     * workspace out of that capability for good.
     */
    it('lets an Admin grant a key the Admin role no longer holds', async () => {
      repo.isActiveAdminUser.mockResolvedValue(true);
      permissions.getFor.mockResolvedValue(['setUsers']);
      await expect(
        service.assertNoEscalation(orgId, 'u1', ['finRefund']),
      ).resolves.toBeUndefined();
      expect(repo.isActiveAdminUser).toHaveBeenCalledWith(orgId, 'u1');
    });

    it('refuses to assign a role granting more than the actor holds', async () => {
      permissions.getFor.mockResolvedValue(['setUsers']);
      repo.getRole.mockResolvedValue(
        role('Admin', ['setUsers', 'finRefund', 'evCreate']),
      );
      await expect(
        service.changeMemberRole(orgId, 7, 1, actor),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(permissions.getFor).toHaveBeenCalledWith(orgId, 'u1');
      expect(repo.updateMemberRole).not.toHaveBeenCalled();
    });

    it('assigns a role whose grants the actor already holds', async () => {
      permissions.getFor.mockResolvedValue(['setUsers', 'evCreate']);
      repo.getRole.mockResolvedValue(role('Organizer', ['evCreate']));
      await service.changeMemberRole(orgId, 7, 3, actor);
      expect(repo.updateMemberRole).toHaveBeenCalledWith(
        orgId,
        7,
        3,
        expect.anything(),
      );
    });
  });
});
