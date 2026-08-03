import { DomainException } from '../../common/errors/domain.exception';
import type { Clock } from '../../common/time/clock';
import { CheckoutPolicy } from './checkout.policy';
import { CheckoutViewService } from './checkout-view.service';
import type {
  CheckoutEvent,
  CheckoutSeat,
  CheckoutTier,
} from './checkout.types';
import type { CheckoutEventPort } from './ports/checkout-event.port';
import type { SeatMapPort } from './ports/seat-map.port';
import type { TicketCatalogPort } from './ports/ticket-catalog.port';

const NOW = new Date('2026-06-01T00:00:00Z');
const SLUG = 'bangkok-tech-week';
const EVENT_ID = 'e-1';
const ORG = 7;
const BAHT = 100;

function event(o: Partial<CheckoutEvent> = {}): CheckoutEvent {
  return {
    id: EVENT_ID,
    organizationId: ORG,
    slug: SLUG,
    name: 'Bangkok Tech Week',
    startAt: new Date('2026-07-01T02:00:00Z'),
    endAt: null,
    timezone: 'Asia/Bangkok',
    isOnline: false,
    onlineNote: null,
    venueName: 'QSNCC',
    venueAddress: '60 Queen Sirikit',
    city: 'Bangkok',
    coverImage: null,
    organizerName: 'Acme',
    seatingMode: 'ga',
    ...o,
  };
}

function tier(o: Partial<CheckoutTier> = {}): CheckoutTier {
  return {
    id: 'tt-1',
    name: 'General',
    priceSatang: 1_200 * BAHT,
    isFree: false,
    status: 'onsale',
    admissionType: 'general_admission',
    salesStartAt: null,
    salesEndAt: null,
    minPerOrder: 1,
    maxPerOrder: 8,
    sold: 0,
    total: 100,
    ...o,
  };
}

function seat(id: number, o: Partial<CheckoutSeat> = {}): CheckoutSeat {
  return {
    id,
    section: 'Stalls',
    rowLabel: 'A',
    seatNumber: String(id),
    ticketTypeId: 'tt-1',
    available: true,
    ...o,
  };
}

const message = (e: unknown) => (e as DomainException).message;

describe('CheckoutViewService (US-DISC-04)', () => {
  let events: jest.Mocked<CheckoutEventPort>;
  let catalog: jest.Mocked<TicketCatalogPort>;
  let seatMap: jest.Mocked<SeatMapPort>;
  let service: CheckoutViewService;

  beforeEach(() => {
    events = {
      findPublishedBySlug: jest.fn().mockResolvedValue(event()),
      findPublishedById: jest.fn().mockResolvedValue(event()),
    };
    catalog = {
      tiersForEvent: jest.fn().mockResolvedValue([tier()]),
      tierById: jest.fn().mockResolvedValue(tier()),
    };
    seatMap = { seatsForEvent: jest.fn().mockResolvedValue([]) };
    const clock: Clock = { now: () => NOW };
    service = new CheckoutViewService(
      events,
      catalog,
      seatMap,
      new CheckoutPolicy(),
      clock,
    );
  });

  describe('view', () => {
    it('opens with the event summary and its ticket types', async () => {
      const view = await service.view(SLUG);
      expect(view.event).toMatchObject({
        slug: SLUG,
        name: 'Bangkok Tech Week',
        venueName: 'QSNCC',
        seatingMode: 'ga',
      });
      expect(view.tiers).toHaveLength(1);
      expect(view.tiers[0]).toMatchObject({
        name: 'General',
        priceLabel: '฿1,200',
        priceSatang: 1_200 * BAHT,
        canSelect: true,
      });
    });

    it('is not available for an event that was never published', async () => {
      events.findPublishedBySlug.mockResolvedValue(null);
      const err = await service.view(SLUG).catch((e: unknown) => e);
      expect((err as DomainException).getStatus()).toBe(404);
    });

    it('refuses to open once the event has begun', async () => {
      events.findPublishedBySlug.mockResolvedValue(
        event({ startAt: new Date('2026-05-31T00:00:00Z') }),
      );
      const err = await service.view(SLUG).catch((e: unknown) => e);
      expect((err as DomainException).getStatus()).toBe(409);
      expect(message(err)).toMatch(/closed/i);
    });

    it('says Free rather than ฿0 for a free tier', async () => {
      catalog.tiersForEvent.mockResolvedValue([
        tier({ priceSatang: 0, isFree: true }),
      ]);
      expect((await service.view(SLUG)).tiers[0].priceLabel).toBe('Free');
    });

    it('skips the payment step when every tier on offer is free', async () => {
      catalog.tiersForEvent.mockResolvedValue([
        tier({ priceSatang: 0, isFree: true }),
      ]);
      expect((await service.view(SLUG)).paymentRequired).toBe(false);
    });

    it('still needs payment when one selectable tier costs money', async () => {
      catalog.tiersForEvent.mockResolvedValue([
        tier({ id: 'a', priceSatang: 0, isFree: true }),
        tier({ id: 'b' }),
      ]);
      expect((await service.view(SLUG)).paymentRequired).toBe(true);
    });

    it('shows a sold-out tier but does not let it be chosen', async () => {
      catalog.tiersForEvent.mockResolvedValue([tier({ status: 'soldout' })]);
      const view = await service.view(SLUG);
      expect(view.tiers).toHaveLength(1);
      expect(view.tiers[0].canSelect).toBe(false);
    });

    it('reports what is left of a bounded tier, and nothing for an unlimited one', async () => {
      catalog.tiersForEvent.mockResolvedValue([
        tier({ id: 'a', sold: 90, total: 100 }),
        tier({ id: 'b', sold: 500, total: 0 }),
      ]);
      const view = await service.view(SLUG);
      expect(view.tiers[0].remaining).toBe(10);
      expect(view.tiers[1].remaining).toBeNull();
    });

    it('tells a general-admission buyer that seating is first-come', async () => {
      const view = await service.view(SLUG);
      expect(view.notes.seating).toMatch(/first[- ]come/i);
      expect(view.seatMap).toBeNull();
      expect(seatMap.seatsForEvent).not.toHaveBeenCalled();
    });

    it('promises an online buyer a join link by email', async () => {
      events.findPublishedBySlug.mockResolvedValue(
        event({ isOnline: true, venueName: null, city: null }),
      );
      const view = await service.view(SLUG);
      expect(view.notes.delivery).toMatch(/join link/i);
    });

    it('draws the seat map for a reserved-seating event', async () => {
      events.findPublishedBySlug.mockResolvedValue(
        event({ seatingMode: 'reserved' }),
      );
      seatMap.seatsForEvent.mockResolvedValue([
        seat(1),
        seat(2, { available: false }),
      ]);
      const view = await service.view(SLUG);
      expect(view.seatMap?.seats).toHaveLength(2);
      // A taken seat is still drawn — greyed out, not missing from the row.
      expect(view.seatMap?.seats[1]).toMatchObject({ id: 2, available: false });
      expect(seatMap.seatsForEvent).toHaveBeenCalledWith(
        ORG,
        EVENT_ID,
        NOW,
        undefined,
      );
    });

    it('counts a buyer’s own reservation as still available to them', async () => {
      events.findPublishedBySlug.mockResolvedValue(
        event({ seatingMode: 'reserved' }),
      );
      await service.seatsFor(event({ seatingMode: 'reserved' }), [21, 22]);
      expect(seatMap.seatsForEvent).toHaveBeenCalledWith(
        ORG,
        EVENT_ID,
        NOW,
        [21, 22],
      );
    });

    it('caps a booking at 8 wherever the client renders it', async () => {
      expect((await service.view(SLUG)).maxPerBooking).toBe(8);
    });
  });

  describe('load — the context every checkout action starts from', () => {
    it('resolves the tenant from the event, never from the caller', async () => {
      const context = await service.load(EVENT_ID);
      expect(context.event.organizationId).toBe(ORG);
      expect(events.findPublishedById).toHaveBeenCalledWith(EVENT_ID);
    });

    it('is not available for an event that was never published', async () => {
      events.findPublishedById.mockResolvedValue(null);
      const err = await service.load(EVENT_ID).catch((e: unknown) => e);
      expect((err as DomainException).getStatus()).toBe(404);
    });

    it('refuses once the event has begun', async () => {
      events.findPublishedById.mockResolvedValue(
        event({ startAt: new Date('2026-05-31T00:00:00Z') }),
      );
      const err = await service.load(EVENT_ID).catch((e: unknown) => e);
      expect((err as DomainException).getStatus()).toBe(409);
    });
  });

  describe('requireTier', () => {
    it('returns the tier priced by the catalog, not by the client', async () => {
      const t = await service.requireTier(ORG, EVENT_ID, 'tt-1');
      expect(t.priceSatang).toBe(1_200 * BAHT);
      expect(catalog.tierById).toHaveBeenCalledWith(ORG, EVENT_ID, 'tt-1');
    });

    it('404s for a ticket type that is not on this event', async () => {
      catalog.tierById.mockResolvedValue(null);
      const err = await service
        .requireTier(ORG, EVENT_ID, 'nope')
        .catch((e: unknown) => e);
      expect((err as DomainException).getStatus()).toBe(404);
    });
  });
});
