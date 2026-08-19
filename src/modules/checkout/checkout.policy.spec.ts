import { DomainException } from '../../common/errors/domain.exception';
import { CheckoutPolicy } from './checkout.policy';
import type { CheckoutSeat } from './checkout.types';

const NOW = new Date('2026-06-01T00:00:00Z');
const TIER = 'tt-1';
const OTHER_TIER = 'tt-2';

const message = (e: unknown) => (e as DomainException).message;
const thrown = (fn: () => unknown): unknown => {
  try {
    fn();
    return null;
  } catch (e) {
    return e;
  }
};

function seat(id: number, o: Partial<CheckoutSeat> = {}): CheckoutSeat {
  return {
    id,
    section: 'A',
    rowLabel: 'A',
    seatNumber: String(id),
    ticketTypeId: TIER,
    available: true,
    ...o,
  };
}

describe('CheckoutPolicy (US-DISC-04)', () => {
  const policy = new CheckoutPolicy();

  describe('resolveSelection — the event decides which shape is valid', () => {
    it('takes seats for a reserved-seating event', () => {
      expect(
        policy.resolveSelection('reserved', {
          ticketTypeId: TIER,
          seatIds: [1, 2],
        }),
      ).toEqual({ mode: 'reserved', ticketTypeId: TIER, seatIds: [1, 2] });
    });

    it('takes a quantity for a general-admission event', () => {
      expect(
        policy.resolveSelection('ga', { ticketTypeId: TIER, quantity: 3 }),
      ).toEqual({ mode: 'ga', ticketTypeId: TIER, quantity: 3 });
    });

    it('asks a reserved-seating buyer to pick seats, not a number', () => {
      const err = thrown(() =>
        policy.resolveSelection('reserved', {
          ticketTypeId: TIER,
          quantity: 2,
        }),
      );
      expect((err as DomainException).getStatus()).toBe(422);
      expect(message(err)).toMatch(/pick.*seat/i);
    });

    it('refuses seats for a general-admission event', () => {
      expect(
        message(
          thrown(() =>
            policy.resolveSelection('ga', {
              ticketTypeId: TIER,
              seatIds: [1],
            }),
          ),
        ),
      ).toMatch(/general admission|choose a quantity/i);
    });

    it('refuses an empty seat selection', () => {
      expect(
        message(
          thrown(() =>
            policy.resolveSelection('reserved', {
              ticketTypeId: TIER,
              seatIds: [],
            }),
          ),
        ),
      ).toMatch(/pick.*seat/i);
    });

    it('refuses more than 8 seats in one booking', () => {
      expect(
        message(
          thrown(() =>
            policy.resolveSelection('reserved', {
              ticketTypeId: TIER,
              seatIds: [1, 2, 3, 4, 5, 6, 7, 8, 9],
            }),
          ),
        ),
      ).toMatch(/8/);
    });

    it('accepts exactly 8 seats — the cap is inclusive', () => {
      expect(
        policy.resolveSelection('reserved', {
          ticketTypeId: TIER,
          seatIds: [1, 2, 3, 4, 5, 6, 7, 8],
        }),
      ).toMatchObject({ seatIds: [1, 2, 3, 4, 5, 6, 7, 8] });
    });

    it('refuses the same seat picked twice rather than silently merging it', () => {
      expect(
        message(
          thrown(() =>
            policy.resolveSelection('reserved', {
              ticketTypeId: TIER,
              seatIds: [4, 4],
            }),
          ),
        ),
      ).toMatch(/same seat|twice/i);
    });

    it('refuses a quantity outside 1–8', () => {
      for (const quantity of [0, 9, -1]) {
        expect(
          thrown(() =>
            policy.resolveSelection('ga', { ticketTypeId: TIER, quantity }),
          ),
        ).toBeInstanceOf(DomainException);
      }
    });
  });

  describe('assertRegistrationOpen', () => {
    it('lets an upcoming event be booked', () => {
      expect(() =>
        policy.assertRegistrationOpen(new Date('2026-06-02T00:00:00Z'), NOW),
      ).not.toThrow();
    });

    it('closes registration once the event has begun', () => {
      const err = thrown(() =>
        policy.assertRegistrationOpen(new Date('2026-05-31T00:00:00Z'), NOW),
      );
      expect((err as DomainException).getStatus()).toBe(409);
      expect(message(err)).toMatch(/closed/i);
    });
  });

  describe('resolveSeats — a seat must belong to the tier being bought', () => {
    it('returns the chosen seats in the order asked', () => {
      const found = policy.resolveSeats([seat(1), seat(2)], [2, 1], TIER);
      expect(found.map((s) => s.id)).toEqual([2, 1]);
    });

    it('refuses a seat that is not on this event’s map', () => {
      expect(
        message(thrown(() => policy.resolveSeats([seat(1)], [1, 99], TIER))),
      ).toMatch(/no longer available|not available/i);
    });

    it('refuses a seat priced by a different ticket type', () => {
      const seats = [seat(1), seat(2, { ticketTypeId: OTHER_TIER })];
      expect(
        message(thrown(() => policy.resolveSeats(seats, [1, 2], TIER))),
      ).toMatch(/ticket type/i);
    });

    it('refuses a seat someone else has already taken', () => {
      const seats = [seat(1), seat(2, { available: false })];
      const err = thrown(() => policy.resolveSeats(seats, [1, 2], TIER));
      expect((err as DomainException).getStatus()).toBe(409);
      expect(message(err)).toMatch(/just taken|no longer available/i);
    });
  });
});
