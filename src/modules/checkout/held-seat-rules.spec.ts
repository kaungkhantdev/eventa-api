import { heldSeatsMatch, type HeldSeatsCheck } from './held-seat-rules';

const VIP = 'vip';
const NORMAL = 'normal';

function check(o: Partial<HeldSeatsCheck>): HeldSeatsCheck {
  return {
    pricedSeatIds: [31, 32],
    heldSeatIds: [32, 31],
    seatTypes: new Map([
      [31, NORMAL],
      [32, NORMAL],
    ]),
    ticketTypeId: NORMAL,
    mapTyped: true,
    ...o,
  };
}

describe('heldSeatsMatch (US-DISC-04)', () => {
  it('accepts holds on exactly the priced seats, of the order’s type', () => {
    expect(heldSeatsMatch(check({}))).toBe(true);
  });

  it('accepts untyped seats under any type (a map from before rows had types)', () => {
    expect(
      heldSeatsMatch(
        check({
          seatTypes: new Map([
            [31, null],
            [32, null],
          ]),
          ticketTypeId: VIP,
          mapTyped: false,
        }),
      ),
    ).toBe(true);
  });

  it('refuses an untyped seat once the map gives seats types (US-EVT-05)', () => {
    expect(
      heldSeatsMatch(
        check({
          seatTypes: new Map([
            [31, NORMAL],
            [32, null],
          ]),
        }),
      ),
    ).toBe(false);
  });

  it('refuses holds on other seats than the ones priced — a VIP seat held, a Normal one priced', () => {
    expect(
      heldSeatsMatch(check({ pricedSeatIds: [31], heldSeatIds: [15] })),
    ).toBe(false);
  });

  it('refuses holds on fewer or more seats than were priced', () => {
    expect(heldSeatsMatch(check({ heldSeatIds: [31] }))).toBe(false);
    expect(heldSeatsMatch(check({ heldSeatIds: [31, 32, 33] }))).toBe(false);
    expect(heldSeatsMatch(check({ heldSeatIds: [] }))).toBe(false);
  });

  it('refuses a priced seat of another ticket type', () => {
    expect(
      heldSeatsMatch(
        check({
          seatTypes: new Map([
            [31, NORMAL],
            [32, VIP],
          ]),
        }),
      ),
    ).toBe(false);
  });

  it('refuses a priced seat the map no longer has', () => {
    expect(heldSeatsMatch(check({ seatTypes: new Map([[31, NORMAL]]) }))).toBe(
      false,
    );
  });
});
