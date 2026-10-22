import {
  toPublicSeatMap,
  toSeatRows,
  unassignedRowCount,
  unassignedSeatCount,
} from './event-seating.mapper';
import type { SeatRowSummary, SeatTypeRow } from './event-seating.types';

const VIP = 'aaaaaaaa-0000-4000-8000-000000000001';
const NORMAL = 'aaaaaaaa-0000-4000-8000-000000000002';
const FREE = 'aaaaaaaa-0000-4000-8000-000000000003';

/** Every seat of one row, seat 1 first, each with the type given for it. */
function row(rowLabel: string, types: (string | null)[]): SeatTypeRow[] {
  return types.map((ticketTypeId, i) => ({
    rowLabel,
    seatNumber: String(i + 1),
    ticketTypeId,
  }));
}

/** A summary row whose seats all carry `ticketTypeId`. */
function whole(
  rowLabel: string,
  ticketTypeId: string | null,
  seats: number,
): SeatRowSummary {
  return {
    rowLabel,
    ticketTypeId,
    seats,
    seatTicketTypes: Array<string | null>(seats).fill(ticketTypeId),
  };
}

describe('event-seating.mapper', () => {
  describe('toSeatRows', () => {
    it('lists rows in number order — 1, 2, 10, never 1, 10, 2', () => {
      const rows = toSeatRows([
        ...row('10', [NORMAL, NORMAL]),
        ...row('1', [VIP, VIP]),
        ...row('2', [null, null]),
      ]);
      expect(rows).toEqual([
        whole('1', VIP, 2),
        whole('2', null, 2),
        whole('10', NORMAL, 2),
      ]);
    });

    it("lists each row's seats in number order — seat 10 after seat 9", () => {
      const seats = row('1', [
        VIP,
        VIP,
        VIP,
        VIP,
        VIP,
        VIP,
        VIP,
        VIP,
        VIP,
        FREE,
      ]).reverse();
      const [only] = toSeatRows(seats);
      expect(only.seatTicketTypes[8]).toBe(VIP);
      expect(only.seatTicketTypes[9]).toBe(FREE);
    });

    it("gives a row split between types each seat's own type, and no row type", () => {
      const rows = toSeatRows(
        row('7', [FREE, FREE, FREE, FREE, FREE, NORMAL, NORMAL]),
      );
      expect(rows).toEqual([
        {
          rowLabel: '7',
          ticketTypeId: null,
          seats: 7,
          seatTicketTypes: [FREE, FREE, FREE, FREE, FREE, NORMAL, NORMAL],
        },
      ]);
    });

    it('is empty for no seats', () => {
      expect(toSeatRows([])).toEqual([]);
    });
  });

  describe('unassignedRowCount / unassignedSeatCount', () => {
    const rows = toSeatRows([
      ...row('1', [VIP, VIP, VIP]),
      ...row('2', [FREE, NORMAL, NORMAL]),
      ...row('3', [FREE, null, null]),
      ...row('4', [null, null, null]),
    ]);

    it('counts the rows with any seat that has no ticket type', () => {
      expect(unassignedRowCount(rows)).toBe(2);
    });

    it('counts the seats that have no ticket type', () => {
      expect(unassignedSeatCount(rows)).toBe(5);
    });
  });

  describe('toPublicSeatMap (US-PAGE-05)', () => {
    const layout = { rows: 3, seatsPerRow: 4 };

    it("gives each row, in order, its type and each seat's type, and nothing else", () => {
      const map = toPublicSeatMap(
        layout,
        toSeatRows([
          ...row('1', [VIP, VIP, VIP, VIP]),
          ...row('2', [FREE, FREE, NORMAL, NORMAL]),
          ...row('3', [NORMAL, NORMAL, NORMAL, NORMAL]),
        ]),
      );
      expect(map).toEqual({
        seatsPerRow: 4,
        rows: [
          {
            label: '1',
            ticketTypeId: VIP,
            seatTicketTypes: [VIP, VIP, VIP, VIP],
          },
          {
            label: '2',
            ticketTypeId: null,
            seatTicketTypes: [FREE, FREE, NORMAL, NORMAL],
          },
          {
            label: '3',
            ticketTypeId: NORMAL,
            seatTicketTypes: [NORMAL, NORMAL, NORMAL, NORMAL],
          },
        ],
      });
    });

    it('keeps a row with no ticket type, as one with none', () => {
      const map = toPublicSeatMap(layout, [
        whole('1', VIP, 4),
        whole('2', null, 4),
      ]);
      expect(map?.rows[1]).toEqual({
        label: '2',
        ticketTypeId: null,
        seatTicketTypes: [null, null, null, null],
      });
    });

    it('is shown when only part of one row has a type', () => {
      const map = toPublicSeatMap(
        layout,
        toSeatRows([
          ...row('1', [null, null, null, null]),
          ...row('2', [FREE, null, null, null]),
        ]),
      );
      expect(map?.rows.map((r) => r.ticketTypeId)).toEqual([null, null]);
      expect(map?.rows[1].seatTicketTypes).toEqual([FREE, null, null, null]);
    });

    it('is null when no seat has a ticket type — a map laid out before seats had types', () => {
      expect(
        toPublicSeatMap(layout, [whole('1', null, 4), whole('2', null, 4)]),
      ).toBeNull();
    });

    it('is null for a map with no seats', () => {
      expect(toPublicSeatMap(layout, [])).toBeNull();
    });

    it('counts the widest row when the map has no stored layout', () => {
      const map = toPublicSeatMap(null, [
        whole('1', VIP, 12),
        whole('2', VIP, 10),
      ]);
      expect(map?.seatsPerRow).toBe(12);
    });
  });
});
