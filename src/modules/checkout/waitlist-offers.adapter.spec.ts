import { Logger } from '@nestjs/common';
import type { Clock } from '../../common/time/clock';
import type { SeatHoldService } from '../registration/seat-hold.service';
import type {
  ApprovalResult,
  OfferResult,
} from '../registrations/ports/registration-approval.port';
import type {
  CheckoutRepository,
  OrderRow,
  WaitlistEntry,
} from './checkout.repository';
import type { CheckoutEvent } from './checkout.types';
import type { CheckoutEventPort } from './ports/checkout-event.port';
import type { RegistrationApprovalAdapter } from './registration-approval.adapter';
import { WaitlistOffersAdapter } from './waitlist-offers.adapter';

const ORG = 7;
const EVENT = 'e-1';
const TIER = 'tt-1';
const NOW = new Date('2026-08-01T03:00:00.000Z');
const FIVE_MINUTES = 5 * 60 * 1000;
const OPEN_EVENT = {
  id: EVENT,
  waitlistEnabled: true,
  seatingMode: 'ga',
  requiresApproval: false,
} as CheckoutEvent;

function inLine(id: string, totalSatang = 105_000, quantity = 1) {
  return {
    order: { id, eventId: EVENT, totalSatang } as OrderRow,
    ticketTypeId: TIER,
    ticketTypeName: 'General',
    quantity,
  } satisfies WaitlistEntry;
}

const offered = (reference: string): OfferResult => ({
  outcome: 'offered',
  reference,
  offerExpiresAt: new Date(NOW.getTime() + 24 * 60 * 60 * 1000),
});
const NO_SEAT: OfferResult = {
  outcome: 'no_seat',
  reference: 'x',
  offerExpiresAt: null,
};
const approved = (outcome: ApprovalResult['outcome']): ApprovalResult => ({
  outcome,
  reference: 'x',
  ticketCount: outcome === 'approved' ? 1 : 0,
  reason: null,
});

describe('WaitlistOffersAdapter (US-REG-04)', () => {
  let repo: { frontOfLine: jest.Mock };
  let events: { findOwnedById: jest.Mock };
  let approvals: { offer: jest.Mock; approve: jest.Mock };
  let holds: { holdForOffer: jest.Mock; release: jest.Mock };
  let adapter: WaitlistOffersAdapter;

  /** The line as it stands at each look: one entry per call, then empty. */
  const line = (...entries: WaitlistEntry[]) => {
    for (const entry of entries) repo.frontOfLine.mockResolvedValueOnce(entry);
    repo.frontOfLine.mockResolvedValue(null);
  };

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    repo = { frontOfLine: jest.fn().mockResolvedValue(null) };
    events = { findOwnedById: jest.fn().mockResolvedValue(OPEN_EVENT) };
    approvals = {
      offer: jest.fn(),
      approve: jest.fn().mockResolvedValue(approved('approved')),
    };
    holds = {
      holdForOffer: jest.fn().mockResolvedValue({ id: 55 }),
      release: jest.fn().mockResolvedValue(undefined),
    };
    const clock: Clock = { now: () => NOW };
    adapter = new WaitlistOffersAdapter(
      repo as unknown as CheckoutRepository,
      events as unknown as CheckoutEventPort,
      approvals as unknown as RegistrationApprovalAdapter,
      holds as unknown as SeatHoldService,
      clock,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  it('offers in line order until the front no longer fits', async () => {
    line(inLine('A'), inLine('B'), inLine('C'));
    approvals.offer
      .mockResolvedValueOnce(offered('A'))
      .mockResolvedValueOnce(offered('B'))
      .mockResolvedValueOnce(NO_SEAT);

    await expect(adapter.offerNewPlaces(ORG, EVENT, TIER)).resolves.toBe(2);

    expect(repo.frontOfLine).toHaveBeenCalledWith(ORG, TIER);
    expect(approvals.offer.mock.calls).toEqual([
      [ORG, 'A', null],
      [ORG, 'B', null],
      [ORG, 'C', null],
    ]);
  });

  it('never skips the person at the front', async () => {
    // Two places, and the front wants three: whoever is behind them waits too.
    line(inLine('A', 315_000, 3), inLine('B'));
    approvals.offer.mockResolvedValue(NO_SEAT);

    await expect(adapter.offerNewPlaces(ORG, EVENT, TIER)).resolves.toBe(0);

    expect(repo.frontOfLine).toHaveBeenCalledTimes(1);
    expect(approvals.offer).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['the waitlist is switched off', { ...OPEN_EVENT, waitlistEnabled: false }],
    [
      'the event seats people by seat',
      { ...OPEN_EVENT, seatingMode: 'reserved' },
    ],
    ['the event is not live (draft, completed or cancelled)', null],
    // US-REG-02: a place there is the organizer's decision, not a capacity
    // edit's — free or paid, they can still offer it by hand.
    ['the event requires approval', { ...OPEN_EVENT, requiresApproval: true }],
  ])('offers nobody when %s', async (_why, event) => {
    events.findOwnedById.mockResolvedValue(event);
    line(inLine('A'));

    await expect(adapter.offerNewPlaces(ORG, EVENT, TIER)).resolves.toBe(0);

    expect(events.findOwnedById).toHaveBeenCalledWith(ORG, EVENT);
    expect(repo.frontOfLine).not.toHaveBeenCalled();
    expect(approvals.offer).not.toHaveBeenCalled();
  });

  it('confirms a free registration through approval, holding its place first', async () => {
    line(inLine('F', 0, 2));

    await expect(adapter.offerNewPlaces(ORG, EVENT, TIER)).resolves.toBe(1);

    expect(holds.holdForOffer).toHaveBeenCalledWith(
      { organizationId: ORG },
      {
        eventId: EVENT,
        ticketTypeId: TIER,
        quantity: 2,
        orderId: 'F',
        expiresAt: new Date(NOW.getTime() + FIVE_MINUTES),
      },
    );
    expect(approvals.approve).toHaveBeenCalledWith(ORG, 'F', null);
    expect(approvals.offer).not.toHaveBeenCalled();
    expect(holds.release).not.toHaveBeenCalled();
  });

  it('gives the place back and stops when the approval does not go through', async () => {
    line(inLine('P'), inLine('F', 0), inLine('Z'));
    approvals.offer.mockResolvedValue(offered('P'));
    approvals.approve.mockResolvedValue(approved('unavailable'));

    await expect(adapter.offerNewPlaces(ORG, EVENT, TIER)).resolves.toBe(1);

    expect(holds.release).toHaveBeenCalledWith({ organizationId: ORG }, [55]);
    expect(repo.frontOfLine).toHaveBeenCalledTimes(2);
  });

  it('gives the place back and stops when the approval fails outright', async () => {
    line(inLine('F', 0), inLine('Z'));
    approvals.approve.mockRejectedValue(new Error('connection reset'));

    await expect(adapter.offerNewPlaces(ORG, EVENT, TIER)).resolves.toBe(0);

    expect(holds.release).toHaveBeenCalledWith({ organizationId: ORG }, [55]);
    expect(repo.frontOfLine).toHaveBeenCalledTimes(1);
  });

  it('stops without approving when nothing is free for a free registration', async () => {
    line(inLine('F', 0), inLine('Z'));
    holds.holdForOffer.mockResolvedValue(null);

    await expect(adapter.offerNewPlaces(ORG, EVENT, TIER)).resolves.toBe(0);

    expect(approvals.approve).not.toHaveBeenCalled();
    expect(holds.release).not.toHaveBeenCalled();
  });

  it('reports the offers already made when one fails, instead of throwing', async () => {
    line(inLine('A'), inLine('B'), inLine('C'));
    approvals.offer
      .mockResolvedValueOnce(offered('A'))
      .mockRejectedValueOnce(new Error('decided elsewhere'));

    await expect(adapter.offerNewPlaces(ORG, EVENT, TIER)).resolves.toBe(1);

    expect(approvals.offer).toHaveBeenCalledTimes(2);
    expect(Logger.prototype.warn).toHaveBeenCalled();
  });

  it('reports nothing offered when the event cannot even be read', async () => {
    events.findOwnedById.mockRejectedValue(new Error('connection reset'));

    await expect(adapter.offerNewPlaces(ORG, EVENT, TIER)).resolves.toBe(0);
  });

  it('never serves the same registration twice', async () => {
    // Defensive: a line that did not move would otherwise loop for ever.
    repo.frontOfLine.mockResolvedValue(inLine('A'));
    approvals.offer.mockResolvedValue(offered('A'));

    await expect(adapter.offerNewPlaces(ORG, EVENT, TIER)).resolves.toBe(1);

    expect(approvals.offer).toHaveBeenCalledTimes(1);
  });

  it('offers nobody when nobody is waiting', async () => {
    await expect(adapter.offerNewPlaces(ORG, EVENT, TIER)).resolves.toBe(0);
    expect(approvals.offer).not.toHaveBeenCalled();
    expect(holds.holdForOffer).not.toHaveBeenCalled();
  });
});
