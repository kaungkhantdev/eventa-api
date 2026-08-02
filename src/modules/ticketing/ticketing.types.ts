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
