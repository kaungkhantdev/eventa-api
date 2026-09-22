import { DomainException } from '../../common/errors/domain.exception';
import type { Clock } from '../../common/time/clock';
import type { CheckoutRepository } from './checkout.repository';
import type { CheckoutService, PricedSelection } from './checkout.service';
import { CheckoutWaitlistService } from './checkout-waitlist.service';
import type { JoinWaitlistDto } from './dto/join-waitlist.dto';

const NOW = new Date('2026-06-01T00:00:00Z');
const BAHT = 100;

const INPUT: JoinWaitlistDto = {
  eventId: 'e-1',
  ticketTypeId: 'tt-1',
  quantity: 2,
  buyer: { name: 'Anan', email: 'anan@example.test' },
  idempotencyKey: 'key-12345678',
};

function priced(
  o: {
    waitlistEnabled?: boolean;
    status?: 'soldout' | 'onsale';
  } = {},
): PricedSelection {
  return {
    event: {
      id: 'e-1',
      organizationId: 7,
      name: 'Bangkok Tech Week',
      seatingMode: 'ga',
      waitlistEnabled: o.waitlistEnabled ?? true,
    },
    tier: { id: 'tt-1', name: 'General', status: o.status ?? 'soldout' },
    summary: {
      ticketTypeId: 'tt-1',
      ticketTypeName: 'General',
      quantity: 2,
      unitPriceSatang: 1_000 * BAHT,
      subtotalSatang: 2_000 * BAHT,
      discountSatang: 0,
      serviceFeeSatang: 100 * BAHT,
      totalSatang: 2_100 * BAHT,
      netSatang: 196_262,
      vatSatang: 13_738,
    },
    discountCodeId: null,
  } as unknown as PricedSelection;
}

describe('CheckoutWaitlistService (US-REG-04)', () => {
  let checkout: jest.Mocked<CheckoutService>;
  let repo: jest.Mocked<CheckoutRepository>;
  let service: CheckoutWaitlistService;

  beforeEach(() => {
    checkout = {
      priceSelection: jest.fn().mockResolvedValue(priced()),
    } as unknown as jest.Mocked<CheckoutService>;
    repo = {
      joinWaitlist: jest.fn().mockResolvedValue({
        order: { id: 'o-1', reference: 'ORD-AAAA1111', seats: 2 },
        position: 3,
      }),
    } as unknown as jest.Mocked<CheckoutRepository>;
    const clock: Clock = { now: () => NOW };
    service = new CheckoutWaitlistService(checkout, repo, clock);
  });

  it('puts the buyer in line for a sold-out ticket, and says where', async () => {
    await expect(service.join(INPUT)).resolves.toEqual({
      orderId: 'o-1',
      reference: 'ORD-AAAA1111',
      eventName: 'Bangkok Tech Week',
      ticketTypeName: 'General',
      quantity: 2,
      position: 3,
    });
  });

  it('prices the entry now, from the catalog — never from the request', async () => {
    await service.join(INPUT);
    expect(checkout.priceSelection).toHaveBeenCalledWith({
      eventId: 'e-1',
      ticketTypeId: 'tt-1',
      quantity: 2,
      buyerEmail: 'anan@example.test',
    });
    expect(repo.joinWaitlist).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 7,
        eventId: 'e-1',
        ticketTypeId: 'tt-1',
        quantity: 2,
        unitPriceSatang: 1_000 * BAHT,
        buyer: INPUT.buyer,
        idempotencyKey: 'key-12345678',
        now: NOW,
      }),
    );
    const [placed] = repo.joinWaitlist.mock.calls[0];
    expect(placed.totals.totalSatang).toBe(2_100 * BAHT);
  });

  it('refuses when the organizer has not switched the waitlist on', async () => {
    checkout.priceSelection.mockResolvedValue(
      priced({ waitlistEnabled: false }),
    );
    const error = await service.join(INPUT).catch((e: unknown) => e);
    expect((error as DomainException).getStatus()).toBe(422);
    expect(repo.joinWaitlist).not.toHaveBeenCalled();
  });

  it('sends a buyer back to the tickets when some are left', async () => {
    // Sold out when the page loaded, a ticket freed since: a 409, so the
    // page can say "book one" rather than queue them for nothing.
    checkout.priceSelection.mockResolvedValue(priced({ status: 'onsale' }));
    const error = await service.join(INPUT).catch((e: unknown) => e);
    expect((error as DomainException).getStatus()).toBe(409);
    expect(repo.joinWaitlist).not.toHaveBeenCalled();
  });
});
