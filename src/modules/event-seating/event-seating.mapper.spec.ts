import {
  toPublicSeatMap,
  toSeatRows,
  unassignedRowCount,
} from './event-seating.mapper';

const VIP = 'aaaaaaaa-0000-4000-8000-000000000001';
const NORMAL = 'aaaaaaaa-0000-4000-8000-000000000002';

describe('event-seating.mapper', () => {
  describe('toSeatRows', () => {
    it('lists rows in number order — 1, 2, 10, never 1, 10, 2', () => {
      const rows = toSeatRows([
        { rowLabel: '10', ticketTypeId: NORMAL, seats: 4 },
        { rowLabel: '1', ticketTypeId: VIP, seats: 4 },
        { rowLabel: '2', ticketTypeId: null, seats: 4 },
      ]);
      expect(rows).toEqual([
        { rowLabel: '1', ticketTypeId: VIP, seats: 4 },
        { rowLabel: '2', ticketTypeId: null, seats: 4 },
        { rowLabel: '10', ticketTypeId: NORMAL, seats: 4 },
      ]);
    });

    it('reads a row split across types as having none, with every seat counted', () => {
      const rows = toSeatRows([
        { rowLabel: '1', ticketTypeId: VIP, seats: 3 },
        { rowLabel: '1', ticketTypeId: NORMAL, seats: 1 },
      ]);
      expect(rows).toEqual([{ rowLabel: '1', ticketTypeId: null, seats: 4 }]);
    });

    it('is empty for no seats', () => {
      expect(toSeatRows([])).toEqual([]);
    });
  });

  describe('unassignedRowCount', () => {
    it('counts the rows with no ticket type', () => {
      expect(
        unassignedRowCount([
          { rowLabel: '1', ticketTypeId: VIP, seats: 4 },
          { rowLabel: '2', ticketTypeId: null, seats: 4 },
          { rowLabel: '3', ticketTypeId: null, seats: 4 },
        ]),
      ).toBe(2);
    });
  });

  describe('toPublicSeatMap (US-PAGE-05)', () => {
    const layout = { rows: 3, seatsPerRow: 16 };

    it('gives each row, in order, the ticket type it sells and nothing else', () => {
      const map = toPublicSeatMap(layout, [
        { rowLabel: '1', ticketTypeId: VIP, seats: 16 },
        { rowLabel: '2', ticketTypeId: VIP, seats: 16 },
        { rowLabel: '3', ticketTypeId: NORMAL, seats: 16 },
      ]);
      expect(map).toEqual({
        seatsPerRow: 16,
        rows: [
          { label: '1', ticketTypeId: VIP },
          { label: '2', ticketTypeId: VIP },
          { label: '3', ticketTypeId: NORMAL },
        ],
      });
    });

    it('keeps a row with no ticket type, as one with none', () => {
      const map = toPublicSeatMap(layout, [
        { rowLabel: '1', ticketTypeId: VIP, seats: 16 },
        { rowLabel: '2', ticketTypeId: null, seats: 16 },
      ]);
      expect(map?.rows).toEqual([
        { label: '1', ticketTypeId: VIP },
        { label: '2', ticketTypeId: null },
      ]);
    });

    it('is null when no row has a ticket type — a map laid out before rows had types', () => {
      expect(
        toPublicSeatMap(layout, [
          { rowLabel: '1', ticketTypeId: null, seats: 16 },
          { rowLabel: '2', ticketTypeId: null, seats: 16 },
        ]),
      ).toBeNull();
    });

    it('is null for a map with no seats', () => {
      expect(toPublicSeatMap(layout, [])).toBeNull();
    });

    it('counts the widest row when the map has no stored layout', () => {
      const map = toPublicSeatMap(null, [
        { rowLabel: '1', ticketTypeId: VIP, seats: 12 },
        { rowLabel: '2', ticketTypeId: VIP, seats: 10 },
      ]);
      expect(map?.seatsPerRow).toBe(12);
    });
  });
});
