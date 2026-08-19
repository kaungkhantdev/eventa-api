import type { authSessions } from '../../db/schema';

export type SessionRow = typeof authSessions.$inferSelect;

/** One row of the "where am I signed in" list (US-SET-04 / US-ACC-09). */
export interface SessionView {
  id: string;
  device: string;
  ipAddress: string | null;
  signedInAt: Date;
  expiresAt: Date;
  isCurrent: boolean;
}
