import { DomainException } from '../../common/errors/domain.exception';
import { AccessRepository } from './access.repository';
import type { AccessService } from './access.service';
import { RolesService } from './roles.service';

const orgId = 1;

describe('RolesService', () => {
  let repo: jest.Mocked<AccessRepository>;
  let service: RolesService;

  beforeEach(() => {
    repo = {
      listPermissions: jest.fn(),
      listRoles: jest.fn(),
      roleExists: jest.fn(),
      setRolePermissions: jest.fn().mockResolvedValue(undefined),
      getRole: jest.fn(),
      roleGrants: jest.fn().mockResolvedValue(false),
      countRolesGranting: jest.fn().mockResolvedValue(2),
    } as unknown as jest.Mocked<AccessRepository>;
    service = new RolesService(repo, {
      assertNoEscalation: jest.fn().mockResolvedValue(undefined),
    } as unknown as AccessService);
  });

  describe('listRoles', () => {
    it('returns each role with its granted permission keys', async () => {
      repo.listRoles.mockResolvedValue([
        {
          id: 5,
          name: 'Admin',
          description: 'Full access',
          permissions: ['evCreate', 'setUsers'],
          memberCount: 3,
          isSystem: true,
        },
      ] as never);

      const roles = await service.listRoles(orgId);

      expect(repo.listRoles).toHaveBeenCalledWith(orgId, undefined);
      expect(roles[0]).toMatchObject({
        id: 5,
        name: 'Admin',
        permissions: ['evCreate', 'setUsers'],
      });
    });
  });

  describe('setRolePermissions', () => {
    it('rejects a role that is not in the caller org with 404 (no write)', async () => {
      repo.roleExists.mockResolvedValue(false);

      const err = await service
        .setRolePermissions(orgId, 'actor', 999, ['evCreate'])
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(DomainException);
      expect((err as DomainException).getStatus()).toBe(404);
      expect(repo.setRolePermissions).not.toHaveBeenCalled();
    });

    it('replaces the granted keys and returns the updated role', async () => {
      repo.roleExists.mockResolvedValue(true);
      repo.getRole.mockResolvedValue({
        id: 5,
        name: 'Staff',
        description: 'seed',
        permissions: ['regView', 'regCheckin'],
        memberCount: 0,
        isSystem: true,
      });

      const role = await service.setRolePermissions(orgId, 'actor', 5, [
        'regView',
        'regCheckin',
      ]);

      expect(repo.setRolePermissions).toHaveBeenCalledWith(orgId, 5, [
        'regView',
        'regCheckin',
      ]);
      expect(role.permissions).toEqual(['regView', 'regCheckin']);
    });

    it('de-duplicates the incoming keys before persisting', async () => {
      repo.roleExists.mockResolvedValue(true);
      repo.getRole.mockResolvedValue({
        id: 5,
        name: 'Staff',
        description: 'seed',
        permissions: ['regView'],
        memberCount: 0,
        isSystem: true,
      });

      await service.setRolePermissions(orgId, 'actor', 5, [
        'regView',
        'regView',
      ]);

      expect(repo.setRolePermissions).toHaveBeenCalledWith(orgId, 5, [
        'regView',
      ]);
    });
  });

  describe('listPermissions', () => {
    it('returns the catalog from the repository', async () => {
      repo.listPermissions.mockResolvedValue([
        { key: 'evCreate', group: 'Events', label: 'Create & edit events' },
      ]);

      const catalog = await service.listPermissions();

      expect(catalog[0]).toMatchObject({ key: 'evCreate', group: 'Events' });
    });
  });
});
