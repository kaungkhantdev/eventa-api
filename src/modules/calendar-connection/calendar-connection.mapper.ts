import type { CalendarConnectionDto } from './dto/calendar-connection.dto';
import type {
  CalendarConnectionRow,
  CalendarConnectionStatus,
} from './calendar-connection.types';

/** The statuses that have an account and a date worth showing. */
const HAS_FACTS: ReadonlySet<CalendarConnectionStatus> = new Set([
  'connected',
  'expired',
]);

/**
 * Row → response (US-MTG-08).
 *
 * `configured` false overrides whatever is stored: a row left connected under
 * a Google client this server no longer has cannot sync anything. The account
 * address goes only to callers who may manage integrations (NFR-PDPA-04): the
 * Meetings header for Organizers and Staff needs the status, not the address.
 */
export function toCalendarConnectionDto(
  row: CalendarConnectionRow | null,
  configured: boolean,
  canSeeAccount: boolean,
): CalendarConnectionDto {
  const status = statusOf(row, configured);
  const facts = row !== null && HAS_FACTS.has(status);
  return {
    provider: 'google',
    status,
    accountEmail: facts && canSeeAccount ? row.accountEmail : null,
    connectedAt: facts ? (row.connectedAt?.toISOString() ?? null) : null,
  };
}

function statusOf(
  row: CalendarConnectionRow | null,
  configured: boolean,
): CalendarConnectionStatus {
  if (!configured) return 'not_configured';
  return row?.status ?? 'disconnected';
}
