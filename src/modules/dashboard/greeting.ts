import { BANGKOK_OFFSET_MS, DAY_MS } from '../../common/time/bangkok';

/** The two languages the product speaks (US-DASH-01/13). */
export type Language = 'en' | 'th';

const HOUR_MS = 60 * 60 * 1000;
/** Bangkok-local hours the day turns over at. */
const AFTERNOON_FROM = 12;
const EVENING_FROM = 18;

type PartOfDay = 'morning' | 'afternoon' | 'evening';

const GREETINGS: Record<Language, Record<PartOfDay, string>> = {
  en: {
    morning: 'Good morning',
    afternoon: 'Good afternoon',
    evening: 'Good evening',
  },
  th: {
    morning: 'สวัสดีตอนเช้า',
    afternoon: 'สวัสดีตอนบ่าย',
    evening: 'สวัสดีตอนเย็น',
  },
};

/** Thai addresses people by given name with the honorific "คุณ". */
const ADDRESS: Record<Language, (name: string) => string> = {
  en: (name) => `, ${name}`,
  th: (name) => ` คุณ${name}`,
};

/**
 * The home screen's greeting (US-DASH-01).
 *
 * The part of day is BANGKOK's, never the server's or the device's: an
 * organizer in Bangkok opening this at 09:00 is greeted "good morning" whether
 * the process runs in UTC, and a device travelling abroad does not change what
 * time it is where the events are.
 */
export function greetingFor(
  now: Date,
  name: string,
  language: Language,
): string {
  const greeting = GREETINGS[language][partOfDay(now)];
  const trimmed = name.trim();
  return trimmed ? `${greeting}${ADDRESS[language](trimmed)}` : greeting;
}

function partOfDay(now: Date): PartOfDay {
  const hour = bangkokHour(now);
  if (hour >= EVENING_FROM) return 'evening';
  if (hour >= AFTERNOON_FROM) return 'afternoon';
  return 'morning';
}

/** The Bangkok wall-clock hour (0–23) for a UTC instant. */
function bangkokHour(instant: Date): number {
  const shifted = instant.getTime() + BANGKOK_OFFSET_MS;
  return Math.floor((shifted % DAY_MS) / HOUR_MS);
}
