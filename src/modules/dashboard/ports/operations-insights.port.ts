/** A tier close to selling out, with the event it belongs to (US-DASH-11). */
export interface SellingFastTier {
  ticketTypeId: string;
  ticketTypeName: string;
  eventId: string;
  eventName: string;
  /** Allocation minus sold. Never negative. */
  remaining: number;
  total: number;
}

/**
 * Inventory running low, for the selling-fast alert and panel (US-DASH-06/11).
 * Ticketing owns what "nearly sold out" means — the dashboard only counts and
 * renders. Both answers come from the one definition, so home's alert and the
 * dashboard's list can never disagree about which tiers are at risk.
 */
export abstract class InventoryInsightsPort {
  abstract countSellingOut(organizationId: number): Promise<number>;

  /** The scarcest first — at most `limit`, for a preview panel. */
  abstract sellingFast(
    organizationId: number,
    limit: number,
  ): Promise<SellingFastTier[]>;
}

export interface EventReach {
  /** Events yet to start — a headline card (US-DASH-08). */
  upcoming: number;
  /** Seats sold across live events, over seats offered. Null when none exist. */
  capacityFilledPercent: number | null;
}

export abstract class EventInsightsPort {
  abstract reach(organizationId: number): Promise<EventReach>;
}

export interface CheckInRate {
  admitted: number;
  expected: number;
}

/**
 * Attendance for the check-in-rate card (US-DASH-08). Deliberately two raw
 * numbers rather than a percentage: a rate over zero expected attendees is not
 * 0%, it is "no data", and only the caller holding both figures can say so.
 */
export abstract class CheckInInsightsPort {
  abstract rateForPeriod(
    organizationId: number,
    period: { from: Date; to: Date },
  ): Promise<CheckInRate>;
}
