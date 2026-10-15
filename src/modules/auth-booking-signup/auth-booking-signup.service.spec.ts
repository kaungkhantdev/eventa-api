import { HttpStatus } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { DomainException } from '../../common/errors/domain.exception';
import type { ResendThrottleService } from '../../common/throttle/resend-throttle.service';
import type { Env } from '../../config/env.validation';
import { refusalOf } from '../../../test/support/refusal';
import type { SignupRepository } from '../auth-signup/auth-signup.repository';
import type { TokenService } from '../auth/token.service';
import type { OutboxPort } from '../platform/outbox.port';
import { AuthBookingSignupService } from './auth-booking-signup.service';
import type {
  BookingClaimOrderPort,
  ClaimableBooking,
} from './ports/booking-claim-order.port';

const ORDER_ID = '0b9c6a52-3f43-4f7e-9d1e-5a0c1f2b7e11';
const PLATFORM_ORG_ID = 1;
const WEB = 'https://web.example.com';
const NOW = new Date('2026-10-15T05:00:00.000Z');
const EXPIRES = new Date('2026-10-22T05:00:00.000Z');
/** An account whose address was proven — by its own link, an invite or a provider. */
const CONFIRMED = { userId: 'att-1', confirmed: true };
/**
 * An account somebody signed up for with this address and never confirmed —
 * a password chosen by whoever typed the address, proven by nobody.
 */
const UNCONFIRMED = { userId: 'att-9', confirmed: false };

/** The booking, as Checkout describes it — the address typed in mixed case. */
const booking: ClaimableBooking = {
  orderId: ORDER_ID,
  buyerName: 'Anan Suksawat',
  buyerEmail: 'Anan@Example.com',
  eventName: 'Bangkok Design Week',
  locale: 'th',
};

/**
 * Asking for the link that creates an account from a booking (US-DISC-15).
 *
 * The trust rule: nothing is created, and no password is chosen, until the
 * booking's inbox is proven — and the proof is a one-time link only that inbox
 * receives. So asking for the link sends it, to the booking's address and
 * nowhere else, and does nothing more.
 */
describe('AuthBookingSignupService (US-DISC-15)', () => {
  let bookings: jest.Mocked<BookingClaimOrderPort>;
  let accounts: jest.Mocked<SignupRepository>;
  let tokens: jest.Mocked<TokenService>;
  let outbox: jest.Mocked<OutboxPort>;
  let throttle: jest.Mocked<ResendThrottleService>;
  let service: AuthBookingSignupService;

  beforeEach(() => {
    bookings = {
      findBooking: jest.fn().mockResolvedValue(booking),
    };
    accounts = {
      findPlatformAttendee: jest.fn().mockResolvedValue(null),
      findPlatformOrganizationId: jest.fn().mockResolvedValue(PLATFORM_ORG_ID),
      createAttendeeAccount: jest.fn(),
    } as unknown as jest.Mocked<SignupRepository>;
    tokens = {
      signBookingClaim: jest
        .fn()
        .mockResolvedValue({ token: 'CLAIM.TOKEN.X', expiresAt: EXPIRES }),
    } as unknown as jest.Mocked<TokenService>;
    outbox = {
      enqueue: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<OutboxPort>;
    throttle = {
      claim: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<ResendThrottleService>;
    const clock = { now: () => NOW };
    const config = {
      getOrThrow: (key: string) => (key === 'PUBLIC_WEB_URL' ? WEB : ''),
    } as unknown as ConfigService<Env, true>;
    service = new AuthBookingSignupService(
      bookings,
      accounts,
      tokens,
      outbox,
      throttle,
      clock,
      config,
    );
  });

  describe('accountFor', () => {
    it('says whether the booking’s address already has an attendee account', async () => {
      await expect(service.accountFor(ORDER_ID)).resolves.toEqual({
        accountExists: false,
      });
      accounts.findPlatformAttendee.mockResolvedValue(CONFIRMED);
      await expect(service.accountFor(ORDER_ID)).resolves.toEqual({
        accountExists: true,
      });
      expect(bookings.findBooking).toHaveBeenCalledWith(ORDER_ID);
      expect(accounts.findPlatformAttendee).toHaveBeenCalledWith(
        booking.buyerEmail,
      );
    });

    /**
     * Anybody can sign up with anybody's address and choose its password. If
     * that unproven account counted, the address's owner would be told to sign
     * in to it — and confirming it would hand the stranger's password a live
     * account (pre-account takeover).
     */
    it('does not count an account whose address was never confirmed', async () => {
      accounts.findPlatformAttendee.mockResolvedValue(UNCONFIRMED);

      await expect(service.accountFor(ORDER_ID)).resolves.toEqual({
        accountExists: false,
      });
    });

    it('answers 404 for an order that does not exist', async () => {
      bookings.findBooking.mockResolvedValue(null);

      const refusal = await refusalOf(service.accountFor(ORDER_ID));

      expect(refusal.getStatus()).toBe(HttpStatus.NOT_FOUND);
    });
  });

  describe('requestLink', () => {
    it('says where the link went — the booking’s own address', async () => {
      await expect(service.requestLink(ORDER_ID)).resolves.toEqual({
        sentTo: booking.buyerEmail,
      });
    });

    it('signs the claim for this order and the address it is sent to', async () => {
      await service.requestLink(ORDER_ID);

      expect(tokens.signBookingClaim).toHaveBeenCalledWith({
        orderId: ORDER_ID,
        email: booking.buyerEmail,
      });
    });

    it('enqueues exactly one email carrying the link, in the booking’s language', async () => {
      await service.requestLink(ORDER_ID);

      expect(outbox.enqueue).toHaveBeenCalledTimes(1);
      expect(outbox.enqueue).toHaveBeenCalledWith({
        organizationId: PLATFORM_ORG_ID,
        aggregateType: 'order',
        aggregateId: ORDER_ID,
        routingKey: 'identity.booking_account_link_requested',
        payload: {
          version: 1,
          organizationId: PLATFORM_ORG_ID,
          orderId: ORDER_ID,
          name: 'Anan Suksawat',
          email: 'Anan@Example.com',
          eventName: 'Bangkok Design Week',
          claimUrl: `${WEB}/portal/register?claim=CLAIM.TOKEN.X`,
          expiresAt: '2026-10-22T05:00:00.000Z',
          locale: 'th',
          occurredAt: '2026-10-15T05:00:00.000Z',
        },
      });
    });

    it('creates no account and chooses no password — the link is all it does', async () => {
      await service.requestLink(ORDER_ID);

      expect(accounts.createAttendeeAccount).not.toHaveBeenCalled();
    });

    /**
     * Anybody holding an order id can ask — the booker, not only the buyer —
     * so the cool-off's one-a-minute is no bound on how many the buyer gets.
     * A daily total is.
     */
    it('rations the link per address, in a key space of its own, a few a day', async () => {
      await service.requestLink(ORDER_ID);

      expect(throttle.claim).toHaveBeenCalledWith(
        'booking-claim:anan@example.com',
        'link',
        { max: 5, windowSeconds: 24 * 60 * 60 },
      );
      expect(throttle.claim.mock.invocationCallOrder[0]).toBeLessThan(
        tokens.signBookingClaim.mock.invocationCallOrder[0],
      );
    });

    it('passes on the throttle’s own refusal and sends nothing', async () => {
      const wait = DomainException.tooManyRequests('Give it a minute.');
      throttle.claim.mockRejectedValue(wait);

      await expect(service.requestLink(ORDER_ID)).rejects.toBe(wait);
      expect(tokens.signBookingClaim).not.toHaveBeenCalled();
      expect(outbox.enqueue).not.toHaveBeenCalled();
    });

    it('sends the link to an address whose only account was never confirmed', async () => {
      accounts.findPlatformAttendee.mockResolvedValue(UNCONFIRMED);

      await expect(service.requestLink(ORDER_ID)).resolves.toEqual({
        sentTo: booking.buyerEmail,
      });
      expect(outbox.enqueue).toHaveBeenCalledTimes(1);
    });

    it('invites an address that already has an account to sign in (409), sending nothing', async () => {
      accounts.findPlatformAttendee.mockResolvedValue(CONFIRMED);

      const refusal = await refusalOf(service.requestLink(ORDER_ID));

      expect(refusal.getStatus()).toBe(HttpStatus.CONFLICT);
      expect(refusal.message).toBe(
        'An account already uses this email. Sign in instead.',
      );
      // Not a send, so it spends no cool-off either.
      expect(throttle.claim).not.toHaveBeenCalled();
      expect(tokens.signBookingClaim).not.toHaveBeenCalled();
      expect(outbox.enqueue).not.toHaveBeenCalled();
    });

    it('answers 404 for an order that does not exist, sending nothing', async () => {
      bookings.findBooking.mockResolvedValue(null);

      const refusal = await refusalOf(service.requestLink(ORDER_ID));

      expect(refusal.getStatus()).toBe(HttpStatus.NOT_FOUND);
      expect(throttle.claim).not.toHaveBeenCalled();
      expect(outbox.enqueue).not.toHaveBeenCalled();
    });

    it('says attendee accounts are unavailable when the platform organization is missing, spending no cool-off', async () => {
      accounts.findPlatformOrganizationId.mockResolvedValue(null);

      const refusal = await refusalOf(service.requestLink(ORDER_ID));

      expect(refusal.getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(outbox.enqueue).not.toHaveBeenCalled();
      // A broken deployment is not a send: asking again once it is fixed must
      // not be refused for a link that never went out.
      expect(throttle.claim).not.toHaveBeenCalled();
    });
  });
});
