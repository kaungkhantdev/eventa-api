import { HttpStatus } from '@nestjs/common';
import { DrizzleQueryError } from 'drizzle-orm';
import { refusalOf } from '../../../test/support/refusal';
import type { PasswordService } from '../auth-password/auth-password.service';
import type { SignupRepository } from '../auth-signup/auth-signup.repository';
import type { AuthService } from '../auth/auth.service';
import type { UsersRepository } from '../users/users.repository';
import { invalidClaimLink } from './auth-booking-signup.errors';
import type { BookingClaimLinkService } from './booking-claim-link.service';
import { BookingClaimService } from './booking-claim.service';
import type {
  BookingClaimOrderPort,
  ClaimableBooking,
} from './ports/booking-claim-order.port';

const ORDER_ID = '0b9c6a52-3f43-4f7e-9d1e-5a0c1f2b7e11';
const TOKEN = 'CLAIM.TOKEN.X';
const PASSWORD = 'strong-pass1';
const device = 'Chrome on Mac';
const ip = '203.0.113.9';
const INVALID_LINK =
  'This link has expired or is no longer valid. Ask for a new one from your booking confirmation.';

const booking: ClaimableBooking = {
  orderId: ORDER_ID,
  buyerName: 'Anan Suksawat',
  buyerEmail: 'anan@example.com',
  eventName: 'Bangkok Design Week',
  locale: 'en',
};

/** What the emailed link carries: the order, and the address it went to. */
const link = {
  orderId: ORDER_ID,
  email: 'Anan@Example.com',
};

/** An account whose address was proven — by its own link, an invite or a provider. */
const CONFIRMED = { userId: 'att-1', confirmed: true };
/** Somebody signed up with this address and never confirmed it. */
const UNCONFIRMED = { userId: 'att-9', confirmed: false };

const found = {
  user: { id: 'att-1', persona: 'attendee', status: 'Active' },
  org: { id: 1, slug: 'eventa' },
};

/** What the database says when two claims race for the one address. */
function raceLost(): Error {
  return new DrizzleQueryError(
    'insert into "users" ...',
    [],
    Object.assign(new Error('duplicate key value'), {
      code: '23505',
      constraint: 'uq_users_org_email_persona',
    }),
  );
}

/**
 * Creating the account from the emailed link (US-DISC-15).
 *
 * The link is the only proof that whoever chooses the password reads the
 * booking's inbox, so it — not the order id, not the request body — is where
 * the address comes from. The name comes from the order. Nothing else is
 * taken from the caller but a password.
 */
describe('BookingClaimService (US-DISC-15)', () => {
  let bookings: jest.Mocked<BookingClaimOrderPort>;
  let links: jest.Mocked<BookingClaimLinkService>;
  let accounts: jest.Mocked<SignupRepository>;
  let passwords: jest.Mocked<PasswordService>;
  let users: jest.Mocked<UsersRepository>;
  let auth: jest.Mocked<AuthService>;
  let service: BookingClaimService;

  beforeEach(() => {
    bookings = {
      findBooking: jest.fn().mockResolvedValue(booking),
    };
    links = {
      read: jest.fn().mockResolvedValue(link),
    } as unknown as jest.Mocked<BookingClaimLinkService>;
    accounts = {
      findPlatformAttendee: jest.fn().mockResolvedValue(null),
      createAttendeeAccount: jest
        .fn()
        .mockResolvedValue({ organizationId: 1, userId: 'att-1' }),
      supersedeUnconfirmedAttendee: jest.fn().mockResolvedValue(true),
    } as unknown as jest.Mocked<SignupRepository>;
    passwords = {
      hash: jest.fn().mockResolvedValue('HASH'),
    } as unknown as jest.Mocked<PasswordService>;
    users = {
      findProfile: jest.fn().mockResolvedValue(found),
    } as unknown as jest.Mocked<UsersRepository>;
    auth = {
      startSession: jest.fn().mockResolvedValue({
        accessToken: 'ACCESS',
        refreshToken: 'REFRESH',
        expiresIn: 900,
        user: { id: 'att-1' },
      }),
    } as unknown as jest.Mocked<AuthService>;
    service = new BookingClaimService(
      bookings,
      links,
      accounts,
      passwords,
      users,
      auth,
    );
  });

  const claim = () =>
    service.claim({ token: TOKEN, password: PASSWORD, device, ip });

  /** A dead link is a 400 in the one fixed sentence, whatever killed it. */
  async function expectDeadLink(call: Promise<unknown>): Promise<void> {
    const refusal = await refusalOf(call);
    expect(refusal.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    expect(refusal.message).toBe(INVALID_LINK);
    expect(refusal.code).toBe('CLAIM_LINK_INVALID');
  }

  describe('inspect', () => {
    it('shows the name from the booking and the address from the link', async () => {
      await expect(service.inspect(TOKEN)).resolves.toEqual({
        name: 'Anan Suksawat',
        email: 'Anan@Example.com',
        accountExists: false,
      });
      expect(links.read).toHaveBeenCalledWith(TOKEN);
      expect(bookings.findBooking).toHaveBeenCalledWith(ORDER_ID);
    });

    it('says when the address already has an account', async () => {
      accounts.findPlatformAttendee.mockResolvedValue(CONFIRMED);

      await expect(service.inspect(TOKEN)).resolves.toMatchObject({
        accountExists: true,
      });
      expect(accounts.findPlatformAttendee).toHaveBeenCalledWith(
        'Anan@Example.com',
      );
    });

    it('asks for a password when the address’s only account was never confirmed', async () => {
      accounts.findPlatformAttendee.mockResolvedValue(UNCONFIRMED);

      await expect(service.inspect(TOKEN)).resolves.toMatchObject({
        accountExists: false,
      });
    });

    it('refuses a link that does not verify — forged, expired or not a claim', async () => {
      links.read.mockRejectedValue(invalidClaimLink());

      await expectDeadLink(service.inspect(TOKEN));
    });

    it('refuses a link whose order no longer exists', async () => {
      bookings.findBooking.mockResolvedValue(null);

      await expectDeadLink(service.inspect(TOKEN));
    });

    it('refuses a link once the order’s address is no longer the one it was sent to', async () => {
      bookings.findBooking.mockResolvedValue({
        ...booking,
        buyerEmail: 'somebody-else@example.com',
      });

      await expectDeadLink(service.inspect(TOKEN));
    });
  });

  describe('claim', () => {
    it('creates the account active, in the booking’s name, for the link’s address', async () => {
      await claim();

      expect(passwords.hash).toHaveBeenCalledWith(PASSWORD);
      expect(accounts.createAttendeeAccount).toHaveBeenCalledWith({
        name: 'Anan Suksawat',
        email: 'Anan@Example.com',
        passwordHash: 'HASH',
        // Opening the emailed link proved the address: nothing left to confirm.
        confirmed: true,
      });
    });

    it('signs the new account in, as a password sign-in would', async () => {
      const session = await claim();

      expect(users.findProfile).toHaveBeenCalledWith('att-1');
      expect(auth.startSession).toHaveBeenCalledWith(found, { device, ip });
      expect(session).toMatchObject({
        accessToken: 'ACCESS',
        refreshToken: 'REFRESH',
      });
    });

    /**
     * Somebody signed up with this address and chose its password, but never
     * proved the inbox. The link does prove it, so its holder takes the
     * account over: their password replaces the stranger's, the name is the
     * booking's, and nothing the stranger may have opened survives.
     */
    it('takes over an account whose address was never confirmed, rather than refusing', async () => {
      accounts.findPlatformAttendee.mockResolvedValue(UNCONFIRMED);
      users.findProfile.mockResolvedValue({
        ...found,
        user: { ...found.user, id: 'att-9' },
      } as unknown as Awaited<ReturnType<UsersRepository['findProfile']>>);

      await claim();

      expect(accounts.supersedeUnconfirmedAttendee).toHaveBeenCalledWith({
        userId: 'att-9',
        name: 'Anan Suksawat',
        passwordHash: 'HASH',
      });
      expect(accounts.createAttendeeAccount).not.toHaveBeenCalled();
      expect(users.findProfile).toHaveBeenCalledWith('att-9');
      expect(auth.startSession).toHaveBeenCalledTimes(1);
    });

    it('tells the loser to sign in if that account was confirmed meanwhile (409)', async () => {
      accounts.findPlatformAttendee.mockResolvedValue(UNCONFIRMED);
      accounts.supersedeUnconfirmedAttendee.mockResolvedValue(false);

      const refusal = await refusalOf(claim());

      expect(refusal.getStatus()).toBe(HttpStatus.CONFLICT);
      expect(auth.startSession).not.toHaveBeenCalled();
    });

    it('invites an address that already has an account to sign in (409) — which also spends the link', async () => {
      accounts.findPlatformAttendee.mockResolvedValue(CONFIRMED);

      const refusal = await refusalOf(claim());

      expect(refusal.getStatus()).toBe(HttpStatus.CONFLICT);
      expect(refusal.message).toBe(
        'An account already uses this email. Sign in instead.',
      );
      expect(accounts.createAttendeeAccount).not.toHaveBeenCalled();
      expect(accounts.supersedeUnconfirmedAttendee).not.toHaveBeenCalled();
      expect(auth.startSession).not.toHaveBeenCalled();
    });

    it('answers the loser of two simultaneous claims with the same 409', async () => {
      accounts.createAttendeeAccount.mockRejectedValue(raceLost());

      const refusal = await refusalOf(claim());

      expect(refusal.getStatus()).toBe(HttpStatus.CONFLICT);
      expect(auth.startSession).not.toHaveBeenCalled();
    });

    it('refuses a dead link before a password is even hashed', async () => {
      links.read.mockRejectedValue(invalidClaimLink());

      await expectDeadLink(claim());
      expect(passwords.hash).not.toHaveBeenCalled();
      expect(accounts.createAttendeeAccount).not.toHaveBeenCalled();
    });

    it('refuses a link whose order’s address has changed, creating nothing', async () => {
      bookings.findBooking.mockResolvedValue({
        ...booking,
        buyerEmail: 'somebody-else@example.com',
      });

      await expectDeadLink(claim());
      expect(accounts.createAttendeeAccount).not.toHaveBeenCalled();
    });

    it('says attendee accounts are unavailable when the platform organization is missing', async () => {
      accounts.createAttendeeAccount.mockResolvedValue(null);

      const refusal = await refusalOf(claim());

      expect(refusal.getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(auth.startSession).not.toHaveBeenCalled();
    });

    it('passes on any other failure to create the account untouched', async () => {
      const outage = new Error('connection reset');
      accounts.createAttendeeAccount.mockRejectedValue(outage);

      await expect(claim()).rejects.toBe(outage);
    });
  });
});
