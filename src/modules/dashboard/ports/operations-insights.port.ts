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

  /**
   * Whether anything is on sale at all — the setup checklist's fourth step.
   * An existence check, not a count: the question is "has this been done", and
   * a number would invite the caller to render one that means nothing.
   */
  abstract hasTicketType(organizationId: number): Promise<boolean>;
}

export interface EventReach {
  /** Events yet to start — a headline card (US-DASH-08). */
  upcoming: number;
  /** Seats sold across live events, over seats offered. Null when none exist. */
  capacityFilledPercent: number | null;
}

/** How far the event side of setup has got (US-DASH-01, the first-run path). */
export interface EventMilestones {
  /** Anything at all, including a draft — step three is "save as a draft". */
  created: boolean;
  /** Anything with a live public page — where registrations come from. */
  published: boolean;
}

export abstract class EventInsightsPort {
  abstract reach(organizationId: number): Promise<EventReach>;

  /**
   * Two existence checks in one round trip, because they are read together and
   * a workspace that has published necessarily created — asking separately
   * invites a caller to render a state that cannot exist.
   */
  abstract setupMilestones(organizationId: number): Promise<EventMilestones>;
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
