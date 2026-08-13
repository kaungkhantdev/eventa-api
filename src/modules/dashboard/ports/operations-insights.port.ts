/**
 * Inventory running low, for the selling-fast alert (US-DASH-06/11).
 * Ticketing owns what "nearly sold out" means — the dashboard only counts.
 */
export abstract class InventoryInsightsPort {
  abstract countSellingOut(organizationId: number): Promise<number>;
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
