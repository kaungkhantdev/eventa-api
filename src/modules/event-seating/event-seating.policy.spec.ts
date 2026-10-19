import { DomainException } from '../../common/errors/domain.exception';
import { EventSeatingPolicy } from './event-seating.policy';
import type {
  ConfigureReservedInput,
  ReservedSnapshot,
  SeatRow,
} from './event-seating.types';

const VIP = 'aaaaaaaa-0000-4000-8000-000000000001';
const NORMAL = 'aaaaaaaa-0000-4000-8000-000000000002';
const FREE = 'aaaaaaaa-0000-4000-8000-000000000003';
const TIERS = [
  { id: VIP, name: 'VIP' },
  { id: NORMAL, name: 'Normal' },
  { id: FREE, name: 'Free' },
];

/** A rows × seatsPerRow map as it stands, seat ids 100, 101, … row by row. */
function existingGrid(
  rows: number,
  seatsPerRow: number,
  typeOfRow: (row: number) => string | null = () => null,
): SeatRow[] {
  const seats: SeatRow[] = [];
  for (let r = 1; r <= rows; r += 1) {
    for (let s = 1; s <= seatsPerRow; s += 1) {
      seats.push({
        id: 100 + seats.length,
        organizationId: 1,
        seatMapId: 5,
        section: '',
        rowLabel: String(r),
        seatNumber: String(s),
        ticketTypeId: typeOfRow(r),
        status: 'available',
        createdAt: new Date(),
        updatedAt: new Date(),
        version: 1,
      });
    }
  }
  return seats;
}

function snapshot(o: Partial<ReservedSnapshot> = {}): ReservedSnapshot {
  return { seats: [], tiers: TIERS, occupiedSeatIds: new Set(), ...o };
}

function input(o: Partial<ConfigureReservedInput>): ConfigureReservedInput {
  return { name: 'Hall', rows: 2, seatsPerRow: 2, ...o };
}

function refusal(run: () => unknown): DomainException {
  try {
    run();
  } catch (err) {
    expect(err).toBeInstanceOf(DomainException);
    return err as DomainException;
  }
  throw new Error('expected a refusal');
}

describe('EventSeatingPolicy', () => {
  const policy = new EventSeatingPolicy();

  describe('assertTypeShape', () => {
    it('accepts no list at all — every seat keeps its type', () => {
      expect(() => policy.assertTypeShape(input({ rows: 3 }))).not.toThrow();
    });

    it('accepts exactly one entry per row', () => {
      expect(() =>
        policy.assertTypeShape(
          input({ rows: 3, rowTicketTypes: [VIP, null, NORMAL] }),
        ),
      ).not.toThrow();
    });

    it('accepts exactly one entry per seat of every row', () => {
      expect(() =>
        policy.assertTypeShape(
          input({
            rows: 2,
            seatsPerRow: 3,
            seatTicketTypes: [
              [FREE, FREE, NORMAL],
              [VIP, null, VIP],
            ],
          }),
        ),
      ).not.toThrow();
    });

    it('refuses rows and seats sent together (422)', () => {
      const err = refusal(() =>
        policy.assertTypeShape(
          input({
            rowTicketTypes: [VIP, VIP],
            seatTicketTypes: [
              [VIP, VIP],
              [VIP, VIP],
            ],
          }),
        ),
      );
      expect(err.getStatus()).toBe(422);
      expect(err.message).toBe(
        'Send rowTicketTypes or seatTicketTypes, not both.',
      );
    });

    it('refuses a row list whose length is not the row count (422)', () => {
      const err = refusal(() =>
        policy.assertTypeShape(
          input({ rows: 3, rowTicketTypes: [VIP, NORMAL] }),
        ),
      );
      expect(err.getStatus()).toBe(422);
      expect(err.message).toBe(
        'Send one ticket type per row: this map has 3 rows, but 2 were sent.',
      );
    });

    it('refuses a seat list with a row too few or too many (422)', () => {
      const err = refusal(() =>
        policy.assertTypeShape(
          input({ rows: 3, seatTicketTypes: [[VIP, VIP]] }),
        ),
      );
      expect(err.getStatus()).toBe(422);
      expect(err.message).toBe(
        'Send one ticket type per row: this map has 3 rows, but 1 were sent.',
      );
    });

    it('refuses a row of the seat list that is not one entry per seat (422, row named)', () => {
      const err = refusal(() =>
        policy.assertTypeShape(
          input({
            rows: 2,
            seatsPerRow: 3,
            seatTicketTypes: [
              [VIP, VIP, VIP],
              [VIP, VIP],
            ],
          }),
        ),
      );
      expect(err.getStatus()).toBe(422);
      expect(err.message).toBe(
        'Send one ticket type per seat: row 2 has 3 seats, but 2 were sent.',
      );
    });
  });

  describe('planReserved', () => {
    it('lays out a new map with each row carrying its ticket type', () => {
      const plan = policy.planReserved(
        snapshot(),
        input({ rows: 3, seatsPerRow: 2, rowTicketTypes: [VIP, VIP, NORMAL] }),
        false,
      );
      expect(plan.added).toHaveLength(6);
      expect(plan.added.filter((s) => s.rowLabel === '3')).toEqual([
        {
          section: '',
          rowLabel: '3',
          seatNumber: '1',
          ticketTypeId: NORMAL,
        },
        {
          section: '',
          rowLabel: '3',
          seatNumber: '2',
          ticketTypeId: NORMAL,
        },
      ]);
      expect(plan.removedSeatIds).toEqual([]);
      expect(plan.retyped).toEqual([]);
    });

    it("counts each live type's seats, 0 for a type with no rows", () => {
      const plan = policy.planReserved(
        snapshot(),
        input({ rows: 3, seatsPerRow: 2, rowTicketTypes: [VIP, VIP, NORMAL] }),
        false,
      );
      expect(plan.seatsByTier).toEqual(
        new Map([
          [VIP, 4],
          [NORMAL, 2],
          [FREE, 0],
        ]),
      );
    });

    it('leaves a map with no typed seat out of the quantities (legacy)', () => {
      const plan = policy.planReserved(snapshot(), input({}), false);
      expect(plan.added.every((s) => s.ticketTypeId === null)).toBe(true);
      expect(plan.seatsByTier).toBeNull();
    });

    it("refuses a row whose type isn't one of this event's (422, row named)", () => {
      const err = refusal(() =>
        policy.planReserved(
          snapshot(),
          input({
            rows: 2,
            rowTicketTypes: [VIP, 'bbbbbbbb-0000-4000-8000-000000000009'],
          }),
          false,
        ),
      );
      expect(err.getStatus()).toBe(422);
      expect(err.message).toBe(
        "Row 2's ticket type isn't one of this event's ticket types.",
      );
    });

    it('keeps each surviving row on its type when no list is sent', () => {
      const seats = existingGrid(2, 2, () => VIP);
      const plan = policy.planReserved(
        snapshot({ seats }),
        input({ rows: 3, seatsPerRow: 2 }),
        false,
      );
      expect(plan.retyped).toEqual([]);
      expect(plan.added.map((s) => [s.rowLabel, s.ticketTypeId])).toEqual([
        ['3', null],
        ['3', null],
      ]);
      expect(plan.seatsByTier?.get(VIP)).toBe(4);
    });

    it("gives a longer row's new seats no type when no list is sent", () => {
      const seats = existingGrid(1, 2, () => VIP);
      const plan = policy.planReserved(
        snapshot({ seats }),
        input({ rows: 1, seatsPerRow: 3 }),
        false,
      );
      expect(plan.added).toEqual([
        { section: '', rowLabel: '1', seatNumber: '3', ticketTypeId: null },
      ]);
      expect(plan.retyped).toEqual([]);
    });

    it('moves a whole free row to another type', () => {
      const seats = existingGrid(2, 2, () => VIP);
      const plan = policy.planReserved(
        snapshot({ seats }),
        input({ rowTicketTypes: [VIP, NORMAL] }),
        false,
      );
      expect(plan.retyped).toEqual([
        { ticketTypeId: NORMAL, seatIds: [102, 103] },
      ]);
      expect(plan.seatsByTier).toEqual(
        new Map([
          [VIP, 2],
          [NORMAL, 2],
          [FREE, 0],
        ]),
      );
    });

    it('refuses to retype a booked or held seat with its row (409, seat named)', () => {
      const seats = existingGrid(2, 2, () => VIP);
      const err = refusal(() =>
        policy.planReserved(
          snapshot({ seats, occupiedSeatIds: new Set([103]) }),
          input({ rowTicketTypes: [VIP, NORMAL] }),
          false,
        ),
      );
      expect(err.getStatus()).toBe(409);
      expect(err.message).toBe(
        "Row 2 seat 2 is booked or held, so its ticket type can't change.",
      );
    });

    it('lets a row with booked seats keep its type while others move', () => {
      const seats = existingGrid(2, 2, () => VIP);
      const plan = policy.planReserved(
        snapshot({ seats, occupiedSeatIds: new Set([100]) }),
        input({ rowTicketTypes: [VIP, NORMAL] }),
        false,
      );
      expect(plan.retyped).toEqual([
        { ticketTypeId: NORMAL, seatIds: [102, 103] },
      ]);
    });

    it('treats typing a booked row of an untyped map as a change (409)', () => {
      const seats = existingGrid(2, 2);
      const err = refusal(() =>
        policy.planReserved(
          snapshot({ seats, occupiedSeatIds: new Set([101]) }),
          input({ rowTicketTypes: [VIP, NORMAL] }),
          false,
        ),
      );
      expect(err.getStatus()).toBe(409);
      expect(err.message).toBe(
        "Row 1 seat 2 is booked or held, so its ticket type can't change.",
      );
    });

    it('clears every row back to no type, leaving the quantities alone', () => {
      const seats = existingGrid(2, 2, () => VIP);
      const plan = policy.planReserved(
        snapshot({ seats }),
        input({ rowTicketTypes: [null, null] }),
        false,
      );
      expect(plan.retyped).toEqual([
        { ticketTypeId: null, seatIds: [100, 101, 102, 103] },
      ]);
      expect(plan.seatsByTier).toBeNull();
    });

    it('removes the seats outside a smaller grid', () => {
      const seats = existingGrid(3, 2, () => VIP);
      const plan = policy.planReserved(
        snapshot({ seats }),
        input({ rows: 2, seatsPerRow: 2 }),
        false,
      );
      expect(plan.removedSeatIds).toEqual([104, 105]);
      expect(plan.seatsByTier?.get(VIP)).toBe(4);
    });

    it('still refuses to drop a sold seat from a published event (422)', () => {
      const seats = existingGrid(3, 2).map((s) =>
        s.id === 104 ? { ...s, status: 'sold' as const } : s,
      );
      const err = refusal(() =>
        policy.planReserved(snapshot({ seats }), input({ rows: 2 }), true),
      );
      expect(err.getStatus()).toBe(422);
      expect(err.message).toBe(
        'Seats that are already sold cannot be removed from a published event.',
      );
    });

    it('lets a draft drop a seat marked sold, as before', () => {
      const seats = existingGrid(3, 2).map((s) =>
        s.id === 104 ? { ...s, status: 'sold' as const } : s,
      );
      const plan = policy.planReserved(snapshot({ seats }), input({}), false);
      expect(plan.removedSeatIds).toEqual([104, 105]);
    });

    describe('seat by seat (seatTicketTypes)', () => {
      /** Row 1 VIP; row 2 seats 1–2 Free and seats 3–4 Normal. */
      const mixed = (): (string | null)[][] => [
        [VIP, VIP, VIP, VIP],
        [FREE, FREE, NORMAL, NORMAL],
      ];

      it('lays out a new map with each seat on the type sent for it', () => {
        const plan = policy.planReserved(
          snapshot(),
          input({ seatsPerRow: 4, seatTicketTypes: mixed() }),
          false,
        );
        expect(
          plan.added
            .filter((s) => s.rowLabel === '2')
            .map((s) => [s.seatNumber, s.ticketTypeId]),
        ).toEqual([
          ['1', FREE],
          ['2', FREE],
          ['3', NORMAL],
          ['4', NORMAL],
        ]);
      });

      it("counts each type's seats, a row split between types included", () => {
        const plan = policy.planReserved(
          snapshot(),
          input({ seatsPerRow: 4, seatTicketTypes: mixed() }),
          false,
        );
        expect(plan.seatsByTier).toEqual(
          new Map([
            [VIP, 4],
            [NORMAL, 2],
            [FREE, 2],
          ]),
        );
      });

      it('moves just the seats whose type changes, grouped by their new type', () => {
        const seats = existingGrid(2, 4, () => NORMAL);
        const plan = policy.planReserved(
          snapshot({ seats }),
          input({ seatsPerRow: 4, seatTicketTypes: mixed() }),
          false,
        );
        expect(plan.retyped).toEqual([
          { ticketTypeId: VIP, seatIds: [100, 101, 102, 103] },
          { ticketTypeId: FREE, seatIds: [104, 105] },
        ]);
        expect(plan.added).toEqual([]);
      });

      it("refuses a seat whose type isn't one of this event's (422, row and seat named)", () => {
        const sent = mixed();
        sent[1][2] = 'bbbbbbbb-0000-4000-8000-000000000009';
        const err = refusal(() =>
          policy.planReserved(
            snapshot(),
            input({ seatsPerRow: 4, seatTicketTypes: sent }),
            false,
          ),
        );
        expect(err.getStatus()).toBe(422);
        expect(err.message).toBe(
          "Row 2 seat 3's ticket type isn't one of this event's ticket types.",
        );
      });

      it('refuses a booked or held seat sent with another type (409, row and seat named)', () => {
        // Row 2 seat 1 (id 104) is held under Normal.
        const seats = existingGrid(2, 4, () => NORMAL);
        const err = refusal(() =>
          policy.planReserved(
            snapshot({ seats, occupiedSeatIds: new Set([104]) }),
            input({ seatsPerRow: 4, seatTicketTypes: mixed() }),
            false,
          ),
        );
        expect(err.getStatus()).toBe(409);
        expect(err.message).toBe(
          "Row 2 seat 1 is booked or held, so its ticket type can't change.",
        );
      });

      it('lets the rest of a row move while its booked seat keeps its type', () => {
        // Row 2 seat 3 (id 106) is booked under Normal and stays Normal.
        const seats = existingGrid(2, 4, () => NORMAL);
        const plan = policy.planReserved(
          snapshot({ seats, occupiedSeatIds: new Set([106]) }),
          input({ seatsPerRow: 4, seatTicketTypes: mixed() }),
          false,
        );
        expect(plan.retyped).toContainEqual({
          ticketTypeId: FREE,
          seatIds: [104, 105],
        });
      });

      it('lets a draft leave some seats of a row with no type', () => {
        const sent = mixed();
        sent[1][3] = null;
        const plan = policy.planReserved(
          snapshot(),
          input({ seatsPerRow: 4, seatTicketTypes: sent }),
          false,
        );
        expect(plan.seatsByTier?.get(NORMAL)).toBe(1);
      });

      it('refuses a published event a seat with no type (422, its row named)', () => {
        const sent = mixed();
        sent[1][3] = null;
        const err = refusal(() =>
          policy.planReserved(
            snapshot({ seats: existingGrid(2, 4, () => VIP) }),
            input({ seatsPerRow: 4, seatTicketTypes: sent }),
            true,
          ),
        );
        expect(err.getStatus()).toBe(422);
        expect(err.message).toBe(
          'Give every seat in row 2 a ticket type. Every seat of a published event needs one.',
        );
      });

      it('takes the seats of a published event once every one has a type', () => {
        const plan = policy.planReserved(
          snapshot({ seats: existingGrid(2, 4, () => VIP) }),
          input({ seatsPerRow: 4, seatTicketTypes: mixed() }),
          true,
        );
        expect(plan.seatsByTier?.get(FREE)).toBe(2);
      });
    });

    describe('on a published event whose rows have ticket types', () => {
      const PUBLISHED = true;

      it('refuses a new row with no type when no list is sent (422, row named)', () => {
        const seats = existingGrid(2, 2, () => VIP);
        const err = refusal(() =>
          policy.planReserved(
            snapshot({ seats }),
            input({ rows: 3 }),
            PUBLISHED,
          ),
        );
        expect(err.getStatus()).toBe(422);
        expect(err.message).toBe(
          'Give every seat in row 3 a ticket type. Every seat of a published event needs one.',
        );
      });

      it('refuses a row sent with no type (422, row named)', () => {
        const err = refusal(() =>
          policy.planReserved(
            snapshot({ seats: existingGrid(2, 2, () => VIP) }),
            input({ rowTicketTypes: [null, NORMAL] }),
            PUBLISHED,
          ),
        );
        expect(err.getStatus()).toBe(422);
        expect(err.message).toMatch(
          /^Give every seat in row 1 a ticket type\./,
        );
      });

      it("refuses a longer row's new seats, which no list gives a type (422)", () => {
        const err = refusal(() =>
          policy.planReserved(
            snapshot({ seats: existingGrid(2, 2, () => VIP) }),
            input({ seatsPerRow: 3 }),
            PUBLISHED,
          ),
        );
        expect(err.getStatus()).toBe(422);
        expect(err.message).toMatch(
          /^Give every seat in row 1 a ticket type\./,
        );
      });

      it('takes a new row that is sent with a type', () => {
        const plan = policy.planReserved(
          snapshot({ seats: existingGrid(2, 2, () => VIP) }),
          input({ rows: 3, rowTicketTypes: [VIP, VIP, NORMAL] }),
          PUBLISHED,
        );
        expect(plan.seatsByTier?.get(NORMAL)).toBe(2);
      });

      it('still lets a map with no typed seat grow untyped (legacy)', () => {
        const plan = policy.planReserved(
          snapshot({ seats: existingGrid(2, 2) }),
          input({ rows: 3 }),
          PUBLISHED,
        );
        expect(plan.seatsByTier).toBeNull();
      });
    });
  });

  describe('readiness (US-EVT-05)', () => {
    /** `n` seats of one type. */
    const seats = (n: number, ticketTypeId: string | null) =>
      Array<string | null>(n).fill(ticketTypeId);

    it('is ready when every seat has a type and every type a seat', () => {
      expect(
        policy.readiness(
          [...seats(16, VIP), ...seats(16, NORMAL), ...seats(16, FREE)],
          TIERS,
        ),
      ).toEqual({ seatsWithoutType: 0, ticketTypesWithoutSeats: [] });
    });

    it('is ready with a row split between types, seat by seat', () => {
      // Row 1 VIP; row 2 seats 1–5 Free, seats 6–16 Normal.
      expect(
        policy.readiness(
          [...seats(16, VIP), ...seats(5, FREE), ...seats(11, NORMAL)],
          TIERS,
        ),
      ).toEqual({ seatsWithoutType: 0, ticketTypesWithoutSeats: [] });
    });

    it('counts the seats with no type, and names the types with no seat in order', () => {
      expect(
        policy.readiness([...seats(14, VIP), ...seats(2, null)], TIERS),
      ).toEqual({
        seatsWithoutType: 2,
        ticketTypesWithoutSeats: ['Normal', 'Free'],
      });
    });

    it('is just its seats while no seat has a type yet (a legacy map)', () => {
      expect(policy.readiness(seats(32, null), TIERS)).toEqual({
        seatsWithoutType: 32,
        ticketTypesWithoutSeats: [],
      });
    });

    it('names every type when there is no map yet', () => {
      expect(policy.readiness([], TIERS).ticketTypesWithoutSeats).toEqual([
        'VIP',
        'Normal',
        'Free',
      ]);
    });
  });
});
