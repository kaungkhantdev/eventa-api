import { DomainException } from '../../common/errors/domain.exception';
import type { DiscountRedemptionService } from '../discounts/discount-redemption.service';
import type { SeatHoldService } from '../registration/seat-hold.service';
import { CheckoutPolicy } from './checkout.policy';
import type { CheckoutRepository } from './checkout.repository';
import { CheckoutService } from './checkout.service';
import type { CheckoutViewService } from './checkout-view.service';
import type {
  CheckoutEvent,
  CheckoutSeat,
  CheckoutTier,
} from './checkout.types';

const EVENT_ID = 'e-1';
const ORG = 7;
const TIER_ID = 'tt-1';
const BAHT = 100;

function event(o: Partial<CheckoutEvent> = {}): CheckoutEvent {
  return {
    id: EVENT_ID,
    organizationId: ORG,
    slug: 'bangkok-tech-week',
    name: 'Bangkok Tech Week',
    startAt: new Date('2026-07-01T02:00:00Z'),
    endAt: null,
    timezone: 'Asia/Bangkok',
    isOnline: false,
    onlineNote: null,
    venueName: 'QSNCC',
    venueAddress: null,
    city: 'Bangkok',
    coverImage: null,
    organizerName: 'Acme',
    seatingMode: 'ga',
    ...o,
  };
}

function tier(o: Partial<CheckoutTier> = {}): CheckoutTier {
  return {
    id: TIER_ID,
    name: 'General',
    priceSatang: 1_000 * BAHT,
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
    ticketTypeId: TIER_ID,
    available: true,
    ...o,
  };
}

const message = (e: unknown) => (e as DomainException).message;

describe('CheckoutService (US-DISC-04)', () => {
  let view: jest.Mocked<CheckoutViewService>;
  let discounts: jest.Mocked<DiscountRedemptionService>;
  let holds: jest.Mocked<SeatHoldService>;
  let repo: jest.Mocked<CheckoutRepository>;
  let service: CheckoutService;

  beforeEach(() => {
    view = {
      load: jest.fn().mockResolvedValue({ event: event() }),
      requireTier: jest.fn().mockResolvedValue(tier()),
      seatsFor: jest.fn().mockResolvedValue([seat(1), seat(2), seat(3)]),
    } as unknown as jest.Mocked<CheckoutViewService>;
    discounts = {
      quote: jest.fn().mockResolvedValue({ discountSatang: 0, code: 'X' }),
    } as unknown as jest.Mocked<DiscountRedemptionService>;
    holds = {
      holdQuantity: jest.fn().mockResolvedValue({
        id: 11,
        expiresAt: new Date('2026-06-01T00:10:00Z'),
      }),
      holdSeats: jest.fn().mockResolvedValue([
        { id: 21, expiresAt: new Date('2026-06-01T00:10:00Z') },
        { id: 22, expiresAt: new Date('2026-06-01T00:10:00Z') },
      ]),
      release: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<SeatHoldService>;
    repo = {
      orgRates: jest
        .fn()
        .mockResolvedValue({ vatRate: 0.07, serviceFeeRate: 0.05 }),
    } as unknown as jest.Mocked<CheckoutRepository>;
    service = new CheckoutService(
      view,
      new CheckoutPolicy(),
      discounts,
      holds,
      repo,
    );
  });

  const quote = (o: Record<string, unknown> = {}) =>
    service.quote({
      eventId: EVENT_ID,
      ticketTypeId: TIER_ID,
      quantity: 2,
      ...o,
    });

  describe('quote — the live order summary', () => {
    it('prices the selection at the tier’s own price, times the quantity', async () => {
      const summary = await quote();
      expect(summary.quantity).toBe(2);
      expect(summary.unitPriceSatang).toBe(1_000 * BAHT);
      expect(summary.subtotalSatang).toBe(2_000 * BAHT);
      expect(summary.serviceFeeSatang).toBe(100 * BAHT);
      expect(summary.totalSatang).toBe(2_100 * BAHT);
    });

    it('never prices from a figure the client sent', async () => {
      await quote({ unitPriceSatang: 1, subtotalSatang: 1 });
      expect(view.requireTier).toHaveBeenCalledWith(ORG, EVENT_ID, TIER_ID);
    });

    it('shows the amounts formatted the way the summary reads them', async () => {
      const summary = await quote();
      expect(summary.labels).toMatchObject({
        subtotal: '฿2,000',
        serviceFee: '฿100',
        total: '฿2,100',
      });
    });

    it('resolves the workspace from the event, never from the caller', async () => {
      await quote();
      expect(view.load).toHaveBeenCalledWith(EVENT_ID);
      expect(repo.orgRates).toHaveBeenCalledWith(ORG);
    });

    it('applies a discount code and re-prices the fee on what is left', async () => {
      discounts.quote.mockResolvedValue({
        discountSatang: 500 * BAHT,
        code: 'PROMO42',
      } as never);
      const summary = await quote({ discountCode: 'promo42' });
      expect(summary.discountSatang).toBe(500 * BAHT);
      expect(summary.serviceFeeSatang).toBe(75 * BAHT); // 5% of ฿1,500
      expect(summary.totalSatang).toBe(1_575 * BAHT);
      expect(summary.discountCode).toBe('PROMO42');
    });

    it('asks Discounts about the code against this event and subtotal', async () => {
      await quote({ discountCode: 'promo42', buyerEmail: 'anan@x.test' });
      expect(discounts.quote).toHaveBeenCalledWith({
        code: 'promo42',
        eventId: EVENT_ID,
        subtotalSatang: 2_000 * BAHT,
        buyerEmail: 'anan@x.test',
      });
    });

    it('does not bother Discounts when no code was entered', async () => {
      await quote();
      expect(discounts.quote).not.toHaveBeenCalled();
      expect((await quote()).discountCode).toBeNull();
    });

    it('adds no fee and needs no payment for a free tier', async () => {
      view.requireTier.mockResolvedValue(
        tier({ priceSatang: 0, isFree: true }),
      );
      const summary = await quote();
      expect(summary.subtotalSatang).toBe(0);
      expect(summary.serviceFeeSatang).toBe(0);
      expect(summary.totalSatang).toBe(0);
      expect(summary.paymentRequired).toBe(false);
    });

    it('needs payment whenever there is anything to pay', async () => {
      expect((await quote()).paymentRequired).toBe(true);
    });

    it('refuses a quantity below the tier’s own minimum', async () => {
      view.requireTier.mockResolvedValue(tier({ minPerOrder: 4 }));
      const err = await quote({ quantity: 2 }).catch((e: unknown) => e);
      expect((err as DomainException).getStatus()).toBe(422);
      expect(message(err)).toMatch(/at least 4/i);
    });

    it('refuses a quantity above the tier’s own maximum', async () => {
      view.requireTier.mockResolvedValue(tier({ maxPerOrder: 2 }));
      expect(
        message(await quote({ quantity: 5 }).catch((e: unknown) => e)),
      ).toMatch(/at most 2/i);
    });

    it('refuses more than 8 whatever the tier allows', async () => {
      const err = await quote({ quantity: 9 }).catch((e: unknown) => e);
      expect(message(err)).toMatch(/1 and 8/);
    });

    it('refuses a quantity for a reserved-seating event', async () => {
      view.load.mockResolvedValue({
        event: event({ seatingMode: 'reserved' }),
      });
      expect(message(await quote().catch((e: unknown) => e))).toMatch(
        /pick.*seat/i,
      );
    });

    describe('reserved seating', () => {
      beforeEach(() => {
        view.load.mockResolvedValue({
          event: event({ seatingMode: 'reserved' }),
        });
      });

      it('prices one ticket per chosen seat', async () => {
        const summary = await quote({ quantity: undefined, seatIds: [1, 2] });
        expect(summary.quantity).toBe(2);
        expect(summary.seatIds).toEqual([1, 2]);
        expect(summary.subtotalSatang).toBe(2_000 * BAHT);
      });

      it('refuses a seat that is already taken', async () => {
        view.seatsFor.mockResolvedValue([
          seat(1),
          seat(2, { available: false }),
        ]);
        const err = await quote({
          quantity: undefined,
          seatIds: [1, 2],
        }).catch((e: unknown) => e);
        expect((err as DomainException).getStatus()).toBe(409);
        expect(message(err)).toMatch(/just taken/i);
      });

      it('refuses a seat belonging to a different ticket type', async () => {
        view.seatsFor.mockResolvedValue([
          seat(1),
          seat(2, { ticketTypeId: 'tt-other' }),
        ]);
        expect(
          message(
            await quote({ quantity: undefined, seatIds: [1, 2] }).catch(
              (e: unknown) => e,
            ),
          ),
        ).toMatch(/ticket type/i);
      });
    });
  });

  describe('hold — reserving inventory while the buyer pays', () => {
    it('holds a quantity against the tier for a general-admission event', async () => {
      const res = await service.hold({
        eventId: EVENT_ID,
        ticketTypeId: TIER_ID,
        quantity: 2,
      });
      expect(holds.holdQuantity).toHaveBeenCalledWith(
        { organizationId: ORG },
        { eventId: EVENT_ID, ticketTypeId: TIER_ID, quantity: 2 },
      );
      expect(res.holdIds).toEqual([11]);
      expect(res.expiresAt).toBe('2026-06-01T00:10:00.000Z');
    });

    it('holds the named seats for a reserved-seating event', async () => {
      view.load.mockResolvedValue({
        event: event({ seatingMode: 'reserved' }),
      });
      const res = await service.hold({
        eventId: EVENT_ID,
        ticketTypeId: TIER_ID,
        seatIds: [1, 2],
      });
      expect(holds.holdSeats).toHaveBeenCalledWith(
        { organizationId: ORG },
        { eventId: EVENT_ID, seatIds: [1, 2] },
      );
      expect(res.holdIds).toEqual([21, 22]);
    });

    it('lets the engine’s conflict reach the buyer unchanged', async () => {
      holds.holdQuantity.mockRejectedValue(
        DomainException.conflict('Only 1 left — please reduce your quantity.'),
      );
      const err = await service
        .hold({ eventId: EVENT_ID, ticketTypeId: TIER_ID, quantity: 2 })
        .catch((e: unknown) => e);
      expect((err as DomainException).getStatus()).toBe(409);
      expect(message(err)).toMatch(/only 1 left/i);
    });

    it('checks the seats belong to the tier before reserving them', async () => {
      view.load.mockResolvedValue({
        event: event({ seatingMode: 'reserved' }),
      });
      view.seatsFor.mockResolvedValue([
        seat(1),
        seat(2, { ticketTypeId: 'x' }),
      ]);
      await expect(
        service.hold({
          eventId: EVENT_ID,
          ticketTypeId: TIER_ID,
          seatIds: [1, 2],
        }),
      ).rejects.toBeInstanceOf(DomainException);
      expect(holds.holdSeats).not.toHaveBeenCalled();
    });
  });

  describe('release — the buyer walked away', () => {
    it('frees the inventory for the next person', async () => {
      await service.release({ eventId: EVENT_ID, holdIds: [11, 12] });
      expect(holds.release).toHaveBeenCalledWith(
        { organizationId: ORG },
        [11, 12],
      );
    });

    it('does nothing when there is nothing to release', async () => {
      await service.release({ eventId: EVENT_ID, holdIds: [] });
      expect(holds.release).not.toHaveBeenCalled();
    });
  });
});
