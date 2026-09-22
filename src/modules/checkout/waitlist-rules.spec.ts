import {
  WAITLIST_CLOSED,
  WAITLIST_RESERVED_SEATING,
  WAITLIST_TICKETS_LEFT,
  canJoinWaitlist,
  confirmsOnOffer,
  hasOpenWaitlist,
  waitlistRefusal,
} from './waitlist-rules';

const OPEN = { waitlistEnabled: true, seatingMode: 'ga' as const };
const SOLD_OUT = { status: 'soldout' as const };

describe('waitlist rules (US-REG-04)', () => {
  it('lets a buyer join once a general-admission ticket sells out', () => {
    expect(canJoinWaitlist(OPEN, SOLD_OUT)).toBe(true);
    expect(waitlistRefusal(OPEN, SOLD_OUT)).toBeNull();
  });

  it('refuses when the organizer has not switched the waitlist on', () => {
    // "With it off, the event simply shows sold out."
    const event = { ...OPEN, waitlistEnabled: false };
    expect(canJoinWaitlist(event, SOLD_OUT)).toBe(false);
    expect(waitlistRefusal(event, SOLD_OUT)).toBe(WAITLIST_CLOSED);
  });

  it('refuses while tickets can still be bought', () => {
    // A waitlist beside tickets on sale would queue somebody for something
    // they could simply have bought.
    expect(waitlistRefusal(OPEN, { status: 'onsale' })).toBe(
      WAITLIST_TICKETS_LEFT,
    );
  });

  it('refuses a ticket that is paused or not on sale yet', () => {
    // Not sold out — withheld. The waitlist is for demand the event cannot
    // meet, not a way round the organizer's own sales window.
    expect(canJoinWaitlist(OPEN, { status: 'paused' })).toBe(false);
    expect(canJoinWaitlist(OPEN, { status: 'scheduled' })).toBe(false);
  });

  it('refuses a reserved-seating event', () => {
    // An offer there would have to be a particular seat, chosen for somebody
    // who is not at the map to choose it.
    const event = { ...OPEN, seatingMode: 'reserved' as const };
    expect(waitlistRefusal(event, SOLD_OUT)).toBe(WAITLIST_RESERVED_SEATING);
  });
});

describe('offering new places to the line (US-REG-04)', () => {
  it('offers them on a general-admission event with the waitlist on', () => {
    expect(hasOpenWaitlist(OPEN)).toBe(true);
  });

  it('offers nobody once the organizer has switched the waitlist off', () => {
    expect(hasOpenWaitlist({ ...OPEN, waitlistEnabled: false })).toBe(false);
  });

  it('offers nobody on a reserved-seating event', () => {
    // A place there is one particular seat, and nobody in line is at the map.
    expect(hasOpenWaitlist({ ...OPEN, seatingMode: 'reserved' })).toBe(false);
  });

  it('confirms a free registration outright, and offers a paid one to pay for', () => {
    // "Free tickets confirm immediately."
    expect(confirmsOnOffer({ totalSatang: 0 })).toBe(true);
    expect(confirmsOnOffer({ totalSatang: 210_000 })).toBe(false);
  });
});
