import type { users } from '../../db/schema';

/** The profile-relevant projection of a user row (US-SET-01). */
export type ProfileRow = Pick<
  typeof users.$inferSelect,
  | 'id'
  | 'organizationId'
  | 'name'
  | 'email'
  | 'pendingEmail'
  | 'phone'
  | 'timezone'
  | 'locale'
  | 'avatarUrl'
  | 'city'
  | 'dateOfBirth'
  | 'bio'
  | 'displayCurrency'
>;

/** Fields a member may change on their OWN profile. */
export interface UpdateProfileInput {
  name?: string;
  phone?: string | null;
  timezone?: string | null;
  locale?: 'en' | 'th' | null;
  avatarUrl?: string | null;
  city?: string | null;
  /** ISO date (yyyy-mm-dd). */
  dateOfBirth?: string | null;
  bio?: string | null;
  /** Display-only; every charge still settles in THB (US-DISC-12). */
  displayCurrency?: string | null;
}
