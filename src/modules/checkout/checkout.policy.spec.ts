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

  describe('resolveSeats — a seat with a tier must be the tier being bought', () => {
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

    /*
     * US-DISC-04: "I can pick up to 8 available seats from a seat map". A map
     * laid out before rows had ticket types (US-EVT-05) has no typed seat at
     * all; refusing those seats refused every seat of every such event.
     */
    it('takes a seat with no ticket type under whichever tier is being bought, on a map with no typed seat', () => {
      const seats = [
        seat(1, { ticketTypeId: null }),
        seat(2, { ticketTypeId: null }),
      ];
      expect(policy.resolveSeats(seats, [1, 2], TIER).map((s) => s.id)).toEqual(
        [1, 2],
      );
      expect(
        policy.resolveSeats(seats, [2], OTHER_TIER).map((s) => s.id),
      ).toEqual([2]);
    });

    /*
     * US-EVT-05: once rows have ticket types, a seat with none is not on sale —
     * it would otherwise sell at whichever price the buyer picked.
     */
    it('refuses a seat with no ticket type once the map gives seats types (422)', () => {
      const seats = [seat(1), seat(2, { ticketTypeId: null })];
      const err = thrown(() => policy.resolveSeats(seats, [2], TIER));
      expect((err as DomainException).getStatus()).toBe(422);
      expect(message(err)).toBe(
        "Those seats aren't on sale. Please choose different seats.",
      );
    });

    /*
     * US-EVT-05: a seat sells as its own type, not its row's — row 7 can sell
     * seats 1–5 Free and seats 6–16 Normal.
     */
    describe('on a row split between types seat by seat', () => {
      const row7 = Array.from({ length: 16 }, (_, i) =>
        seat(71 + i, {
          rowLabel: '7',
          seatNumber: String(i + 1),
          ticketTypeId: i < 5 ? TIER : OTHER_TIER,
        }),
      );
      const refusal = (ids: number[], tier: string) =>
        thrown(() => policy.resolveSeats(row7, ids, tier)) as DomainException;

      it('sells seats 1–5 only under their type', () => {
        expect(
          policy.resolveSeats(row7, [71, 75], TIER).map((s) => s.seatNumber),
        ).toEqual(['1', '5']);
        expect(refusal([71], OTHER_TIER).getStatus()).toBe(422);
        expect(message(refusal([75], OTHER_TIER))).toBe(
          'Those seats belong to a different ticket type. Please choose again.',
        );
      });

      it('sells seats 6–16 only under theirs', () => {
        expect(
          policy
            .resolveSeats(row7, [76, 86], OTHER_TIER)
            .map((s) => s.seatNumber),
        ).toEqual(['6', '16']);
        expect(refusal([76], TIER).getStatus()).toBe(422);
        expect(refusal([86], TIER).getStatus()).toBe(422);
      });

      it('refuses a pick spanning both halves under either type', () => {
        expect(refusal([75, 76], TIER).getStatus()).toBe(422);
        expect(refusal([75, 76], OTHER_TIER).getStatus()).toBe(422);
      });
    });

    it('refuses a seat someone else has already taken', () => {
      const seats = [seat(1), seat(2, { available: false })];
      const err = thrown(() => policy.resolveSeats(seats, [1, 2], TIER));
      expect((err as DomainException).getStatus()).toBe(409);
      expect(message(err)).toMatch(/just taken|no longer available/i);
    });
  });
});
