import { Paginated } from '../../common/http/paginated';
import type { OutboxPort } from '../platform/outbox.port';
import type { Clock } from '../../common/time/clock';
import { EventsRepository } from './events.repository';
import { EventsQueryService } from './events-query.service';
import type { TicketAvailabilityPort } from './ports/ticket-availability.port';
import type { EventRow } from './events.types';

const auth = { organizationId: 1, userId: 'u1' };
const NOW = new Date('2026-07-29T00:00:00Z');

/** Collaborators the publish/unpublish paths need, with sensible test defaults. */
function makeDeps() {
  return {
    tickets: {
      activeCount: jest.fn().mockResolvedValue(1),
      totalQuantity: jest.fn().mockResolvedValue(0),
      soldCount: jest.fn().mockResolvedValue(0),
      salesByEvent: jest.fn().mockResolvedValue(new Map()),
    } as unknown as jest.Mocked<TicketAvailabilityPort>,
    outbox: {
      enqueue: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<OutboxPort>,
    clock: {
      now: jest.fn().mockReturnValue(NOW),
    } as unknown as jest.Mocked<Clock>,
  };
}

function eventRow(overrides: Partial<EventRow> = {}): EventRow {
  return {
    id: 'e1',
    organizationId: 1,
    slug: 'tech-conf',
    name: 'Tech Conf',
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
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    createdBy: 'u1',
    version: 1,
    ...overrides,
  };
}

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

describe('EventsQueryService.list', () => {
  let repo: jest.Mocked<EventsRepository>;
  let tickets: jest.Mocked<TicketAvailabilityPort>;
  let service: EventsQueryService;

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
    service = new EventsQueryService(repo, tickets, {} as Clock);
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

describe('EventsQueryService.summary', () => {
  it('returns the active and completed bucket counts', async () => {
    const repo = {
      bucketCounts: jest.fn().mockResolvedValue({ active: 12, completed: 4 }),
    } as unknown as jest.Mocked<EventsRepository>;
    const service = new EventsQueryService(
      repo,
      {} as TicketAvailabilityPort,
      {} as Clock,
    );

    const res = await service.summary(actor);

    expect(repo.bucketCounts).toHaveBeenCalledWith(1);
    expect(res).toEqual({ active: 12, completed: 4 });
  });
});

describe('EventsQueryService calendar/upcoming', () => {
  let repo: jest.Mocked<EventsRepository>;
  let deps: ReturnType<typeof makeDeps>;
  let service: EventsQueryService;

  beforeEach(() => {
    repo = {
      listInRange: jest.fn().mockResolvedValue([]),
      listUpcoming: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<EventsRepository>;
    deps = makeDeps();
    service = new EventsQueryService(repo, deps.tickets, deps.clock);
  });

  describe('calendar', () => {
    it('queries the given month using Bangkok-time boundaries', async () => {
      repo.listInRange.mockResolvedValue([
        eventRow({ id: 'a' }),
        eventRow({ id: 'b' }),
      ]);
      const res = await service.calendar(auth, '2026-09');
      const [org, start, end] = repo.listInRange.mock.calls[0];
      expect(org).toBe(1);
      // Bangkok is UTC+7: Sep 1 00:00 +07 == Aug 31 17:00 UTC.
      expect(start.toISOString()).toBe('2026-08-31T17:00:00.000Z');
      expect(end.toISOString()).toBe('2026-09-30T17:00:00.000Z');
      expect(res).toMatchObject({ month: '2026-09', count: 2 });
      expect(res.events).toHaveLength(2);
    });

    it('defaults to the current Bangkok month when none is given', async () => {
      const res = await service.calendar(auth); // NOW = 2026-07-29
      expect(res.month).toBe('2026-07');
      const [, start, end] = repo.listInRange.mock.calls[0];
      expect(start.toISOString()).toBe('2026-06-30T17:00:00.000Z');
      expect(end.toISOString()).toBe('2026-07-31T17:00:00.000Z');
    });
  });

  describe('upcoming', () => {
    it('reports days-left (Bangkok) and fill from ticket sales', async () => {
      repo.listUpcoming.mockResolvedValue([
        eventRow({
          id: 'e1',
          startAt: new Date('2026-07-31T02:00:00Z'),
          capacity: 100,
        }),
      ]);
      deps.tickets.salesByEvent.mockResolvedValue(
        new Map([['e1', { sold: 10, quantity: 200 }]]),
      );
      const [row] = await service.upcoming(auth, 20);
      expect(row).toMatchObject({
        id: 'e1',
        daysLeft: 2, // Jul 29 → Jul 31 in Bangkok
        sold: 10,
        capacity: 100,
        fillPercent: 10,
      });
    });

    it('falls back to total ticket quantity when the event has no capacity', async () => {
      repo.listUpcoming.mockResolvedValue([
        eventRow({
          id: 'e2',
          startAt: new Date('2026-08-01T02:00:00Z'),
          capacity: null,
        }),
      ]);
      deps.tickets.salesByEvent.mockResolvedValue(
        new Map([['e2', { sold: 10, quantity: 200 }]]),
      );
      const [row] = await service.upcoming(auth, 20);
      expect(row).toMatchObject({ capacity: 200, sold: 10, fillPercent: 5 });
    });
  });
});
