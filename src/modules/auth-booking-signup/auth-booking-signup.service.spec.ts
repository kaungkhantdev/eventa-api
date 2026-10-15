import { HttpStatus } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain.exception';
import type { ResendThrottleService } from '../../common/throttle/resend-throttle.service';
import { ATTENDEE_ACCOUNTS_UNAVAILABLE } from '../../common/tenancy/platform-org';
import { orderStatusEnum } from '../../db/schema';
import { refusalOf } from '../../../test/support/refusal';
import type { SignupRepository } from '../auth-signup/auth-signup.repository';
import { AuthBookingSignupService } from './auth-booking-signup.service';
import type { BookingClaimLinkService } from './booking-claim-link.service';
import type {
  BookingClaimOrderPort,
  ClaimableBooking,
} from './ports/booking-claim-order.port';

const ORDER_ID = '0b9c6a52-3f43-4f7e-9d1e-5a0c1f2b7e11';
const PLATFORM_ORG_ID = 1;
/** An account whose address was proven — by its own link, an invite or a provider. */
const CONFIRMED = { userId: 'att-1', confirmed: true };
/**
 * An account somebody signed up for with this address and never confirmed —
 * a password chosen by whoever typed the address, proven by nobody.
 */
const UNCONFIRMED = { userId: 'att-9', confirmed: false };
const BOOKING_NOT_CONFIRMED =
  "This booking isn't confirmed, so there are no tickets to keep in an account yet.";
/** Every way an order can stand other than confirmed — read from the enum. */
const NOT_CONFIRMED_STATUSES = orderStatusEnum.enumValues.filter(
  (status) => status !== 'confirmed',
);

/** The booking, as Checkout describes it — the address typed in mixed case. */
const booking: ClaimableBooking = {
  orderId: ORDER_ID,
  buyerName: 'Anan Suksawat',
  buyerEmail: 'Anan@Example.com',
  eventName: 'Bangkok Design Week',
  locale: 'th',
  status: 'confirmed',
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
  let links: jest.Mocked<BookingClaimLinkService>;
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
    links = {
      send: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<BookingClaimLinkService>;
    throttle = {
      claim: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<ResendThrottleService>;
    service = new AuthBookingSignupService(bookings, accounts, links, throttle);
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

    /**
     * Anybody can place an unpaid order with anybody's address and is handed
     * its uuid — and an owed order emails nobody. Answering for it would let a
     * stranger ask, silently and as often as they liked, whether that address
     * has an Eventa account. The offer is only made for a confirmed booking
     * with tickets to keep, so the question is refused for any other, exactly
     * as the link is, before any account is looked up.
     */
    it.each(NOT_CONFIRMED_STATUSES)(
      'refuses the question when the booking is %s (409), never looking the address up',
      async (status) => {
        bookings.findBooking.mockResolvedValue({ ...booking, status });
        accounts.findPlatformAttendee.mockResolvedValue(CONFIRMED);

        const refusal = await refusalOf(service.accountFor(ORDER_ID));

        expect(refusal.getStatus()).toBe(HttpStatus.CONFLICT);
        expect(refusal.message).toBe(BOOKING_NOT_CONFIRMED);
        expect(accounts.findPlatformAttendee).not.toHaveBeenCalled();
      },
    );
  });

  describe('requestLink', () => {
    it('says where the link went — the booking’s own address', async () => {
      await expect(service.requestLink(ORDER_ID)).resolves.toEqual({
        sentTo: booking.buyerEmail,
      });
    });

    it('sends this booking’s link exactly once, from the platform', async () => {
      await service.requestLink(ORDER_ID);

      expect(links.send).toHaveBeenCalledTimes(1);
      expect(links.send).toHaveBeenCalledWith(booking, PLATFORM_ORG_ID);
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
        links.send.mock.invocationCallOrder[0],
      );
    });

    it('passes on the throttle’s own refusal and sends nothing', async () => {
      const wait = DomainException.tooManyRequests('Give it a minute.');
      throttle.claim.mockRejectedValue(wait);

      await expect(service.requestLink(ORDER_ID)).rejects.toBe(wait);
      expect(links.send).not.toHaveBeenCalled();
    });

    it('sends the link to an address whose only account was never confirmed', async () => {
      accounts.findPlatformAttendee.mockResolvedValue(UNCONFIRMED);

      await expect(service.requestLink(ORDER_ID)).resolves.toEqual({
        sentTo: booking.buyerEmail,
      });
      expect(links.send).toHaveBeenCalledTimes(1);
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
      expect(links.send).not.toHaveBeenCalled();
    });

    /**
     * Only a confirmed booking has tickets to keep. One still pending, on the
     * waitlist, cancelled, rejected or expired is refused before anything is
     * rationed, signed or sent — so a confirmed booking for the same address
     * can still have its link straight away.
     */
    it.each(NOT_CONFIRMED_STATUSES)(
      'refuses the link when the booking is %s (409), spending no cool-off and sending nothing',
      async (status) => {
        bookings.findBooking.mockResolvedValue({ ...booking, status });

        const refusal = await refusalOf(service.requestLink(ORDER_ID));

        expect(refusal.getStatus()).toBe(HttpStatus.CONFLICT);
        expect(refusal.message).toBe(BOOKING_NOT_CONFIRMED);
        expect(throttle.claim).not.toHaveBeenCalled();
        expect(links.send).not.toHaveBeenCalled();
      },
    );

    it('answers 404 for an order that does not exist, sending nothing', async () => {
      bookings.findBooking.mockResolvedValue(null);

      const refusal = await refusalOf(service.requestLink(ORDER_ID));

      expect(refusal.getStatus()).toBe(HttpStatus.NOT_FOUND);
      expect(throttle.claim).not.toHaveBeenCalled();
      expect(links.send).not.toHaveBeenCalled();
    });

    it('says attendee accounts are unavailable when the platform organization is missing, spending no cool-off', async () => {
      accounts.findPlatformOrganizationId.mockResolvedValue(null);

      const refusal = await refusalOf(service.requestLink(ORDER_ID));

      expect(refusal.getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
      // The same sentence attendee sign-up gives — one, said everywhere.
      expect(refusal.message).toBe(ATTENDEE_ACCOUNTS_UNAVAILABLE);
      expect(links.send).not.toHaveBeenCalled();
      // A broken deployment is not a send: asking again once it is fixed must
      // not be refused for a link that never went out.
      expect(throttle.claim).not.toHaveBeenCalled();
    });
  });
});
