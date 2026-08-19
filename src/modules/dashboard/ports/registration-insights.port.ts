/** One line in the recent-sign-ups feed (US-DASH-02/12). */
export interface RecentRegistration {
  orderId: string;
  attendeeName: string;
  eventName: string;
  ticketTypeName: string | null;
  /** Integer satang. Masked to null by the dashboard when finance is withheld. */
  totalSatang: number;
  paymentStatus: string;
  registeredAt: Date;
}

/** One slice of the ticket-type mix (US-DASH-10). */
export interface TierShare {
  ticketTypeName: string;
  count: number;
}

export interface RegistrationTotals {
  current: number;
  previous: number;
}

/**
 * What the dashboard needs to know about sign-ups, without reading orders.
 *
 * Registrations owns the abstraction's implementation (DIP): the dashboard
 * summarizes, it does not query. Every method is tenant-scoped by its first
 * argument — the dashboard has no way to ask about a workspace that is not the
 * caller's.
 */
export abstract class RegistrationInsightsPort {
  /** Confirmed sign-ups on the given Bangkok calendar day (US-DASH-02). */
  abstract countSince(organizationId: number, since: Date): Promise<number>;

  /** Newest-first, for both the home preview and the dashboard table. */
  abstract recent(
    organizationId: number,
    limit: number,
  ): Promise<RecentRegistration[]>;

  /** Totals for a window and the comparable one before it (US-DASH-08). */
  abstract totalsForPeriod(
    organizationId: number,
    period: { from: Date; to: Date; previousFrom: Date; previousTo: Date },
  ): Promise<RegistrationTotals>;

  /** How the period's registrations split across tiers (US-DASH-10). */
  abstract tierMix(
    organizationId: number,
    period: { from: Date; to: Date },
  ): Promise<TierShare[]>;

  /** Sign-ups awaiting an organizer's decision — an alert (US-DASH-06). */
  abstract countAwaitingDecision(organizationId: number): Promise<number>;
}
