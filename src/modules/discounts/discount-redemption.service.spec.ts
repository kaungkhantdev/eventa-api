import type { Clock } from '../../common/time/clock';
import { DomainException } from '../../common/errors/domain.exception';
import { DiscountRedemptionService } from './discount-redemption.service';
import { DiscountsPolicy } from './discounts.policy';
import type { DiscountsRepository } from './discounts.repository';
import type { DiscountRow } from './discounts.types';
import type { EventOrgLookupPort } from './ports/event-org-lookup.port';

const NOW = new Date('2026-06-01T00:00:00Z');
const PAST = new Date('2026-05-01T00:00:00Z');
const FUTURE = new Date('2026-07-01T00:00:00Z');
const EVENT_ID = 'e1';
const BAHT = 100;

function discountRow(o: Partial<DiscountRow> = {}): DiscountRow {
  return {
    id: 'd1',
    organizationId: 1,
    eventId: null,
    code: 'PROMO42',
    type: 'percent',
    value: 25,
    status: 'active',
    used: 0,
    redemptionLimit: 0,
    perPersonLimit: 0,
    minOrderSatang: 0,
    validFrom: null,
    validUntil: null,
    revenueAttributedSatang: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    version: 1,
    ...o,
  };
}

const message = (e: unknown) => (e as DomainException).message;

describe('DiscountRedemptionService (US-TKT-11)', () => {
  let repo: jest.Mocked<DiscountsRepository>;
  let events: jest.Mocked<EventOrgLookupPort>;
  let service: DiscountRedemptionService;

  beforeEach(() => {
    repo = {
      findUsable: jest.fn().mockResolvedValue(discountRow()),
      redemptionsByBuyer: jest.fn().mockResolvedValue(0),
      orgVatRate: jest.fn().mockResolvedValue(0.07),
    } as unknown as jest.Mocked<DiscountsRepository>;
    events = {
      organizationIdFor: jest.fn().mockResolvedValue(1),
    };
    const clock: Clock = { now: () => NOW };
    service = new DiscountRedemptionService(
      repo,
      new DiscountsPolicy(),
      events,
      clock,
    );
  });

  const quote = (o: Record<string, unknown> = {}) =>
    service.quote({
      code: 'promo42',
      eventId: EVENT_ID,
      subtotalSatang: 1000 * BAHT,
      ...o,
    });

  it('applies 25% off ฿1,000 and recalculates VAT on the reduced total', async () => {
    const res = await quote();
    expect(res.applied).toBe(true);
    expect(res.discountSatang).toBe(250 * BAHT);
    expect(res.totalSatang).toBe(750 * BAHT);
    expect(res.netSatang + res.vatSatang).toBe(res.totalSatang);
    expect(res.code).toBe('PROMO42');
  });

  it('caps a ฿300-off code at a ฿250 order — never below zero', async () => {
    repo.findUsable.mockResolvedValue(
      discountRow({ type: 'fixed', value: 300 * BAHT }),
    );
    const res = await quote({ subtotalSatang: 250 * BAHT });
    expect(res.discountSatang).toBe(250 * BAHT);
    expect(res.totalSatang).toBe(0);
  });

  it('tells the buyer plainly when the code is unknown', async () => {
    repo.findUsable.mockResolvedValue(null);
    const err = await quote().catch((e: unknown) => e);
    expect((err as DomainException).getStatus()).toBe(422);
    expect(message(err)).toMatch(/isn't a code we recognise|not.*recognis/i);
  });

  it("says when a code hasn't started yet", async () => {
    repo.findUsable.mockResolvedValue(discountRow({ validFrom: FUTURE }));
    expect(message(await quote().catch((e: unknown) => e))).toMatch(
      /not.*started|isn't active yet/i,
    );
  });

  it('says when a code has expired', async () => {
    repo.findUsable.mockResolvedValue(discountRow({ validUntil: PAST }));
    expect(message(await quote().catch((e: unknown) => e))).toMatch(/expired/i);
  });

  it('says when a code has been switched off', async () => {
    repo.findUsable.mockResolvedValue(discountRow({ status: 'disabled' }));
    expect(message(await quote().catch((e: unknown) => e))).toMatch(
      /no longer available|switched off/i,
    );
  });

  it('refuses a code scoped to a different event', async () => {
    repo.findUsable.mockResolvedValue(discountRow({ eventId: 'other-event' }));
    expect(message(await quote().catch((e: unknown) => e))).toMatch(
      /this event/i,
    );
  });

  it('tells a buyer who already used a single-use code', async () => {
    repo.findUsable.mockResolvedValue(discountRow({ perPersonLimit: 1 }));
    repo.redemptionsByBuyer.mockResolvedValue(1);
    const err = await quote({ buyerEmail: 'anan@x.test' }).catch(
      (e: unknown) => e,
    );
    expect(message(err)).toMatch(/already used/i);
  });

  it('tells everyone else when the overall limit is reached', async () => {
    repo.findUsable.mockResolvedValue(
      discountRow({ used: 500, redemptionLimit: 500 }),
    );
    expect(message(await quote().catch((e: unknown) => e))).toMatch(
      /redemption limit/i,
    );
  });

  it('says how much more is needed to reach the minimum order', async () => {
    repo.findUsable.mockResolvedValue(
      discountRow({ minOrderSatang: 1500 * BAHT }),
    );
    const err = await quote({ subtotalSatang: 1000 * BAHT }).catch(
      (e: unknown) => e,
    );
    expect(message(err)).toMatch(/฿500/); // exactly the shortfall
  });

  it('skips the per-person check when no email is given yet', async () => {
    repo.findUsable.mockResolvedValue(discountRow({ perPersonLimit: 1 }));
    const res = await quote();
    expect(res.applied).toBe(true);
    expect(repo.redemptionsByBuyer).not.toHaveBeenCalled();
  });

  it('never discounts a free order', async () => {
    const err = await quote({ subtotalSatang: 0 }).catch((e: unknown) => e);
    expect(message(err)).toMatch(/free/i);
  });

  it('resolves the workspace from the event, not from the caller', async () => {
    await quote();
    expect(events.organizationIdFor).toHaveBeenCalledWith(EVENT_ID);
    expect(repo.findUsable).toHaveBeenCalledWith(1, 'PROMO42', EVENT_ID);
  });

  it('404s when the event does not exist', async () => {
    events.organizationIdFor.mockResolvedValue(null);
    const err = await quote().catch((e: unknown) => e);
    expect((err as DomainException).getStatus()).toBe(404);
  });
});
