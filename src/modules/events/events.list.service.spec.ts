import { Paginated } from '../../common/http/paginated';
import { EventsRepository } from './events.repository';
import { EventsService } from './events.service';
import type { EventRow } from './events.types';

const actor = { organizationId: 1, userId: 'u1' };

function row(id: string, name: string): EventRow {
  return {
    id,
    organizationId: 1,
    slug: name.toLowerCase(),
    name,
    description: null,
    type: 'Conference',
    status: 'draft',
    bucket: 'active',
    visibility: 'private',
    categoryId: null,
    startAt: new Date('2026-09-01T02:00:00Z'),
    endAt: null,
    timezone: 'Asia/Bangkok',
    venueName: null,
    venueAddress: null,
    city: null,
    isOnline: false,
    onlineNote: null,
    seatingMode: 'ga',
    capacity: null,
    coverImage: null,
    accentColor: null,
    organizerName: 'Acme',
    contactEmail: null,
    landingTemplateId: null,
    publishedAt: null,
    cancelledAt: null,
    createdAt: new Date('2026-07-01T00:00:00Z'),
    updatedAt: new Date('2026-07-01T00:00:00Z'),
    deletedAt: null,
    createdBy: 'u1',
    version: 1,
  };
}

describe('EventsService.list', () => {
  let repo: jest.Mocked<EventsRepository>;
  let service: EventsService;

  beforeEach(() => {
    repo = {
      list: jest
        .fn()
        .mockResolvedValue({ items: [row('e1', 'Alpha')], total: 1 }),
    } as unknown as jest.Mocked<EventsRepository>;
    service = new EventsService(repo);
  });

  it('defaults to page 1, limit 20, sort "recent" and returns a mapped Paginated', async () => {
    const res = await service.list(actor, {});

    expect(res).toBeInstanceOf(Paginated);
    expect(repo.list).toHaveBeenCalledWith(1, {
      limit: 20,
      offset: 0,
      sort: 'recent',
    });
    expect(res.meta).toMatchObject({
      page: 1,
      limit: 20,
      total: 1,
      totalPages: 1,
    });
    expect(res.items[0]).toMatchObject({
      id: 'e1',
      name: 'Alpha',
      slug: 'alpha',
    });
  });

  it('translates page/limit into limit/offset and clamps limit to 100', async () => {
    await service.list(actor, { page: 3, limit: 500 });
    expect(repo.list).toHaveBeenCalledWith(1, {
      limit: 100,
      offset: 200,
      sort: 'recent',
    });
  });

  it('floors page at 1', async () => {
    await service.list(actor, { page: 0 });
    expect(repo.list).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ offset: 0 }),
    );
  });

  it('passes through search, type and bucket filters', async () => {
    await service.list(actor, {
      q: 'summit',
      type: 'Workshop',
      bucket: 'completed',
      sort: 'name',
    });
    expect(repo.list).toHaveBeenCalledWith(1, {
      limit: 20,
      offset: 0,
      sort: 'name',
      q: 'summit',
      type: 'Workshop',
      bucket: 'completed',
    });
  });
});
