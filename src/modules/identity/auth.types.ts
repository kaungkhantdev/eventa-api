import type { organizations, users } from '../../db/schema';

/** Name of the httpOnly session cookie (value = auth_sessions.id). */
export const SESSION_COOKIE = 'eventa_session';

/** Session lifetime. */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export type UserRow = typeof users.$inferSelect;
export type OrganizationRow = typeof organizations.$inferSelect;

/** Resolved principal + tenant, attached to the request by SessionAuthGuard. */
export interface AuthContext {
  user: UserRow;
  org: OrganizationRow;
  sessionId: string;
}
