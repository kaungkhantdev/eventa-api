import {
  admissionTypeEnum,
  seatingModeEnum,
  ticketStatusEnum,
} from '../../db/schema';

export type SeatingMode = (typeof seatingModeEnum.enumValues)[number];
export type AdmissionType = (typeof admissionTypeEnum.enumValues)[number];
export type TierStatus = (typeof ticketStatusEnum.enumValues)[number];

/** The event as the checkout needs it — resolved through `CheckoutEventPort`. */
export interface CheckoutEvent {
  id: string;
  organizationId: number;
  slug: string;
  name: string;
  startAt: Date;
  endAt: Date | null;
  timezone: string;
  isOnline: boolean;
  onlineNote: string | null;
  venueName: string | null;
  venueAddress: string | null;
  city: string | null;
  coverImage: string | null;
  organizerName: string;
  seatingMode: SeatingMode;
}

/** A sellable tier as the checkout needs it — resolved through `TicketCatalogPort`. */
export interface CheckoutTier {
  id: string;
  name: string;
  priceSatang: number;
  isFree: boolean;
  /** Derived live by the catalog adapter, never the stored column (US-TKT-03). */
  status: TierStatus;
  admissionType: AdmissionType;
  salesStartAt: Date | null;
  salesEndAt: Date | null;
  minPerOrder: number;
  maxPerOrder: number;
  sold: number;
  /** Allocation; `0` means unlimited. */
  total: number;
}

/** One seat offered by the seat map, with the tier that prices it. */
export interface CheckoutSeat {
  id: number;
  section: string | null;
  rowLabel: string | null;
  seatNumber: string;
  ticketTypeId: string | null;
  /** False when sold, blocked, or held by someone else right now. */
  available: boolean;
}

/** The event a checkout action runs against, with its tenant already resolved. */
export interface CheckoutContext {
  event: CheckoutEvent;
}

/** What the attendee picked, once the event's own seating mode has judged it. */
export type CheckoutSelection =
  | { mode: 'reserved'; ticketTypeId: string; seatIds: number[] }
  | { mode: 'ga'; ticketTypeId: string; quantity: number };

/** The raw, unvalidated pick as it arrives from the client. */
export interface SelectionInput {
  ticketTypeId: string;
  quantity?: number;
  seatIds?: number[];
}

/** How many admissions a selection is worth, whichever shape it took. */
export function selectionSize(selection: CheckoutSelection): number {
  return selection.mode === 'reserved'
    ? selection.seatIds.length
    : selection.quantity;
}
