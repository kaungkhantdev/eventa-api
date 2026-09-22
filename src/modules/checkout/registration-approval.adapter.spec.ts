import type { ConfigService } from '@nestjs/config';
import { DomainException } from '../../common/errors/domain.exception';
import type { Clock } from '../../common/time/clock';
import type { Env } from '../../config/env.validation';
import type { SeatHoldService } from '../registration/seat-hold.service';
import type {
  CheckoutRepository,
  OrderRow,
  WaitlistEntry,
} from './checkout.repository';
import type { CheckoutEventPort } from './ports/checkout-event.port';
import { RegistrationApprovalAdapter } from './registration-approval.adapter';

const ORG = 7;
const NOW = new Date('2026-08-01T03:00:00.000Z');
const OFFER_HOURS = 24;
const UNTIL = new Date('2026-08-02T03:00:00.000Z');

function entry(o: Partial<OrderRow> = {}): WaitlistEntry {
  return {
    order: {
      id: 'o-1',
      organizationId: ORG,
      reference: 'ORD-AAAA1111',
      eventId: 'e-1',
      buyerName: 'Anan',
      buyerEmail: 'anan@example.test',
      status: 'waitlisted',
      seats: 2,
      totalSatang: 210_000,
      currency: 'THB',
      offerExpiresAt: null,
      ...o,
    } as OrderRow,
    ticketTypeId: 'tt-1',
    ticketTypeName: 'General',
    quantity: 2,
  };
}

describe('RegistrationApprovalAdapter.offer (US-REG-04)', () => {
  let repo: jest.Mocked<CheckoutRepository>;
  let holds: jest.Mocked<SeatHoldService>;
  let adapter: RegistrationApprovalAdapter;

  beforeEach(() => {
    repo = {
      waitlistEntry: jest.fn().mockResolvedValue(entry()),
      markOffered: jest
        .fn()
        .mockResolvedValue({ ...entry().order, status: 'pending' }),
    } as unknown as jest.Mocked<CheckoutRepository>;
    holds = {
      holdForOffer: jest.fn().mockResolvedValue({ id: 55 }),
      release: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<SeatHoldService>;
    const config = {
      getOrThrow: (key: string) =>
        key === 'WAITLIST_OFFER_HOURS' ? OFFER_HOURS : 'https://web.test',
    } as unknown as ConfigService<Env, true>;
    const clock: Clock = { now: () => NOW };
    adapter = new RegistrationApprovalAdapter(
      repo,
      {} as CheckoutEventPort,
      clock,
      config,
      holds,
    );
  });

  it('holds their seats for the offer window, then records the offer', async () => {
    await expect(adapter.offer(ORG, 'o-1', 'u-1')).resolves.toEqual({
      outcome: 'offered',
      reference: 'ORD-AAAA1111',
      offerExpiresAt: UNTIL,
    });
    expect(holds.holdForOffer).toHaveBeenCalledWith(
      { organizationId: ORG },
      {
        eventId: 'e-1',
        ticketTypeId: 'tt-1',
        quantity: 2,
        orderId: 'o-1',
        expiresAt: UNTIL,
      },
    );
    expect(repo.markOffered).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORG,
        orderId: 'o-1',
        offeredBy: 'u-1',
        offerExpiresAt: UNTIL,
        now: NOW,
      }),
    );
  });

  it('queues an offer that links to the order page, where it is paid for', async () => {
    let queued: { payload: Record<string, unknown> } | undefined;
    repo.markOffered.mockImplementation(({ buildEvent }) => {
      queued = buildEvent(entry().order);
      return Promise.resolve(entry().order);
    });
    await adapter.offer(ORG, 'o-1', 'u-1');
    expect(queued?.payload).toMatchObject({
      buyerEmail: 'anan@example.test',
      ticketTypeName: 'General',
      ticketCount: 2,
      totalSatang: 210_000,
      offerExpiresAt: UNTIL.toISOString(),
      payUrl: 'https://web.test/my/tickets/orders/o-1',
    });
  });

  it('reports no seat — and records nothing — when none is free', async () => {
    holds.holdForOffer.mockResolvedValue(null);
    await expect(adapter.offer(ORG, 'o-1', 'u-1')).resolves.toMatchObject({
      outcome: 'no_seat',
      offerExpiresAt: null,
    });
    expect(repo.markOffered).not.toHaveBeenCalled();
  });

  it('gives the seats back when somebody else decided first', async () => {
    // Held a moment ago for an offer that is not going to happen: left alone
    // it would keep a seat off sale for a whole day.
    repo.markOffered.mockRejectedValue(DomainException.conflict('decided'));
    await expect(adapter.offer(ORG, 'o-1', 'u-1')).rejects.toThrow('decided');
    expect(holds.release).toHaveBeenCalledWith({ organizationId: ORG }, [55]);
  });

  it('reports a repeated offer as already made, holding nothing twice', async () => {
    repo.waitlistEntry.mockResolvedValue(
      entry({ status: 'pending', offerExpiresAt: UNTIL }),
    );
    await expect(adapter.offer(ORG, 'o-1', 'u-1')).resolves.toEqual({
      outcome: 'already_offered',
      reference: 'ORD-AAAA1111',
      offerExpiresAt: UNTIL,
    });
    expect(holds.holdForOffer).not.toHaveBeenCalled();
  });

  it('404s a registration that is not this workspace’s', async () => {
    repo.waitlistEntry.mockResolvedValue(null);
    const error = await adapter
      .offer(ORG, 'o-1', 'u-1')
      .catch((e: unknown) => e);
    expect((error as DomainException).getStatus()).toBe(404);
  });
});

describe('RegistrationApprovalAdapter — deciding (US-REG-02)', () => {
  const REQUESTED = new Date('2026-08-01T02:00:00.000Z');
  let repo: jest.Mocked<CheckoutRepository>;
  let adapter: RegistrationApprovalAdapter;

  beforeEach(() => {
    repo = {
      orderById: jest.fn().mockResolvedValue({
        ...entry().order,
        status: 'pending',
        paymentStatus: 'paid',
        approvalRequestedAt: REQUESTED,
      }),
      rejectOrder: jest
        .fn()
        .mockResolvedValue({ reference: 'ORD-AAAA1111', refundDue: true }),
    } as unknown as jest.Mocked<CheckoutRepository>;
    const config = {
      getOrThrow: (key: string) =>
        key === 'WAITLIST_OFFER_HOURS' ? OFFER_HOURS : 'https://web.test',
    } as unknown as ConfigService<Env, true>;
    adapter = new RegistrationApprovalAdapter(
      repo,
      {} as CheckoutEventPort,
      { now: () => NOW },
      config,
      {} as SeatHoldService,
    );
  });

  it('shows the decision when the registration started waiting for it', async () => {
    await expect(adapter.findDecidable(ORG, 'o-1')).resolves.toMatchObject({
      status: 'pending',
      paymentStatus: 'paid',
      approvalRequestedAt: REQUESTED,
    });
  });

  it('rejects under the lock with the decider’s refund permission, and says whether money is owed back', async () => {
    await expect(
      adapter.reject(ORG, 'o-1', {
        decidedBy: 'u-1',
        reason: 'Not a member',
        mayRefund: true,
      }),
    ).resolves.toEqual({ reference: 'ORD-AAAA1111', refundDue: true });
    expect(repo.rejectOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORG,
        orderId: 'o-1',
        decidedBy: 'u-1',
        reason: 'Not a member',
        mayRefund: true,
      }),
    );
  });
});
