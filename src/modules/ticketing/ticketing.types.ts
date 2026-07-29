import type { ticketTypes } from '../../db/schema';

export type TicketRow = typeof ticketTypes.$inferSelect;
export type NewTicketValues = typeof ticketTypes.$inferInsert;
export type TicketStatus = TicketRow['status'];
export type AdmissionType = TicketRow['admissionType'];

export interface CreateTicketInput {
  name: string;
  isFree?: boolean;
  priceSatang?: number;
  total?: number;
  admissionType?: AdmissionType;
  status?: TicketStatus;
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
  status?: TicketStatus;
  minPerOrder?: number;
  maxPerOrder?: number;
  salesStartAt?: Date | null;
  salesEndAt?: Date | null;
  version?: number;
}
