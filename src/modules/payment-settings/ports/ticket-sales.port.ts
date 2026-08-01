/**
 * What this module needs to know from Ticketing (DIP — the consumer owns the
 * port): whether the workspace actually sells paid tickets. Used only to decide
 * whether turning off the last payment method would strand buyers (US-SET-09).
 */
export abstract class TicketSalesPort {
  abstract hasPaidTickets(organizationId: number): Promise<boolean>;
}
