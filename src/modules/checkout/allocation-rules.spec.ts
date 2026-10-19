import { exceedsAllocation } from './allocation-rules';

describe('exceedsAllocation (US-DISC-06)', () => {
  it('sells up to the last place, and no further', () => {
    expect(exceedsAllocation({ sold: 8, total: 10 }, 2)).toBe(false);
    expect(exceedsAllocation({ sold: 9, total: 10 }, 2)).toBe(true);
  });

  /*
   * ck_ticket_types_sold keeps `sold` within `total`, so 0 sells nothing at the
   * till; on a seat-typed event it is a type with no seat rows (US-EVT-05).
   */
  it('sells nothing from an allocation of 0', () => {
    expect(exceedsAllocation({ sold: 0, total: 0 }, 1)).toBe(true);
  });
});
