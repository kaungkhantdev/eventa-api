import { DomainException } from '../../common/errors/domain.exception';
import { AccessRepository } from './access.repository';
import type { AccessService } from './access.service';
import { RolesService } from './roles.service';

const orgId = 1;
const actor = 'u1';

describe('RolesService — custom roles (US-SET-13)', () => {
  let repo: jest.Mocked<AccessRepository>;
  let access: jest.Mocked<AccessService>;
  let service: RolesService;

  beforeEach(() => {
    repo = {
      listRoles: jest.fn().mockResolvedValue([]),
      roleExists: jest.fn().mockResolvedValue(true),
      roleNameTaken: jest.fn().mockResolvedValue(false),
      createRole: jest.fn().mockResolvedValue(42),
      updateRole: jest.fn().mockResolvedValue(undefined),
      setRolePermissions: jest.fn().mockResolvedValue(undefined),
      getRole: jest.fn().mockResolvedValue({
        id: 42,
        name: 'Volunteer',
        description: 'Helps on the day',
        permissions: ['regCheckin'],
      }),
      countRolesGranting: jest.fn().mockResolvedValue(2),
      roleGrants: jest.fn().mockResolvedValue(false),
    } as unknown as jest.Mocked<AccessRepository>;
    access = {
      assertNoEscalation: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<AccessService>;
    service = new RolesService(repo, access);
  });

  describe('overview', () => {
    it('lists each role with its member count and capabilities', async () => {
      repo.listRoles.mockResolvedValue([
        {
          id: 1,
          name: 'Admin',
          description: 'Full access',
          permissions: ['setUsers'],
          memberCount: 3,
          isSystem: true,
        },
      ] as never);
      const res = await service.listRoles(orgId);
      expect(res[0]).toMatchObject({ name: 'Admin', memberCount: 3 });
    });

    it('passes a search term through to the query', async () => {
      await service.listRoles(orgId, 'vol');
      expect(repo.listRoles).toHaveBeenCalledWith(orgId, 'vol');
    });
  });

  describe('createRole', () => {
    it('creates a custom role with the chosen capabilities', async () => {
      const res = await service.createRole(orgId, actor, {
        name: 'Volunteer',
        description: 'Helps on the day',
        permissions: ['regCheckin'],
      });
      expect(repo.createRole).toHaveBeenCalledWith(
        orgId,
        'Volunteer',
        'Helps on the day',
      );
      expect(repo.setRolePermissions).toHaveBeenCalledWith(orgId, 42, [
        'regCheckin',
      ]);
      expect(res.name).toBe('Volunteer');
    });

    it('rejects a name that already exists, asking for a unique one', async () => {
      repo.roleNameTaken.mockResolvedValue(true);
      await expect(
        service.createRole(orgId, actor, {
          name: 'Admin',
          description: 'dupe',
          permissions: [],
        }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(repo.createRole).not.toHaveBeenCalled();
    });

    it('cannot grant capabilities the creator does not hold', async () => {
      access.assertNoEscalation.mockRejectedValue(
        DomainException.forbidden('nope'),
      );
      await expect(
        service.createRole(orgId, actor, {
          name: 'Sneaky',
          description: 'x',
          permissions: ['finRefund'],
        }),
      ).rejects.toBeInstanceOf(DomainException);
      expect(repo.createRole).not.toHaveBeenCalled();
    });

    it('de-duplicates the chosen capabilities', async () => {
      await service.createRole(orgId, actor, {
        name: 'Volunteer',
        description: 'x',
        permissions: ['regCheckin', 'regCheckin'],
      });
      expect(repo.setRolePermissions).toHaveBeenCalledWith(orgId, 42, [
        'regCheckin',
      ]);
    });
  });

  describe('never strand the workspace without user management', () => {
    it('refuses to remove setUsers from the LAST role that grants it', async () => {
      repo.roleGrants.mockResolvedValue(true); // this role grants setUsers
      repo.countRolesGranting.mockResolvedValue(1); // and it is the only one
      await expect(
        service.setRolePermissions(orgId, actor, 5, ['regView']),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(repo.setRolePermissions).not.toHaveBeenCalled();
    });

    it('allows it while another role still grants setUsers', async () => {
      repo.roleGrants.mockResolvedValue(true);
      repo.countRolesGranting.mockResolvedValue(2);
      await service.setRolePermissions(orgId, actor, 5, ['regView']);
      expect(repo.setRolePermissions).toHaveBeenCalled();
    });

    it('allows an edit that keeps setUsers', async () => {
      repo.roleGrants.mockResolvedValue(true);
      repo.countRolesGranting.mockResolvedValue(1);
      await service.setRolePermissions(orgId, actor, 5, [
        'setUsers',
        'regView',
      ]);
      expect(repo.setRolePermissions).toHaveBeenCalled();
    });
  });
});
