import type { Persona } from '../auth/auth.types';

/** What re-verification needs from the account row (never leaves the module). */
export interface AccountRow {
  id: string;
  organizationId: number;
  persona: Persona;
  name: string;
  email: string;
  /** Null for social-sign-in accounts — they must set a password to delete. */
  passwordHash: string | null;
}

/** One upcoming, paid, non-refunded order — money the deleter walks away from. */
export interface UpcomingPaidOrderRow {
  reference: string;
  eventName: string;
  startAt: Date;
  ticketCount: number;
  totalSatang: number;
}
