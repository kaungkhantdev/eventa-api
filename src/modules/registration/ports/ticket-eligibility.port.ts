import { ticketStatusEnum } from '../../../db/schema';

/** The sellable status of a ticket tier (derived from the `ticket_status` enum). */
export type TicketStatus = (typeof ticketStatusEnum.enumValues)[number];

/**
 * The checkout's read-only view of a ticket tier's sales eligibility — just the
 * fields the reservation/checkout layer needs to decide whether a buyer may hold
 * or purchase it. The Registration context depends on this abstraction (DIP) so it
 * never reads the Ticketing module's tables; Ticketing binds the concrete adapter.
 */
export interface TicketEligibility {
  status: TicketStatus;
  /** Sales open at/after this instant when set; open-ended when null. */
  salesStartAt: Date | null;
  /** Sales close after this instant when set; open-ended when null. */
  salesEndAt: Date | null;
  minPerOrder: number;
  maxPerOrder: number;
}

/**
 * Registration-owned port answering "may this tier be sold right now, and in what
 * per-order quantity?" without reaching into `ticket_types`. The Ticketing module
 * provides the implementation (`TicketEligibilityAdapter`) and exports this token.
 */
export abstract class TicketEligibilityPort {
  /** Sales info for one tier scoped to its event, or null if it does not exist. */
  abstract getEligibility(
    organizationId: number,
    eventId: string,
    ticketTypeId: string,
  ): Promise<TicketEligibility | null>;

  /** Sales info for many tiers by id, keyed by id (missing ids are absent). */
  abstract getEligibilityByIds(
    organizationId: number,
    ticketTypeIds: string[],
  ): Promise<Map<string, TicketEligibility>>;
}
