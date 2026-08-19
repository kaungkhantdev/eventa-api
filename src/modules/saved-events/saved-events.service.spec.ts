import { DomainException } from '../../common/errors/domain.exception';
import type { DiscoverService } from '../discover/discover.service';
import type { EventCardDto } from '../discover/dto/event-card.dto';
import { SavedEventsService } from './saved-events.service';
import type { SavedEventsRepository } from './saved-events.repository';

const USER = 'u-1';
const EVENT = 'e-1';
const OTHER = 'e-2';

function card(id: string): EventCardDto {
  return {
    id,
    slug: `slug-${id}`,
    name: `Event ${id}`,
    type: 'Conference',
    categoryName: null,
    startAt: '2026-07-01T02:00:00.000Z',
    endAt: null,
    timezone: 'Asia/Bangkok',
    isOnline: false,
    venueName: null,
    city: null,
    coverImage: null,
    organizerName: 'Acme',
    goingCount: 0,
    priceFrom: null,
    badge: null,
    rating: null,
  };
}

const message = (e: unknown) => (e as DomainException).message;

describe('SavedEventsService (US-DISC-03)', () => {
  let repo: jest.Mocked<SavedEventsRepository>;
  let discover: jest.Mocked<DiscoverService>;
  let service: SavedEventsService;

  beforeEach(() => {
    repo = {
      save: jest.fn().mockResolvedValue(undefined),
      unsave: jest.fn().mockResolvedValue(undefined),
      saveMany: jest.fn().mockResolvedValue(2),
      listEventIds: jest.fn().mockResolvedValue({ ids: [EVENT], total: 1 }),
    } as unknown as jest.Mocked<SavedEventsRepository>;
    discover = {
      cardsByIds: jest.fn().mockResolvedValue([card(EVENT)]),
    } as unknown as jest.Mocked<DiscoverService>;
    service = new SavedEventsService(repo, discover);
  });

  describe('save', () => {
    it('records the save so it is still there on the next visit', async () => {
      await service.save(USER, EVENT);
      expect(repo.save).toHaveBeenCalledWith(USER, EVENT);
    });

    it('accepts the same save twice without complaining', async () => {
      await service.save(USER, EVENT);
      await expect(service.save(USER, EVENT)).resolves.not.toThrow();
    });

    it('refuses to save an event the visitor could never have seen', async () => {
      discover.cardsByIds.mockResolvedValue([]);
      const err = await service.save(USER, EVENT).catch((e: unknown) => e);
      expect((err as DomainException).getStatus()).toBe(404);
      expect(message(err)).toMatch(/isn't available/i);
      expect(repo.save).not.toHaveBeenCalled();
    });
  });

  describe('unsave', () => {
    it('removes the save', async () => {
      await service.unsave(USER, EVENT);
      expect(repo.unsave).toHaveBeenCalledWith(USER, EVENT);
    });

    it('shrugs off unsaving something that was never saved', async () => {
      await expect(service.unsave(USER, 'never-saved')).resolves.not.toThrow();
    });
  });

  describe('merge (guest saves adopted at sign-in)', () => {
    it('adopts the in-session saves into the account', async () => {
      discover.cardsByIds.mockResolvedValue([card(EVENT), card(OTHER)]);
      const res = await service.merge(USER, [EVENT, OTHER]);
      expect(repo.saveMany).toHaveBeenCalledWith(USER, [EVENT, OTHER]);
      expect(res.merged).toBe(2);
    });

    it('merges nothing when the guest saved nothing', async () => {
      const res = await service.merge(USER, []);
      expect(res.merged).toBe(0);
      expect(repo.saveMany).not.toHaveBeenCalled();
      expect(discover.cardsByIds).not.toHaveBeenCalled();
    });

    it('quietly drops ids that are no longer public rather than failing', async () => {
      discover.cardsByIds.mockResolvedValue([card(EVENT)]);
      await service.merge(USER, [EVENT, 'gone']);
      expect(repo.saveMany).toHaveBeenCalledWith(USER, [EVENT]);
    });

    it('collapses a repeated id so a merge never duplicates', async () => {
      discover.cardsByIds.mockResolvedValue([card(EVENT)]);
      await service.merge(USER, [EVENT, EVENT, EVENT]);
      expect(repo.saveMany).toHaveBeenCalledWith(USER, [EVENT]);
    });

    it('does not touch the account when none of the ids are real', async () => {
      discover.cardsByIds.mockResolvedValue([]);
      const res = await service.merge(USER, ['gone', 'also-gone']);
      expect(res.merged).toBe(0);
      expect(repo.saveMany).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('shows the saved events as full cards', async () => {
      const page = await service.list(USER, {});
      expect(page.items).toHaveLength(1);
      expect(page.items[0].id).toBe(EVENT);
      expect(page.meta.total).toBe(1);
    });

    it('keeps the order the repository saved them in', async () => {
      repo.listEventIds.mockResolvedValue({ ids: [OTHER, EVENT], total: 2 });
      discover.cardsByIds.mockResolvedValue([card(OTHER), card(EVENT)]);
      const page = await service.list(USER, {});
      expect(page.items.map((c) => c.id)).toEqual([OTHER, EVENT]);
      expect(discover.cardsByIds).toHaveBeenCalledWith([OTHER, EVENT]);
    });

    it('drops a saved event the organizer has since taken down', async () => {
      repo.listEventIds.mockResolvedValue({ ids: [EVENT, 'gone'], total: 2 });
      discover.cardsByIds.mockResolvedValue([card(EVENT)]);
      const page = await service.list(USER, {});
      expect(page.items.map((c) => c.id)).toEqual([EVENT]);
    });

    it('returns an empty page for an attendee who has saved nothing', async () => {
      repo.listEventIds.mockResolvedValue({ ids: [], total: 0 });
      const page = await service.list(USER, {});
      expect(page.items).toEqual([]);
      expect(page.meta.total).toBe(0);
      expect(discover.cardsByIds).not.toHaveBeenCalled();
    });

    it('pages from the top by default', async () => {
      await service.list(USER, {});
      expect(repo.listEventIds).toHaveBeenCalledWith(USER, {
        limit: 12,
        offset: 0,
      });
    });

    it('offsets by whole pages and caps an outsized page size', async () => {
      await service.list(USER, { page: 3, limit: 5_000 });
      expect(repo.listEventIds).toHaveBeenCalledWith(USER, {
        limit: 48,
        offset: 96,
      });
    });
  });
});
