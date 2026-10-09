import type {
  checkInMethodEnum,
  scanOutcomeEnum,
  issuedTicketStatusEnum,
} from '../../db/schema';

export type CheckInMethod = (typeof checkInMethodEnum.enumValues)[number];
export type ScanOutcome = (typeof scanOutcomeEnum.enumValues)[number];
type TicketStatus = (typeof issuedTicketStatusEnum.enumValues)[number];

/** The slice of a ticket the door needs to decide whether to admit it. */
export interface AdmissibleTicket {
  id: string;
  eventId: string;
  attendeeId: number | null;
  holderName: string | null;
  ticketLabel: string | null;
  status: TicketStatus;
}

/** Everything one admission writes. */
export interface AdmitInput {
  organizationId: number;
  eventId: string;
  ticketId: string;
  attendeeId: number | null;
  method: CheckInMethod;
  checkedInBy: string;
  stationId: string | null;
  /**
   * Digest of the code presented, for the `scan_attempts` row written in the
   * same transaction; null when nobody presented one (a manual admission).
   */
  tokenFingerprint: string | null;
  now: Date;
}

/**
 * What the door was holding when it decided — everything a scan needs except
 * the outcome and the ticket, which the decision itself produces.
 */
export interface ScanContext {
  method: CheckInMethod;
  stationId: string | null;
  /** Null when no code was presented at all; never the raw token. */
  tokenFingerprint: string | null;
}

/**
 * One row of the append-only scan ledger (`scan_attempts`).
 *
 * Every outcome writes one, admissions included — a table of refusals alone
 * has no denominator, and the refusal rate is what tells a busy door from a
 * broken one.
 */
export interface ScanAttemptRecord extends ScanContext {
  organizationId: number;
  eventId: string;
  outcome: ScanOutcome;
  /** Null for an unrecognised code, which has no ticket to point at. */
  ticketId: string | null;
  /**
   * Which event the presented pass actually belonged to, recorded only when it
   * differs from `eventId` — the one thing `wrong_event` is about.
   */
  ticketEventId: string | null;
  scannedBy: string;
  scannedAt: Date;
}

/** What the single-statement admit reported back. */
export interface AdmitOutcome {
  checkedInAt: Date;
  /** False when this scan found them already inside. */
  inserted: boolean;
}

/** What the door shows after reading a code. */
export interface ScanResult {
  outcome: ScanOutcome;
  ticketId: string | null;
  holderName: string | null;
  ticketLabel: string | null;
  checkedInAt: Date | null;
}

/** Someone on the roll is either already inside, or still expected. */
export type AttendanceStatus = 'checked_in' | 'expected';

/** What the roll was asked for. */
export interface AttendanceQuery {
  eventId: string;
  page: number;
  limit: number;
  status?: AttendanceStatus;
  search?: string;
  sort: 'name' | 'recent';
}

/** One person on the roll. */
export interface AttendanceRow {
  ticketId: string;
  holderName: string | null;
  /** The attendee's address, or the buyer's when the ticket names nobody. */
  attendeeEmail: string | null;
  ticketLabel: string | null;
  ticketTypeName: string;
  status: AttendanceStatus;
  checkedInAt: Date | null;
  method: CheckInMethod | null;
}

/** The room, counted across the whole event rather than the page on screen. */
export interface AttendanceCounts {
  total: number;
  checkedIn: number;
  expected: number;
  /** Already inside, and arrived before the event's start time. */
  onSite: number;
  /** Already inside, but walked in after it had started. */
  late: number;
}
