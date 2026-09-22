import type { ConfigService } from '@nestjs/config';
import type { Clock } from '../../common/time/clock';
import type { Env } from '../../config/env.validation';
import { CheckoutOrderService } from './checkout-order.service';
import type {
  CheckoutRepository,
  OrderRow,
  PlaceOrderInput,
} from './checkout.repository';
import type { CheckoutService, PricedSelection } from './checkout.service';
import type { ConfirmOrderDto } from './dto/confirm-order.dto';

const NOW = new Date('2026-08-01T03:00:00.000Z');
const BAHT = 100;
const HOLD_EXPIRY = new Date('2026-08-01T03:10:00.000Z');

const INPUT: ConfirmOrderDto = {
  eventId: 'e-1',
  ticketTypeId: 'tt-1',
  quantity: 1,
  holdIds: [11],
  buyer: { name: 'Anan', email: 'anan@example.test' },
  idempotencyKey: 'key-12345678',
};

function priced(o: {
  requiresApproval: boolean;
  totalSatang: number;
}): PricedSelection {
  return {
    event: {
      id: 'e-1',
      organizationId: 7,
      name: 'Bangkok Tech Week',
      isOnline: false,
      seatingMode: 'ga',
      requiresApproval: o.requiresApproval,
    },
    summary: {
      eventId: 'e-1',
      ticketTypeId: 'tt-1',
      ticketTypeName: 'General',
      quantity: 1,
      seatIds: null,
      unitPriceSatang: o.totalSatang,
      subtotalSatang: o.totalSatang,
      discountSatang: 0,
      serviceFeeSatang: 0,
      vatSatang: 0,
      totalSatang: o.totalSatang,
      paymentRequired: o.totalSatang > 0,
    },
    discountCodeId: null,
  } as unknown as PricedSelection;
}

function order(o: Partial<OrderRow> = {}): OrderRow {
  return {
    id: 'o-1',
    organizationId: 7,
    reference: 'ORD-AAAA1111',
    eventId: 'e-1',
    buyerName: 'Anan',
    buyerEmail: 'anan@example.test',
    buyerPhone: null,
    status: 'pending',
    paymentStatus: 'pending',
    seats: 1,
    subtotalSatang: 0,
    discountAmountSatang: 0,
    vatAmountSatang: 0,
    totalSatang: 0,
    currency: 'THB',
    requiresApproval: false,
    approvalRequestedAt: null,
    createdAt: NOW,
    ...o,
  } as OrderRow;
}

describe('CheckoutOrderService — require approval (US-REG-02)', () => {
  let checkout: jest.Mocked<CheckoutService>;
  let repo: jest.Mocked<CheckoutRepository>;
  let service: CheckoutOrderService;

  beforeEach(() => {
    checkout = {
      priceSelection: jest.fn(),
    } as unknown as jest.Mocked<CheckoutService>;
    repo = {
      placeOrder: jest.fn(),
      findGuestOrder: jest.fn(),
      holdExpiryForOrder: jest.fn().mockResolvedValue(HOLD_EXPIRY),
    } as unknown as jest.Mocked<CheckoutRepository>;
    const clock: Clock = { now: () => NOW };
    const config = {
      getOrThrow: () => 'https://web.test',
    } as unknown as ConfigService<Env, true>;
    service = new CheckoutOrderService(checkout, repo, clock, config);
  });

  const placed = (): PlaceOrderInput => repo.placeOrder.mock.calls[0][0];

  describe('placing', () => {
    it('places a free registration to wait for the organizer: no tickets, no confirmation', async () => {
      checkout.priceSelection.mockResolvedValue(
        priced({ requiresApproval: true, totalSatang: 0 }),
      );
      const waiting = order({
        requiresApproval: true,
        approvalRequestedAt: NOW,
      });
      repo.placeOrder.mockResolvedValue({
        order: waiting,
        tickets: [],
        replayed: false,
      });

      const res = await service.confirm(INPUT);

      expect(placed()).toMatchObject({
        issueTickets: false,
        requiresApproval: true,
        awaitsDecision: true,
        qrTokens: [],
      });
      expect(placed().buildEvent(waiting, [])).toBeNull();
      expect(res.awaitingApproval).toBe(true);
      expect(res.paymentRequired).toBe(false);
    });

    it('places a paid one for payment first — it waits for the organizer only once the money lands', async () => {
      checkout.priceSelection.mockResolvedValue(
        priced({ requiresApproval: true, totalSatang: 1_000 * BAHT }),
      );
      repo.placeOrder.mockResolvedValue({
        order: order({ requiresApproval: true, totalSatang: 1_000 * BAHT }),
        tickets: [],
        replayed: false,
      });

      const res = await service.confirm(INPUT);

      expect(placed()).toMatchObject({
        issueTickets: false,
        requiresApproval: true,
        awaitsDecision: false,
      });
      expect(res.awaitingApproval).toBe(false);
      expect(res.paymentRequired).toBe(true);
    });

    it('confirms a free registration at once when the event does not require approval', async () => {
      checkout.priceSelection.mockResolvedValue(
        priced({ requiresApproval: false, totalSatang: 0 }),
      );
      const confirmed = order({ status: 'confirmed', paymentStatus: 'paid' });
      repo.placeOrder.mockResolvedValue({
        order: confirmed,
        tickets: [],
        replayed: false,
      });

      await service.confirm(INPUT);

      expect(placed()).toMatchObject({
        issueTickets: true,
        requiresApproval: false,
        awaitsDecision: false,
      });
      expect(placed().buildEvent(confirmed, [])).not.toBeNull();
    });

    it('never holds an organizer’s own entry for approval (US-REG-03)', async () => {
      checkout.priceSelection.mockResolvedValue(
        priced({ requiresApproval: true, totalSatang: 0 }),
      );
      repo.placeOrder.mockResolvedValue({
        order: order({ status: 'confirmed', paymentStatus: 'paid' }),
        tickets: [],
        replayed: false,
      });

      await service.confirm(INPUT, {
        organizationId: 7,
        createdBy: 'u-1',
        notify: true,
      });

      expect(placed()).toMatchObject({
        issueTickets: true,
        requiresApproval: false,
        awaitsDecision: false,
      });
    });
  });

  describe("the buyer's own copy of the order", () => {
    const found = (o: Partial<OrderRow>) => ({
      order: order(o),
      tickets: [],
      eventName: 'Bangkok Tech Week',
      lines: [],
    });

    it('says a waiting registration is awaiting approval — owing nothing, with no deadline', async () => {
      repo.findGuestOrder.mockResolvedValue(
        found({ requiresApproval: true, approvalRequestedAt: NOW }),
      );

      const res = await service.viewGuestOrder('o-1');

      expect(res.awaitingApproval).toBe(true);
      expect(res.paymentRequired).toBe(false);
      // A reserved seat's decision hold runs to year 9999 — not a deadline.
      expect(res.holdExpiresAt).toBeNull();
    });

    it('reads an unpaid order as owed, with its hold as the deadline', async () => {
      repo.findGuestOrder.mockResolvedValue(
        found({ totalSatang: 1_000 * BAHT }),
      );

      const res = await service.viewGuestOrder('o-1');

      expect(res.awaitingApproval).toBe(false);
      expect(res.paymentRequired).toBe(true);
      expect(res.holdExpiresAt).toBe(HOLD_EXPIRY.toISOString());
    });
  });
});
