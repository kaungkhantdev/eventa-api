import { HttpStatus } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain.exception';
import {
  ALREADY_CANCELLED,
  ALREADY_SENT,
  TOO_FAR,
  TOO_SOON,
  assertSchedulable,
  unchangeableBecause,
} from './announcement-schedule';

const NOW = new Date('2026-08-01T02:00:00.000Z');
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);

function refusal(run: () => void): DomainException {
  try {
    run();
  } catch (err) {
    return err as DomainException;
  }
  throw new Error('expected a refusal');
}

describe('when an announcement may be scheduled for (US-MSG-04/05)', () => {
  it('accepts a time comfortably in the future', () => {
    expect(() => assertSchedulable(at(10 * MINUTE), NOW)).not.toThrow();
  });

  it('refuses a time that has already passed, on the sendAt field', () => {
    const err = refusal(() => assertSchedulable(at(-MINUTE), NOW));

    expect(err.getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    expect(err.errors).toEqual([{ field: 'sendAt', message: TOO_SOON }]);
  });

  it('refuses a time too close to change your mind about', () => {
    // A "scheduled" send four minutes out leaves no time to catch a mistake —
    // which is the whole reason US-MSG-05 exists. That is a send-now.
    const err = refusal(() => assertSchedulable(at(4 * MINUTE), NOW));

    expect(err.errors?.[0].field).toBe('sendAt');
  });

  it('refuses a time more than a year out', () => {
    // Almost certainly a mistyped year; nobody should find a forgotten
    // broadcast going out to an event's attendees thirteen months later.
    const err = refusal(() => assertSchedulable(at(366 * DAY), NOW));

    expect(err.errors).toEqual([{ field: 'sendAt', message: TOO_FAR }]);
  });

  it('accepts exactly the shortest lead', () => {
    expect(() => assertSchedulable(at(5 * MINUTE), NOW)).not.toThrow();
  });
});

describe('why a settled announcement cannot be changed (US-MSG-05)', () => {
  it('says it has already started sending', () => {
    const err = unchangeableBecause('sent');

    expect(err.getStatus()).toBe(HttpStatus.CONFLICT);
    expect(err.message).toBe(ALREADY_SENT);
  });

  it('says it was cancelled', () => {
    const err = unchangeableBecause('cancelled');

    expect(err.getStatus()).toBe(HttpStatus.CONFLICT);
    expect(err.message).toBe(ALREADY_CANCELLED);
  });
});
