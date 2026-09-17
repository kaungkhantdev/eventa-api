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
