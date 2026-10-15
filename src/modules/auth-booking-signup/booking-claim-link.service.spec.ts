import { HttpStatus } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
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
      }),
    } as unknown as jest.Mocked<TokenService>;
    outbox = {
      enqueue: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<OutboxPort>;
    const clock = { now: () => NOW };
    const config = {
      getOrThrow: (key: string) => (key === 'PUBLIC_WEB_URL' ? WEB : ''),
    } as unknown as ConfigService<Env, true>;
    links = new BookingClaimLinkService(tokens, outbox, clock, config);
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

    it('refuses a link that does not verify — forged, expired or not a claim — in one sentence (400)', async () => {
      tokens.verifyBookingClaim.mockRejectedValue(new Error('jwt expired'));

      const refusal = await refusalOf(links.read(TOKEN));

      expect(refusal.getStatus()).toBe(HttpStatus.BAD_REQUEST);
      expect(refusal.message).toBe(INVALID_LINK);
      expect(refusal.code).toBe('CLAIM_LINK_INVALID');
    });
  });
});
