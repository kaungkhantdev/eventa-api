import type { orderStatusEnum, paymentStatusEnum } from '../../db/schema';

export type RegistrationStatus = (typeof orderStatusEnum.enumValues)[number];
export type RegistrationPayment = (typeof paymentStatusEnum.enumValues)[number];

/** One row of the registrations queue (US-REG-01). */
export interface RegistrationRow {
  id: string;
  reference: string;
  eventId: string;
  eventName: string;
  buyerName: string;
  buyerEmail: string;
  status: RegistrationStatus;
  paymentStatus: RegistrationPayment;
  seats: number;
  /**
   * The tier(s) bought, comma-separated for a mixed order, or null when the
   * tier has since been deleted. Not gated by finance access: what someone
   * bought is not the same privilege as what they paid.
   */
  ticketTypeName: string | null;
  totalSatang: number;
  registeredAt: Date;
  confirmedAt: Date | null;
  rejectedAt: Date | null;
  cancelledAt: Date | null;
  /** Place in line for its ticket, 1 = next; null unless waitlisted (US-REG-04). */
  waitlistPosition: number | null;
  /** When a waitlist offer lapses; set once a seat has been offered. */
  offerExpiresAt: Date | null;
  /** When it started waiting for the organizer's approval (US-REG-02). */
  approvalRequestedAt: Date | null;
}

/** What the caller may see and do, resolved once per request. */
export interface QueueAccess {
  /** Holds finance access — amounts are masked otherwise (US-REG-01). */
  canViewMoney: boolean;
  /** Holds the refund permission — a rejection that refunds needs it. */
  canRefund: boolean;
}

export interface RegistrationFilters {
  page: number;
  limit: number;
  status?: RegistrationStatus;
  eventId?: string;
  search?: string;
}

/**
 * Live tab totals across the whole filtered queue.
 *
 * One field per member of the `order_status` enum, derived from it rather than
 * typed out: a status added to the column gets a bucket here the moment the
 * migration ships, and the places that have to publish or seed one stop
 * compiling until they do. Five hand-written fields against a six-member enum
 * are how `expired` came to be listed by the queue and counted by nobody.
 */
export interface RegistrationCounts extends Record<RegistrationStatus, number> {
  /**
   * Every row the same filters list, counted — NOT the sum of the fields
   * above. See `tallyByStatus`: a total derived from the rows cannot fall
   * behind the statuses the database holds, and a summed one always can.
   */
  all: number;
}
