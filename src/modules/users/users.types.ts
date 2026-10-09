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
  | 'phoneVerifiedAt'
  | 'pendingPhone'
  | 'timezone'
  | 'locale'
  | 'avatarUrl'
  | 'city'
  | 'dateOfBirth'
  | 'bio'
  | 'displayCurrency'
>;

/**
 * The code state behind a pending phone change (US-DISC-11 AC3).
 *
 * Deliberately NOT part of `ProfileRow`: the hash and the attempt count are
 * credential bookkeeping, and the profile projection is what the page and the
 * `/me/profile` response are built from. Keeping them in separate types is
 * what stops a code hash riding along into a DTO by accident.
 */
export type PhoneChallengeRow = Pick<
  typeof users.$inferSelect,
  'pendingPhone' | 'phoneCodeHash' | 'phoneCodeExpiresAt' | 'phoneCodeAttempts'
>;

/** A requested number and the code that will prove it (US-DISC-11 AC3). */
export interface PhoneChallengeInput {
  /** E.164, already normalised — see `toThaiMobileE164`. */
  pendingPhone: string;
  /** SHA-256 of the six digits. The code itself is never written here. */
  codeHash: string;
  expiresAt: Date;
}

/**
 * Fields a member may change on their OWN profile.
 *
 * `phone` is absent, exactly as `email` is: both are contact details that must
 * be proven before Eventa will send to them, so both move through their own
 * endpoint (`POST /me/profile/phone`, `POST /me/profile/email`) rather than
 * through the generic save. A number that could be written here would be used
 * for texts the instant it was typed, which is the hole US-DISC-11 AC3 closes.
 */
export interface UpdateProfileInput {
  name?: string;
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
