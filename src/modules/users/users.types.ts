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
>;

/** Fields a member may change on their OWN profile. */
export interface UpdateProfileInput {
  name?: string;
  phone?: string | null;
  timezone?: string | null;
  locale?: 'en' | 'th' | null;
  avatarUrl?: string | null;
}
