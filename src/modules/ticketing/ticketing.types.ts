import type { ticketTypes } from '../../db/schema';

export type TicketRow = typeof ticketTypes.$inferSelect;
export type NewTicketValues = typeof ticketTypes.$inferInsert;
export type TicketStatus = TicketRow['status'];
export type AdmissionType = TicketRow['admissionType'];

/**
 * Note there is no `status` here: availability is derived from the sales window
 * and the inventory (US-TKT-01/03), never asserted by the caller. Pause/Resume
 * are their own endpoints.
 */
export interface CreateTicketInput {
  name: string;
  isFree?: boolean;
  priceSatang?: number;
  total?: number;
  admissionType?: AdmissionType;
  minPerOrder?: number;
  maxPerOrder?: number;
  salesStartAt?: Date | null;
  salesEndAt?: Date | null;
}

export interface UpdateTicketInput {
  name?: string;
  isFree?: boolean;
  priceSatang?: number;
  total?: number;
  admissionType?: AdmissionType;
  minPerOrder?: number;
  maxPerOrder?: number;
  salesStartAt?: Date | null;
  salesEndAt?: Date | null;
  version?: number;
}

/**
 * What became of a tier on delete (US-TKT-05): erased outright when it never
 * sold, or retired so existing holders keep valid tickets.
 */
export interface DeleteTicketResult {
  outcome: 'removed' | 'retired';
}

/** Filters for the cross-event inventory list (US-TKT-04). */
export interface ListTicketsQuery {
  page?: number;
  limit?: number;
  status?: TicketStatus;
  eventId?: string;
  search?: string;
}

/** How the repository is asked for a page of tiers. */
export interface SearchTicketsOptions {
  limit: number;
  offset: number;
  status?: TicketStatus;
  eventId?: string;
  search?: string;
  /** Events whose name matched the search — their tiers match too. */
  eventIds?: string[];
}

/** One live count per availability state — the list's tab badges. */
export type TicketStatusCounts = Record<TicketStatus, number>;
