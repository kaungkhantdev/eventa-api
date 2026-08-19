import type { issuedTicketStatusEnum } from '../../db/schema';

export type IssuedTicketStatus =
  (typeof issuedTicketStatusEnum.enumValues)[number];

/** One confirmed registration (an order) as the My Events list needs it. */
export interface MyRegistrationRow {
  orderId: string;
  reference: string;
  eventId: string;
  eventSlug: string;
  eventName: string;
  startAt: Date;
  endAt: Date | null;
  timezone: string;
  venueName: string | null;
  city: string | null;
  isOnline: boolean;
  coverImage: string | null;
  ticketTypeName: string | null;
  ticketCount: number;
  /** True once any of the order's tickets was scanned at the door (E8). */
  attended: boolean;
}

/** One issued ticket with everything its pass prints (US-DISC-07). */
export interface TicketPassRow {
  id: string;
  orderId: string;
  orderReference: string;
  qrToken: string;
  status: IssuedTicketStatus;
  holderName: string | null;
  ticketLabel: string | null;
  eventName: string;
  eventSlug: string;
  startAt: Date;
  timezone: string;
  venueName: string | null;
  city: string | null;
  isOnline: boolean;
  seatSection: string | null;
  seatRow: string | null;
  seatNumber: string | null;
  /** Ticket ids of the whole order, in issue order — positions the admission no. */
  siblingTicketIds: string[];
}
