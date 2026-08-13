import {
  LIVE_EVENT_STATUSES,
  isMaterialChange,
  shouldNotify,
} from './session-change';

const before = {
  day: 'Day 1',
  startTime: '09:00:00',
  endTime: '10:00:00',
  room: 'Hall A',
};

describe('Material session changes (US-PROG-03)', () => {
  it.each([
    ['the day', { day: 'Day 2' }],
    ['the start time', { startTime: '11:00:00' }],
    ['the end time', { endTime: '11:30:00' }],
    ['the room', { room: 'Hall B' }],
  ])('counts a change of %s as material', (_label, change) => {
    expect(isMaterialChange(before, { ...before, ...change })).toBe(true);
  });

  it.each([
    ['the title', { title: 'Renamed' }],
    ['the description', { description: 'Longer blurb' }],
    ['the type', { type: 'Panel' }],
    ['the sort order', { sortOrder: 3 }],
  ])('does NOT count a change of %s as material', (_label, change) => {
    // The story names day, time and room. Renaming a session is not a reason
    // to mail everyone who bookmarked it.
    expect(isMaterialChange(before, { ...before, ...change })).toBe(false);
  });

  it('is not a change when nothing actually moved', () => {
    expect(isMaterialChange(before, { ...before })).toBe(false);
  });

  it('treats a cleared end time as material', () => {
    expect(isMaterialChange(before, { ...before, endTime: null })).toBe(true);
  });

  it('ignores a no-op rewrite of the same values', () => {
    expect(isMaterialChange(before, { ...before, room: 'Hall A' })).toBe(false);
  });
});

describe('Whether attendees are told (US-PROG-03)', () => {
  const moved = { ...before, room: 'Hall B' };

  it('sends nothing by DEFAULT, even for a material change on a live event', () => {
    // "by default no message is sent" — the flag must be opt-in.
    expect(shouldNotify(before, moved, 'live', undefined)).toBe(false);
  });

  it('sends when the organizer asks, the change is material, and the event is live', () => {
    expect(shouldNotify(before, moved, 'live', true)).toBe(true);
  });

  it('sends nothing when the organizer asks but nothing material moved', () => {
    const renamed = { ...before, title: 'Renamed' };
    expect(shouldNotify(before, renamed, 'live', true)).toBe(false);
  });

  it.each(['draft', 'completed', 'cancelled'])(
    'sends nothing on a %s event — nobody is watching a schedule that is not running',
    (status) => {
      expect(shouldNotify(before, moved, status, true)).toBe(false);
    },
  );

  it.each([...LIVE_EVENT_STATUSES])('sends on a %s event', (status) => {
    expect(shouldNotify(before, moved, status, true)).toBe(true);
  });

  it('never sends when the organizer explicitly declines', () => {
    expect(shouldNotify(before, moved, 'live', false)).toBe(false);
  });
});
