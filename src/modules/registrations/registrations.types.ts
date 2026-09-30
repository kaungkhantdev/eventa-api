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

/** Live tab totals across the whole filtered queue. */
export interface RegistrationCounts {
  pending: number;
  confirmed: number;
  waitlisted: number;
  cancelled: number;
  rejected: number;
}
