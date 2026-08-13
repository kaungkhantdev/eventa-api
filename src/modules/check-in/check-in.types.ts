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
  now: Date;
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
