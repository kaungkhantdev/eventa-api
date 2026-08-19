import type { Clock } from '../../common/time/clock';
import { DiscoverPolicy } from './discover.policy';
import type { DiscoverRepository } from './discover.repository';
import { DiscoverService } from './discover.service';
import type { DiscoverEventRow, TierInventory } from './discover.types';
import type { EventAttendancePort } from './ports/event-attendance.port';

const NOW = new Date('2026-06-01T00:00:00Z');
const BAHT = 100;

function eventRow(o: Partial<DiscoverEventRow> = {}): DiscoverEventRow {
  return {
    id: 'e1',
    slug: 'bangkok-tech-week',
    name: 'Bangkok Tech Week',
    description: 'Three days of builders.',
    type: 'Conference',
    categoryName: 'Technology',
    startAt: new Date('2026-07-01T02:00:00Z'),
    endAt: null,
    timezone: 'Asia/Bangkok',
    isOnline: false,
    venueName: 'QSNCC',
    city: 'Bangkok',
    coverImage: 'https://cdn.test/cover.jpg',
    organizerName: 'Eventa Co.',
    ...o,
  };
}

function tier(o: Partial<TierInventory> = {}): TierInventory {
  return {
    priceSatang: 1_200 * BAHT,
    isFree: false,
    status: 'onsale',
    sold: 0,
    total: 100,
    ...o,
  };
}

describe('DiscoverService (US-DISC-01, US-DISC-02)', () => {
  let repo: jest.Mocked<DiscoverRepository>;
  let attendance: jest.Mocked<EventAttendancePort>;
  let service: DiscoverService;

  beforeEach(() => {
    repo = {
      search: jest.fn().mockResolvedValue({ items: [eventRow()], total: 1 }),
      tiersByEvent: jest.fn().mockResolvedValue(new Map([['e1', [tier()]]])),
      categoryNames: jest.fn().mockResolvedValue(['Technology', 'Music']),
      findByIds: jest.fn().mockResolvedValue([eventRow()]),
    } as unknown as jest.Mocked<DiscoverRepository>;
    attendance = {
      goingCounts: jest.fn().mockResolvedValue(new Map([['e1', 128]])),
    };
    const clock: Clock = { now: () => NOW };
    service = new DiscoverService(
      repo,
      new DiscoverPolicy(),
      attendance,
      clock,
    );
  });

  it('shows the details a visitor scans a card for', async () => {
    const page = await service.browse({});
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      slug: 'bangkok-tech-week',
      name: 'Bangkok Tech Week',
      categoryName: 'Technology',
      city: 'Bangkok',
      venueName: 'QSNCC',
      organizerName: 'Eventa Co.',
      coverImage: 'https://cdn.test/cover.jpg',
      goingCount: 128,
      priceFrom: '฿1,200',
    });
    expect(page.items[0].startAt).toBe('2026-07-01T02:00:00.000Z');
  });

  it('counts nobody going for an event with no registrations yet', async () => {
    attendance.goingCounts.mockResolvedValue(new Map());
    const page = await service.browse({});
    expect(page.items[0].goingCount).toBe(0);
  });

  it('badges a sold-out event Waitlist and quotes no price', async () => {
    repo.tiersByEvent.mockResolvedValue(
      new Map([['e1', [tier({ sold: 100, total: 100 })]]]),
    );
    const page = await service.browse({});
    expect(page.items[0].badge).toBe('waitlist');
    expect(page.items[0].priceFrom).toBeNull();
  });

  it('badges a nearly-full event Selling fast', async () => {
    repo.tiersByEvent.mockResolvedValue(
      new Map([['e1', [tier({ sold: 95, total: 100 })]]]),
    );
    expect((await service.browse({})).items[0].badge).toBe('selling_fast');
  });

  it('leaves an event with no ticket types unbadged and unpriced', async () => {
    repo.tiersByEvent.mockResolvedValue(new Map());
    const page = await service.browse({});
    expect(page.items[0].badge).toBeNull();
    expect(page.items[0].priceFrom).toBeNull();
  });

  it('shows Free rather than a price for a free event', async () => {
    repo.tiersByEvent.mockResolvedValue(
      new Map([['e1', [tier({ priceSatang: 0, isFree: true })]]]),
    );
    expect((await service.browse({})).items[0].priceFrom).toBe('Free');
  });

  it('carries no rating until attendees have reviewed the event', async () => {
    expect((await service.browse({})).items[0].rating).toBeNull();
  });

  it('returns an empty page rather than an error when nothing matches', async () => {
    repo.search.mockResolvedValue({ items: [], total: 0 });
    const page = await service.browse({ q: 'nothing at all' });
    expect(page.items).toEqual([]);
    expect(page.meta.total).toBe(0);
    // Nothing to decorate — don't go asking other contexts about an empty list.
    expect(attendance.goingCounts).not.toHaveBeenCalled();
    expect(repo.tiersByEvent).not.toHaveBeenCalled();
  });

  it('ignores stray spaces around a search term', async () => {
    await service.browse({ q: '  tech week  ' });
    expect(repo.search).toHaveBeenCalledWith(
      expect.objectContaining({ search: 'tech week' }),
      NOW,
    );
  });

  it('treats a blank search as no search at all', async () => {
    await service.browse({ q: '   ' });
    expect(repo.search).toHaveBeenCalledWith(
      expect.objectContaining({ search: undefined }),
      NOW,
    );
  });

  it('narrows to one category when the visitor picks one', async () => {
    await service.browse({ category: ' Technology ' });
    expect(repo.search).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'Technology' }),
      NOW,
    );
  });

  it('applies a keyword and a category together', async () => {
    await service.browse({ q: 'summit', category: 'Music' });
    expect(repo.search).toHaveBeenCalledWith(
      expect.objectContaining({ search: 'summit', category: 'Music' }),
      NOW,
    );
  });

  it('excludes events that have already started by asking as of now', async () => {
    await service.browse({});
    expect(repo.search).toHaveBeenCalledWith(expect.anything(), NOW);
  });

  it('pages from the top by default', async () => {
    await service.browse({});
    expect(repo.search).toHaveBeenCalledWith(
      expect.objectContaining({ offset: 0, limit: 12 }),
      NOW,
    );
  });

  it('offsets by whole pages', async () => {
    await service.browse({ page: 3, limit: 10 });
    expect(repo.search).toHaveBeenCalledWith(
      expect.objectContaining({ offset: 20, limit: 10 }),
      NOW,
    );
  });

  it('caps an outsized page size so one visitor cannot ask for everything', async () => {
    await service.browse({ limit: 5_000 });
    expect(repo.search).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 48 }),
      NOW,
    );
  });

  it('treats a nonsense page number as the first page', async () => {
    await service.browse({ page: 0 });
    expect(repo.search).toHaveBeenCalledWith(
      expect.objectContaining({ offset: 0 }),
      NOW,
    );
  });

  it('offers the categories that published events actually use', async () => {
    expect(await service.categories()).toEqual(['Technology', 'Music']);
    expect(repo.categoryNames).toHaveBeenCalledWith(NOW);
  });

  // The same card, addressed by id — how a saved list (US-DISC-03) renders.
  describe('cardsByIds', () => {
    it('builds the same decorated card the grid shows', async () => {
      const [card] = await service.cardsByIds(['e1']);
      expect(card).toMatchObject({ id: 'e1', goingCount: 128, badge: null });
    });

    it('answers in the order asked, not the order stored', async () => {
      repo.findByIds.mockResolvedValue([
        eventRow({ id: 'e2' }),
        eventRow({ id: 'e1' }),
      ]);
      repo.tiersByEvent.mockResolvedValue(new Map());
      const cards = await service.cardsByIds(['e1', 'e2']);
      expect(cards.map((c) => c.id)).toEqual(['e1', 'e2']);
    });

    it('drops an id that is no longer publicly visible', async () => {
      repo.findByIds.mockResolvedValue([]);
      expect(await service.cardsByIds(['gone'])).toEqual([]);
    });

    it('asks nothing at all for an empty list of ids', async () => {
      expect(await service.cardsByIds([])).toEqual([]);
      expect(repo.findByIds).not.toHaveBeenCalled();
    });
  });
});
