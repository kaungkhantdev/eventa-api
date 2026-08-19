import { Paginated } from '../../common/http/paginated';
import type { EventLookupPort } from './ports/event-lookup.port';
import { TicketingQueryService } from './ticketing-query.service';
import type { TicketingRepository } from './ticketing.repository';
import type { TicketRow } from './ticketing.types';

const actor = { organizationId: 1, userId: 'u1' };

function row(o: Partial<TicketRow> = {}): TicketRow {
  return {
    id: 't1',
    organizationId: 1,
    eventId: 'e1',
    name: 'General',
    isFree: false,
    priceSatang: 50000,
    currency: 'THB',
    status: 'onsale',
    admissionType: 'general_admission',
    sold: 10,
    total: 100,
    salesStartAt: null,
    salesEndAt: null,
    minPerOrder: 1,
    maxPerOrder: 8,
    iconClass: null,
    includes: null,
    isRecommended: false,
    badge: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    version: 1,
    ...o,
  };
}

describe('TicketingQueryService (US-TKT-04)', () => {
  let repo: jest.Mocked<TicketingRepository>;
  let events: jest.Mocked<EventLookupPort>;
  let service: TicketingQueryService;

  beforeEach(() => {
    repo = {
      search: jest.fn().mockResolvedValue({ items: [row()], total: 1 }),
      countsByStatus: jest
        .fn()
        .mockResolvedValue({ onsale: 3, scheduled: 1, paused: 0, soldout: 2 }),
      orgVatRate: jest.fn().mockResolvedValue(0.07),
    } as unknown as jest.Mocked<TicketingRepository>;
    events = {
      briefsByIds: jest
        .fn()
        .mockResolvedValue(new Map([['e1', { id: 'e1', name: 'Jazz Fest' }]])),
      idsMatchingName: jest.fn().mockResolvedValue([]),
    };
    service = new TicketingQueryService(repo, events);
  });

  it('returns a page carrying sales progress, status and the event name', async () => {
    const page = await service.list(actor, {});
    expect(page).toBeInstanceOf(Paginated);
    expect(page.items[0]).toMatchObject({
      name: 'General',
      eventName: 'Jazz Fest',
      sold: 10,
      total: 100,
      status: 'onsale',
    });
  });

  it('reports the tab counts alongside the page', async () => {
    const counts = await service.statusCounts(actor);
    expect(counts).toEqual({ onsale: 3, scheduled: 1, paused: 0, soldout: 2 });
  });

  it('filters by status', async () => {
    await service.list(actor, { status: 'soldout' });
    expect(repo.search.mock.calls[0][1]).toMatchObject({ status: 'soldout' });
  });

  it('searches tier names AND the events they belong to', async () => {
    events.idsMatchingName.mockResolvedValue(['e7', 'e9']);
    await service.list(actor, { search: 'jazz' });
    expect(events.idsMatchingName).toHaveBeenCalledWith(1, 'jazz');
    expect(repo.search.mock.calls[0][1]).toMatchObject({
      search: 'jazz',
      eventIds: ['e7', 'e9'],
    });
  });

  it('does not ask Events for matches when there is no search term', async () => {
    await service.list(actor, {});
    expect(events.idsMatchingName).not.toHaveBeenCalled();
  });

  it('returns an empty page when nothing matches', async () => {
    repo.search.mockResolvedValue({ items: [], total: 0 });
    const page = await service.list(actor, { search: 'nothing' });
    expect(page.items).toEqual([]);
    expect(page.meta.total).toBe(0);
  });

  it('labels a tier whose event vanished rather than dropping it', async () => {
    events.briefsByIds.mockResolvedValue(new Map());
    const page = await service.list(actor, {});
    expect(page.items[0].eventName).toBe('');
  });
});
