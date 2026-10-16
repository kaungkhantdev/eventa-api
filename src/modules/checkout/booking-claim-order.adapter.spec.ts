import type { BookingClaimOrderPort } from '../auth-booking-signup/ports/booking-claim-order.port';
import { BookingClaimOrderAdapter } from './booking-claim-order.adapter';
import type {
  CheckoutRepository,
  ClaimableBookingRow,
} from './checkout.repository';

const ORDER_ID = '0b9c6a52-3f43-4f7e-9d1e-5a0c1f2b7e11';

const row: ClaimableBookingRow = {
  orderId: ORDER_ID,
  buyerName: 'Anan Suksawat',
  buyerEmail: 'anan@example.com',
  eventName: 'Bangkok Design Week',
  eventLocale: null,
  organizationLocale: 'en',
  status: 'confirmed',
};

/**
 * Checkout answering "which booking is this?" for an account created from it
 * (US-DISC-15) — including the language its claim email should speak, which
 * is the language the booking's own confirmation was written in.
 */
describe('BookingClaimOrderAdapter (US-DISC-15)', () => {
  let repo: jest.Mocked<CheckoutRepository>;
  let port: BookingClaimOrderPort;

  beforeEach(() => {
    repo = {
      findClaimableBooking: jest.fn().mockResolvedValue(row),
    } as unknown as jest.Mocked<CheckoutRepository>;
    port = new BookingClaimOrderAdapter(repo);
  });

  it('describes the booking by its order id', async () => {
    await expect(port.findBooking(ORDER_ID)).resolves.toEqual({
      orderId: ORDER_ID,
      buyerName: 'Anan Suksawat',
      buyerEmail: 'anan@example.com',
      eventName: 'Bangkok Design Week',
      locale: 'en',
      status: 'confirmed',
    });
    expect(repo.findClaimableBooking).toHaveBeenCalledWith(ORDER_ID);
  });

  /** Checkout owns the order's status; the account flow only reads it here. */
  it('says where the order stands, whatever that is', async () => {
    repo.findClaimableBooking.mockResolvedValue({
      ...row,
      status: 'cancelled',
    });

    await expect(port.findBooking(ORDER_ID)).resolves.toMatchObject({
      status: 'cancelled',
    });
  });

  it('speaks the event’s own language when it has one', async () => {
    repo.findClaimableBooking.mockResolvedValue({
      ...row,
      eventLocale: 'th',
      organizationLocale: 'en',
    });

    await expect(port.findBooking(ORDER_ID)).resolves.toMatchObject({
      locale: 'th',
    });
  });

  it('falls back to the workspace’s language when the event has none', async () => {
    repo.findClaimableBooking.mockResolvedValue({
      ...row,
      eventLocale: null,
      organizationLocale: 'th',
    });

    await expect(port.findBooking(ORDER_ID)).resolves.toMatchObject({
      locale: 'th',
    });
  });

  it('answers null for an order that does not exist', async () => {
    repo.findClaimableBooking.mockResolvedValue(null);

    await expect(port.findBooking(ORDER_ID)).resolves.toBeNull();
  });
});
