import { payoutStatusEnum } from '../../db/schema';

/** Derived from the Drizzle enum so the two can never drift apart. */
export type PayoutStatus = (typeof payoutStatusEnum.enumValues)[number];

/** Money on its way to, or already in, the organizer's bank. */
export interface PayoutRow {
  id: number;
  organizationId: number;
  reference: string;
  amountSatang: number;
  currency: string;
  /** A masked descriptor — never an account number. */
  bankAccount: string;
  status: PayoutStatus;
  periodCovered: string | null;
  requestedAt: Date;
  completedAt: Date | null;
  failureReason: string | null;
}

/**
 * The three headline figures (US-FIN-03). All null when no payout account is
 * connected — an unconnected workspace has no balance to speak of, and showing
 * ฿0 would read as "you have earned nothing" rather than "not set up yet".
 */
export interface Balances {
  availableSatang: number | null;
  pendingSatang: number | null;
  paidOutSatang: number | null;
  payoutsConnected: boolean;
}

export interface PayoutFilters {
  page: number;
  limit: number;
  status?: PayoutStatus;
}
