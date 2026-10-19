import { toSeatRows, unassignedRowCount } from './event-seating.mapper';

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
});
