import {
  DATE_PAST,
  END_BEFORE_START,
  MIN_TITLE,
  PHONE_LOCATION,
  TITLE_REQUIRED,
  assertSchedulable,
  placeOf,
} from './meeting-schedule';

const NOW = new Date('2026-08-07T09:00:00Z'); // 16:00 Bangkok, 7 Aug

const input = (o: Record<string, unknown> = {}) => ({
  title: 'Venue walkthrough',
  date: '2026-08-10',
  startTime: '09:00',
  endTime: '10:00',
  mode: 'Video' as const,
  ...o,
});

const fails = (o: Record<string, unknown>, message: string) => {
  expect(() => assertSchedulable(input(o), NOW)).toThrow(message);
};

describe('Scheduling rules (US-MTG-03)', () => {
  it('accepts a well-formed future meeting', () => {
    expect(() => assertSchedulable(input(), NOW)).not.toThrow();
  });

  it('accepts a meeting later TODAY', () => {
    expect(() =>
      assertSchedulable(input({ date: '2026-08-07' }), NOW),
    ).not.toThrow();
  });

  it('refuses a date in the past, saying so', () => {
    fails({ date: '2026-08-06' }, DATE_PAST);
  });

  it('judges "past" by the BANGKOK day, not the server’s', () => {
    // 17:00 UTC is already the 8th in Bangkok, so the 7th is yesterday.
    expect(() =>
      assertSchedulable(
        input({ date: '2026-08-07' }),
        new Date('2026-08-07T17:00:00Z'),
      ),
    ).toThrow(DATE_PAST);
  });

  it('refuses a blank title', () => {
    fails({ title: '   ' }, TITLE_REQUIRED);
  });

  it(`refuses a title shorter than ${MIN_TITLE} characters`, () => {
    fails({ title: 'a' }, TITLE_REQUIRED);
  });

  it('refuses an end time equal to the start', () => {
    fails({ startTime: '09:00', endTime: '09:00' }, END_BEFORE_START);
  });

  it('refuses an end time before the start', () => {
    fails({ startTime: '10:00', endTime: '09:00' }, END_BEFORE_START);
  });

  it('compares times by the clock, not as strings', () => {
    // '9:00' vs '10:00' sorts wrong lexically; 09:00 → 10:00 must be valid.
    expect(() =>
      assertSchedulable(input({ startTime: '09:00', endTime: '10:00' }), NOW),
    ).not.toThrow();
  });
});

describe('Where a meeting takes place (US-MTG-03/05)', () => {
  it('gives a video meeting no location — the link is the place', () => {
    expect(placeOf('Video', 'QSNCC Hall 2')).toEqual({
      location: null,
      needsLink: true,
    });
  });

  it('shows the related event’s venue for an in-person meeting', () => {
    expect(placeOf('In person', 'QSNCC Hall 2')).toEqual({
      location: 'QSNCC Hall 2',
      needsLink: false,
    });
  });

  it('says "Phone call" for a phone meeting, ignoring any venue', () => {
    expect(placeOf('Phone', 'QSNCC Hall 2')).toEqual({
      location: PHONE_LOCATION,
      needsLink: false,
    });
  });

  it('leaves an in-person meeting with no event unlocated rather than blank-guessing', () => {
    expect(placeOf('In person', null).location).toBeNull();
  });

  it('drops the link when a video meeting becomes in person (US-MTG-05)', () => {
    // The Meet link must not survive the mode change, or the guest is given a
    // call to join for a meeting that is now in a room.
    expect(placeOf('In person', 'QSNCC Hall 2').needsLink).toBe(false);
  });
});
