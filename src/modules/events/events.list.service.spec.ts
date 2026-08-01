import { Paginated } from '../../common/http/paginated';
import type { OutboxPort } from '../platform/outbox.port';
import type { Clock } from '../../common/time/clock';
import { EventsRepository } from './events.repository';
import { EventsService } from './events.service';
import type { TicketAvailabilityPort } from './ports/ticket-availability.port';
import type { EventRow } from './events.types';

const actor = { organizationId: 1, userId: 'u1' };

function row(
  id: string,
  name: string,
  capacity: number | null = null,
): EventRow {
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
    capacity,
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

const NO_SALES = new Map<string, { sold: number; quantity: number }>();

describe('EventsService.list', () => {
  let repo: jest.Mocked<EventsRepository>;
  let tickets: jest.Mocked<TicketAvailabilityPort>;
  let service: EventsService;

  beforeEach(() => {
    repo = {
      list: jest
        .fn()
        .mockResolvedValue({ items: [row('e1', 'Alpha')], total: 1 }),
      listAll: jest.fn().mockResolvedValue([]),
      bucketCounts: jest.fn().mockResolvedValue({ active: 0, completed: 0 }),
    } as unknown as jest.Mocked<EventsRepository>;
    tickets = {
      salesByEvent: jest.fn().mockResolvedValue(NO_SALES),
    } as unknown as jest.Mocked<TicketAvailabilityPort>;
    service = new EventsService(repo, tickets, {} as OutboxPort, {} as Clock);
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

  it('enriches each row with registrations and fillPercent from ticket sales', async () => {
    repo.list.mockResolvedValue({
      items: [row('e1', 'Alpha', 100)],
      total: 1,
    });
    tickets.salesByEvent.mockResolvedValue(
      new Map([['e1', { sold: 45, quantity: 100 }]]),
    );

    const res = await service.list(actor, {});

    expect(tickets.salesByEvent).toHaveBeenCalledWith(1, ['e1']);
    expect(res.items[0]).toMatchObject({
      id: 'e1',
      registrations: 45,
      capacity: 100,
      fillPercent: 45,
    });
  });

  it('reports zero registrations and fill for an event with no sales', async () => {
    repo.list.mockResolvedValue({ items: [row('e1', 'Alpha', 100)], total: 1 });
    tickets.salesByEvent.mockResolvedValue(NO_SALES);

    const res = await service.list(actor, {});

    expect(res.items[0]).toMatchObject({ registrations: 0, fillPercent: 0 });
  });

  it('falls back to summed ticket quantity when the event has no capacity', async () => {
    repo.list.mockResolvedValue({
      items: [row('e1', 'Alpha', null)],
      total: 1,
    });
    tickets.salesByEvent.mockResolvedValue(
      new Map([['e1', { sold: 20, quantity: 40 }]]),
    );

    const res = await service.list(actor, {});

    // 20 / 40 → 50%
    expect(res.items[0]).toMatchObject({ registrations: 20, fillPercent: 50 });
  });

  describe('sort by registrations (cross-context, in-app global sort)', () => {
    const three = () => [
      row('e1', 'A', 100),
      row('e2', 'B', 100),
      row('e3', 'C', 100),
    ];
    const sales = () =>
      new Map([
        ['e1', { sold: 10, quantity: 100 }],
        ['e2', { sold: 50, quantity: 100 }],
        ['e3', { sold: 30, quantity: 100 }],
      ]);

    it('orders the full set by registrations desc and paginates the first page', async () => {
      repo.listAll.mockResolvedValue(three());
      tickets.salesByEvent.mockResolvedValue(sales());

      const res = await service.list(actor, {
        sort: 'registrations',
        page: 1,
        limit: 2,
      });

      expect(repo.listAll).toHaveBeenCalledWith(1, {});
      expect(repo.list).not.toHaveBeenCalled();
      expect(res.items.map((i) => i.id)).toEqual(['e2', 'e3']);
      expect(res.meta).toMatchObject({
        total: 3,
        page: 1,
        limit: 2,
        totalPages: 2,
      });
      expect(res.items[0]).toMatchObject({
        registrations: 50,
        fillPercent: 50,
      });
    });

    it('returns the tail on the second page', async () => {
      repo.listAll.mockResolvedValue(three());
      tickets.salesByEvent.mockResolvedValue(sales());

      const res = await service.list(actor, {
        sort: 'registrations',
        page: 2,
        limit: 2,
      });

      expect(res.items.map((i) => i.id)).toEqual(['e1']);
    });

    it('breaks ties by most-recent first (stable, no page skips)', async () => {
      const older = {
        ...row('old', 'Old', 100),
        createdAt: new Date('2026-01-01T00:00:00Z'),
      };
      const newer = {
        ...row('new', 'New', 100),
        createdAt: new Date('2026-06-01T00:00:00Z'),
      };
      repo.listAll.mockResolvedValue([older, newer]);
      tickets.salesByEvent.mockResolvedValue(
        new Map([
          ['old', { sold: 20, quantity: 100 }],
          ['new', { sold: 20, quantity: 100 }],
        ]),
      );

      const res = await service.list(actor, { sort: 'registrations' });

      expect(res.items.map((i) => i.id)).toEqual(['new', 'old']);
    });

    it('passes the search/type/bucket filters through to listAll', async () => {
      repo.listAll.mockResolvedValue([]);

      await service.list(actor, {
        sort: 'registrations',
        q: 'x',
        type: 'Workshop',
        bucket: 'completed',
      });

      expect(repo.listAll).toHaveBeenCalledWith(1, {
        q: 'x',
        type: 'Workshop',
        bucket: 'completed',
      });
    });
  });
});

describe('EventsService.summary', () => {
  it('returns the active and completed bucket counts', async () => {
    const repo = {
      bucketCounts: jest.fn().mockResolvedValue({ active: 12, completed: 4 }),
    } as unknown as jest.Mocked<EventsRepository>;
    const service = new EventsService(
      repo,
      {} as TicketAvailabilityPort,
      {} as OutboxPort,
      {} as Clock,
    );

    const res = await service.summary(actor);

    expect(repo.bucketCounts).toHaveBeenCalledWith(1);
    expect(res).toEqual({ active: 12, completed: 4 });
  });
});
