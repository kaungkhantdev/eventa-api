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

  describe('assertOneTypePerRow', () => {
    it('accepts no list at all — every row keeps its type', () => {
      expect(() => policy.assertOneTypePerRow(3)).not.toThrow();
    });

    it('accepts exactly one entry per row', () => {
      expect(() =>
        policy.assertOneTypePerRow(3, [VIP, null, NORMAL]),
      ).not.toThrow();
    });

    it('refuses a list whose length is not the row count (422)', () => {
      const err = refusal(() => policy.assertOneTypePerRow(3, [VIP, NORMAL]));
      expect(err.getStatus()).toBe(422);
      expect(err.message).toMatch(/one ticket type per row/i);
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

    it("gives a longer row's new seats the row's type", () => {
      const seats = existingGrid(1, 2, () => VIP);
      const plan = policy.planReserved(
        snapshot({ seats }),
        input({ rows: 1, seatsPerRow: 3 }),
        false,
      );
      expect(plan.added).toEqual([
        { section: '', rowLabel: '1', seatNumber: '3', ticketTypeId: VIP },
      ]);
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

    it('refuses to retype a row with a booked or held seat (409, row named)', () => {
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
        "Row 2 has booked or held seats, so its ticket type can't change.",
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
      expect(err.message).toMatch(/^Row 1 /);
    });

    it('clears every row back to no type, leaving the quantities alone', () => {
      const seats = existingGrid(2, 2, () => VIP);
      const plan = policy.planReserved(
        snapshot({ seats }),
        input({ rowTicketTypes: [null, null] }),
        false,
      );
      expect(plan.retyped).toEqual([
        { ticketTypeId: null, seatIds: [100, 101] },
        { ticketTypeId: null, seatIds: [102, 103] },
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
  });

  describe('readiness (US-EVT-05)', () => {
    const row = (rowLabel: string, ticketTypeId: string | null) => ({
      rowLabel,
      ticketTypeId,
      seats: 16,
    });

    it('is ready when every row has a type and every type a row', () => {
      expect(
        policy.readiness(
          [row('1', VIP), row('2', NORMAL), row('3', FREE)],
          TIERS,
        ),
      ).toEqual({ rowsWithoutType: 0, ticketTypesWithoutRows: [] });
    });

    it('counts the rows with no type, and names the types with no row in order', () => {
      expect(
        policy.readiness(
          [row('1', VIP), row('2', null), row('3', null)],
          TIERS,
        ),
      ).toEqual({
        rowsWithoutType: 2,
        ticketTypesWithoutRows: ['Normal', 'Free'],
      });
    });

    it('is just its rows while no row has a type yet (a legacy map)', () => {
      expect(policy.readiness([row('1', null), row('2', null)], TIERS)).toEqual(
        { rowsWithoutType: 2, ticketTypesWithoutRows: [] },
      );
    });

    it('names every type when there is no map yet', () => {
      expect(policy.readiness([], TIERS).ticketTypesWithoutRows).toEqual([
        'VIP',
        'Normal',
        'Free',
      ]);
    });
  });
});
