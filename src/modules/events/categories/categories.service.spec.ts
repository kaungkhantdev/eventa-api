import { DomainException } from '../../../common/errors/domain.exception';
import { CategoriesRepository } from './categories.repository';
import { CategoriesService } from './categories.service';
import type { CategoryRow } from './categories.types';

const actor = { organizationId: 1, userId: 'u1' };

function categoryRow(o: Partial<CategoryRow> = {}): CategoryRow {
  return {
    id: 10,
    organizationId: 1,
    name: 'Conference',
    description: null,
    icon: 'presentation-01',
    color: 'blue',
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    version: 1,
    ...o,
  };
}

describe('CategoriesService', () => {
  let repo: jest.Mocked<CategoriesRepository>;
  let service: CategoriesService;

  beforeEach(() => {
    repo = {
      nameExists: jest.fn().mockResolvedValue(false),
      insert: jest
        .fn()
        .mockImplementation((v: Partial<CategoryRow>) =>
          Promise.resolve(categoryRow(v)),
        ),
      list: jest.fn().mockResolvedValue({ items: [], total: 0 }),
      findCategory: jest.fn().mockResolvedValue(categoryRow()),
      findWithCount: jest
        .fn()
        .mockResolvedValue({ ...categoryRow(), eventCount: 0 }),
      countEvents: jest.fn().mockResolvedValue(0),
      update: jest
        .fn()
        .mockImplementation(
          (_o: number, _id: number, v: Partial<CategoryRow>) =>
            Promise.resolve(categoryRow({ ...v, version: 2 })),
        ),
      softDelete: jest.fn().mockResolvedValue(true),
    } as unknown as jest.Mocked<CategoriesRepository>;
    service = new CategoriesService(repo);
  });

  describe('createCategory', () => {
    it('creates a category and reports a zero event count', async () => {
      const res = await service.createCategory(actor, {
        name: 'Workshop',
        icon: 'tools',
        color: 'amber',
      });
      expect(repo.insert).toHaveBeenCalledTimes(1);
      expect(res).toMatchObject({ name: 'Workshop', eventCount: 0 });
    });

    it('rejects a duplicate name in the workspace (409)', async () => {
      repo.nameExists.mockResolvedValue(true);
      const err = await service
        .createCategory(actor, { name: 'Conference', icon: 'x', color: 'blue' })
        .catch((e: unknown) => e);
      expect((err as DomainException).getStatus()).toBe(409);
      expect(repo.insert).not.toHaveBeenCalled();
    });

    it('trims the name before checking uniqueness and inserting', async () => {
      await service.createCategory(actor, {
        name: '  Gala  ',
        icon: 'x',
        color: 'brand',
      });
      expect(repo.nameExists).toHaveBeenCalledWith(1, 'Gala', undefined);
      expect(repo.insert.mock.calls[0][0].name).toBe('Gala');
    });
  });

  describe('getCategory', () => {
    it('returns the category with its event count', async () => {
      repo.findWithCount.mockResolvedValue({
        ...categoryRow(),
        eventCount: 12,
      });
      const res = await service.getCategory(actor, 10);
      expect(res).toMatchObject({ id: 10, eventCount: 12 });
    });

    it('throws 404 when the category is not in the org', async () => {
      repo.findWithCount.mockResolvedValue(null);
      const err = await service
        .getCategory(actor, 999)
        .catch((e: unknown) => e);
      expect((err as DomainException).getStatus()).toBe(404);
    });
  });

  describe('updateCategory', () => {
    it('throws 404 when the category is absent', async () => {
      repo.findCategory.mockResolvedValue(null);
      const err = await service
        .updateCategory(actor, 999, { name: 'X' })
        .catch((e: unknown) => e);
      expect((err as DomainException).getStatus()).toBe(404);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('rejects a stale version (409)', async () => {
      const err = await service
        .updateCategory(actor, 10, { name: 'X', version: 99 })
        .catch((e: unknown) => e);
      expect((err as DomainException).getStatus()).toBe(409);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('rejects renaming onto an existing name (409)', async () => {
      repo.nameExists.mockResolvedValue(true);
      const err = await service
        .updateCategory(actor, 10, { name: 'Taken' })
        .catch((e: unknown) => e);
      expect((err as DomainException).getStatus()).toBe(409);
      expect(repo.nameExists).toHaveBeenCalledWith(1, 'Taken', 10);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('applies the change and returns the fresh count', async () => {
      repo.countEvents.mockResolvedValue(3);
      const res = await service.updateCategory(actor, 10, { color: 'red' });
      expect(repo.update).toHaveBeenCalled();
      expect(res).toMatchObject({ color: 'red', eventCount: 3 });
    });
  });

  describe('deleteCategory', () => {
    it('removes a category that no events use', async () => {
      repo.countEvents.mockResolvedValue(0);
      await service.deleteCategory(actor, 10);
      expect(repo.softDelete).toHaveBeenCalledWith(1, 10);
    });

    it('blocks deletion while events still use it (409 with the count)', async () => {
      repo.countEvents.mockResolvedValue(12);
      const err = await service
        .deleteCategory(actor, 10)
        .catch((e: unknown) => e);
      expect((err as DomainException).getStatus()).toBe(409);
      expect((err as DomainException).message).toMatch(/12 events/);
      expect(repo.softDelete).not.toHaveBeenCalled();
    });

    it('throws 404 when the category is absent', async () => {
      repo.findCategory.mockResolvedValue(null);
      const err = await service
        .deleteCategory(actor, 999)
        .catch((e: unknown) => e);
      expect((err as DomainException).getStatus()).toBe(404);
    });
  });
});
