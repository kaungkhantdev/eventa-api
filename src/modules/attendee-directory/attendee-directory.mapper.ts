import type { AttendeeEntryDto } from './dto/directory.dto';
import type { AttendeeRow } from './attendee-directory.types';

/** One directory row. `tag` stays null when untagged — the console renders a dash. */
export function toAttendeeEntry(row: AttendeeRow): AttendeeEntryDto {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    company: row.company,
    tag: row.tag,
    firstSeenAt: row.firstSeenAt.toISOString(),
    lastActivityAt: row.lastActivityAt?.toISOString() ?? null,
    eventCount: row.eventCount,
    ticketCount: row.ticketCount,
    checkedInCount: row.checkedInCount,
  };
}
