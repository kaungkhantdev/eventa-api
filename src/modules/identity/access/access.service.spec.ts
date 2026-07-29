import { DomainException } from '../../../common/errors/domain.exception';
import { AccessRepository } from './access.repository';
import { AccessService } from './access.service';

const orgId = 1;

describe('AccessService', () => {
  let repo: jest.Mocked<AccessRepository>;
  let service: AccessService;

  beforeEach(() => {
    repo = {
      listPermissions: jest.fn(),
      listRoles: jest.fn(),
      roleExists: jest.fn(),
      setRolePermissions: jest.fn().mockResolvedValue(undefined),
      getRole: jest.fn(),
    } as unknown as jest.Mocked<AccessRepository>;
    service = new AccessService(repo);
  });

  describe('listRoles', () => {
    it('returns each role with its granted permission keys', async () => {
      repo.listRoles.mockResolvedValue([
        {
          id: 5,
          name: 'Admin',
          description: 'Full access',
          permissions: ['evCreate', 'setUsers'],
        },
      ]);

      const roles = await service.listRoles(orgId);

      expect(repo.listRoles).toHaveBeenCalledWith(orgId);
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
        .setRolePermissions(orgId, 999, ['evCreate'])
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
      });

      const role = await service.setRolePermissions(orgId, 5, [
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
      });

      await service.setRolePermissions(orgId, 5, ['regView', 'regView']);

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
