import {
  CHECKIN_GRACE_AFTER_END_MS,
  CHECKIN_OPENS_BEFORE_START_MS,
  isCheckInOpen,
} from './check-in-window';

const START = new Date('2026-09-01T10:00:00Z');
const END = new Date('2026-09-01T18:00:00Z');
const open = (now: Date, o: Record<string, unknown> = {}) =>
  isCheckInOpen({ status: 'live', startAt: START, endAt: END, ...o }, now);

describe('Check-in window (US-REG-11/12)', () => {
  it('opens ahead of the start so a queue can be admitted early', () => {
    const justBefore = new Date(
      START.getTime() - CHECKIN_OPENS_BEFORE_START_MS + 1,
    );
    expect(open(justBefore)).toBe(true);
  });

  it('is shut before the doors-open moment', () => {
    const tooEarly = new Date(
      START.getTime() - CHECKIN_OPENS_BEFORE_START_MS - 1,
    );
    expect(open(tooEarly)).toBe(false);
  });

  it('is open throughout the event', () => {
    expect(open(new Date('2026-09-01T14:00:00Z'))).toBe(true);
  });

  it('stays open for a grace period after the end', () => {
    const late = new Date(END.getTime() + CHECKIN_GRACE_AFTER_END_MS - 1);
    expect(open(late)).toBe(true);
  });

  it('shuts once the grace period has passed', () => {
    const tooLate = new Date(END.getTime() + CHECKIN_GRACE_AFTER_END_MS + 1);
    expect(open(tooLate)).toBe(false);
  });

  it('measures the grace from the START when an event has no end time', () => {
    // A single-session event often has no endAt; without this it would be
    // un-checkinable the moment it began.
    const afterStart = new Date(START.getTime() + 60_000);
    expect(open(afterStart, { endAt: null })).toBe(true);
  });

  it('refuses a draft event — nobody can arrive at something unpublished', () => {
    expect(open(new Date('2026-09-01T14:00:00Z'), { status: 'draft' })).toBe(
      false,
    );
  });

  it('refuses a cancelled event', () => {
    expect(
      open(new Date('2026-09-01T14:00:00Z'), { status: 'cancelled' }),
    ).toBe(false);
  });

  it('refuses a completed event even inside the grace window', () => {
    expect(
      open(new Date('2026-09-01T18:30:00Z'), { status: 'completed' }),
    ).toBe(false);
  });
});
