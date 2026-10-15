import { HttpStatus } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import type { Env } from '../../config/env.validation';
import { refusalOf } from '../../../test/support/refusal';
import type { TokenService } from '../auth/token.service';
import type { OutboxPort } from '../platform/outbox.port';
import { BookingClaimLinkService } from './booking-claim-link.service';
import type { ClaimableBooking } from './ports/booking-claim-order.port';

const ORDER_ID = '0b9c6a52-3f43-4f7e-9d1e-5a0c1f2b7e11';
const PLATFORM_ORG_ID = 1;
const WEB = 'https://web.example.com';
const TOKEN = 'CLAIM.TOKEN.X';
const NOW = new Date('2026-10-15T05:00:00.000Z');
const EXPIRES = new Date('2026-10-22T05:00:00.000Z');
const INVALID_LINK =
  'This link has expired or is no longer valid. Ask for a new one from your booking confirmation.';
/** The link's own expiry, in seconds since the epoch, as its token carries it. */
const EXP = Math.floor(EXPIRES.getTime() / 1000);
/** How long before that the link is opened: three days into its seven. */
const SECONDS_LEFT = 4 * 24 * 60 * 60;
const OPENED_AT = new Date((EXP - SECONDS_LEFT) * 1000);

/** An in-memory Redis: enough to tell a spent link from a fresh one. */
function fakeRedis() {
  const keys = new Map<string, { ttl: number }>();
  const redis = {
    set: jest.fn((key: string, _v: string, _ex: 'EX', ttl: number) => {
      keys.set(key, { ttl });
      return Promise.resolve('OK');
    }),
    exists: jest.fn((key: string) => Promise.resolve(keys.has(key) ? 1 : 0)),
  };
  return { redis: redis as unknown as Redis, keys };
}

/** A Redis that cannot be reached. */
const unreachable = () =>
  ({
    set: () => Promise.reject(new Error('ECONNREFUSED')),
    exists: () => Promise.reject(new Error('ECONNREFUSED')),
  }) as unknown as Redis;

/** The booking, as Checkout describes it — the address typed in mixed case. */
const booking: ClaimableBooking = {
  orderId: ORDER_ID,
  buyerName: 'Anan Suksawat',
  buyerEmail: 'Anan@Example.com',
  eventName: 'Bangkok Design Week',
  locale: 'th',
};

/**
 * The one-time link a booking's address is emailed (US-DISC-15): the only
 * proof that whoever creates the account reads that inbox. Signed for the
 * order and the address, mailed to that address alone, and read back — or
 * refused in one sentence — when it is opened.
 */
describe('BookingClaimLinkService (US-DISC-15)', () => {
  let tokens: jest.Mocked<TokenService>;
  let outbox: jest.Mocked<OutboxPort>;
  let clock: { now: () => Date };
  let config: ConfigService<Env, true>;
  let store: ReturnType<typeof fakeRedis>;
  let links: BookingClaimLinkService;

  beforeEach(() => {
    tokens = {
      signBookingClaim: jest
        .fn()
        .mockResolvedValue({ token: TOKEN, expiresAt: EXPIRES }),
      verifyBookingClaim: jest.fn().mockResolvedValue({
        sub: ORDER_ID,
        email: booking.buyerEmail,
        typ: 'booking_claim',
        exp: EXP,
      }),
    } as unknown as jest.Mocked<TokenService>;
    outbox = {
      enqueue: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<OutboxPort>;
    clock = { now: () => NOW };
    config = {
      getOrThrow: (key: string) => (key === 'PUBLIC_WEB_URL' ? WEB : ''),
    } as unknown as ConfigService<Env, true>;
    store = fakeRedis();
    links = new BookingClaimLinkService(
      tokens,
      outbox,
      clock,
      config,
      store.redis,
    );
  });

  describe('send', () => {
    it('signs the claim for this order and the address it is sent to', async () => {
      await links.send(booking, PLATFORM_ORG_ID);

      expect(tokens.signBookingClaim).toHaveBeenCalledWith({
        orderId: ORDER_ID,
        email: booking.buyerEmail,
      });
    });

    it('enqueues exactly one email carrying the link, in the booking’s language', async () => {
      await links.send(booking, PLATFORM_ORG_ID);

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
          claimUrl: `${WEB}/portal/register?claim=${TOKEN}`,
          expiresAt: '2026-10-22T05:00:00.000Z',
          locale: 'th',
          occurredAt: '2026-10-15T05:00:00.000Z',
        },
      });
    });
  });

  describe('read', () => {
    it('names the order and the address the link was sent to', async () => {
      await expect(links.read(TOKEN)).resolves.toMatchObject({
        orderId: ORDER_ID,
        email: booking.buyerEmail,
      });
      expect(tokens.verifyBookingClaim).toHaveBeenCalledWith(TOKEN);
    });

    it('is unspent until it has made an account', async () => {
      await expect(links.read(TOKEN)).resolves.toMatchObject({ spent: false });
    });

    it('refuses a link that does not verify — forged, expired or not a claim — in one sentence (400)', async () => {
      tokens.verifyBookingClaim.mockRejectedValue(new Error('jwt expired'));

      const refusal = await refusalOf(links.read(TOKEN));

      expect(refusal.getStatus()).toBe(HttpStatus.BAD_REQUEST);
      expect(refusal.message).toBe(INVALID_LINK);
      expect(refusal.code).toBe('CLAIM_LINK_INVALID');
    });
  });

  /**
   * "The link works only once" — even after the account it made is gone.
   * Without this, a link still inside its seven days would make the account
   * again once its owner deleted it (or moved it to another address), with
   * every booking on the address, for whoever holds the old email.
   */
  describe('spend', () => {
    it('reads as spent once it has made an account', async () => {
      await links.spend(await links.read(TOKEN));

      await expect(links.read(TOKEN)).resolves.toMatchObject({ spent: true });
    });

    it('is remembered until the link would have expired anyway, and no longer', async () => {
      clock.now = () => OPENED_AT;

      await links.spend(await links.read(TOKEN));

      expect([...store.keys.values()]).toEqual([{ ttl: SECONDS_LEFT }]);
    });

    it('records neither the link nor the address — only a digest of it', async () => {
      await links.spend(await links.read(TOKEN));

      const [key] = [...store.keys.keys()];
      expect(key).not.toContain(TOKEN);
      expect(key.toLowerCase()).not.toContain('anan');
      expect(key).toMatch(/^booking-claim:spent:[0-9a-f]{64}$/);
    });

    it('a different link for the same booking is not spent by this one', async () => {
      await links.spend(await links.read(TOKEN));

      await expect(links.read('ANOTHER.CLAIM.TOKEN')).resolves.toMatchObject({
        spent: false,
      });
    });

    /*
     * Fails open: with the ledger unreachable the link is single-use the way it
     * always was — the account it made still answers "sign in instead" — and
     * nobody is refused their own account over an outage.
     */
    describe('when the ledger is unreachable', () => {
      beforeEach(() => {
        links = new BookingClaimLinkService(
          tokens,
          outbox,
          clock,
          config,
          unreachable(),
        );
      });

      it('reads a link as unspent', async () => {
        await expect(links.read(TOKEN)).resolves.toMatchObject({
          spent: false,
        });
      });

      it('lets the claim finish rather than failing it', async () => {
        await expect(
          links.read(TOKEN).then((link) => links.spend(link)),
        ).resolves.toBeUndefined();
      });
    });
  });
});
