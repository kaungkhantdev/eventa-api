import { greetingFor } from './greeting';

/** 07:00 in Bangkok is 00:00 UTC — the offset is where these tests bite. */
const utc = (iso: string) => new Date(iso);

describe('Home greeting (US-DASH-01)', () => {
  it('greets by name in English', () => {
    const greeting = greetingFor(utc('2026-08-07T03:00:00Z'), 'Anan', 'en');
    expect(greeting).toBe('Good morning, Anan');
  });

  it('greets by name in Thai', () => {
    const greeting = greetingFor(utc('2026-08-07T03:00:00Z'), 'อนันต์', 'th');
    expect(greeting).toBe('สวัสดีตอนเช้า คุณอนันต์');
  });

  describe('the part of day is BANGKOK time, not the device’s', () => {
    it('is morning at 09:00 Bangkok even though UTC says 02:00', () => {
      expect(greetingFor(utc('2026-08-07T02:00:00Z'), 'A', 'en')).toMatch(
        /morning/,
      );
    });

    it('is afternoon at 14:00 Bangkok, which is 07:00 UTC', () => {
      expect(greetingFor(utc('2026-08-07T07:00:00Z'), 'A', 'en')).toMatch(
        /afternoon/,
      );
    });

    it('is evening at 20:00 Bangkok, which is 13:00 UTC', () => {
      expect(greetingFor(utc('2026-08-07T13:00:00Z'), 'A', 'en')).toMatch(
        /evening/,
      );
    });

    it('is still evening just before midnight Bangkok — 16:59 UTC', () => {
      expect(greetingFor(utc('2026-08-07T16:59:00Z'), 'A', 'en')).toMatch(
        /evening/,
      );
    });

    it('turns to morning at midnight Bangkok — 17:00 UTC the day before', () => {
      // The rollover is the case a naive `getHours()` gets wrong on a UTC server.
      expect(greetingFor(utc('2026-08-07T17:00:00Z'), 'A', 'en')).toMatch(
        /morning/,
      );
    });

    it('is afternoon from exactly 12:00 Bangkok', () => {
      expect(greetingFor(utc('2026-08-07T05:00:00Z'), 'A', 'en')).toMatch(
        /afternoon/,
      );
    });

    it('is evening from exactly 18:00 Bangkok', () => {
      expect(greetingFor(utc('2026-08-07T11:00:00Z'), 'A', 'en')).toMatch(
        /evening/,
      );
    });
  });

  it('greets someone with no name without a dangling comma', () => {
    expect(greetingFor(utc('2026-08-07T03:00:00Z'), '', 'en')).toBe(
      'Good morning',
    );
  });

  it('trims a padded name rather than greeting a space', () => {
    expect(greetingFor(utc('2026-08-07T03:00:00Z'), '  Anan  ', 'en')).toBe(
      'Good morning, Anan',
    );
  });
});
