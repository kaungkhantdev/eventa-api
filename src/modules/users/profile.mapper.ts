import { ProfileResponseDto } from './dto/profile-response.dto';
import type { ProfileRow } from './users.types';

/**
 * Row → profile response (US-SET-01, US-DISC-11). Extracted from
 * `profile.service.ts` once the phone flow became a second caller: two
 * services returning the same DTO from two hand-rolled mappings is how one of
 * them ends up omitting a field nobody notices is missing.
 *
 * Note what is NOT here: no code hash, no expiry, no attempt count. Those live
 * in `PhoneChallengeRow`, which this mapper cannot see.
 */
export function toProfileResponse(row: ProfileRow): ProfileResponseDto {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    pendingEmail: row.pendingEmail,
    emailVerified: row.pendingEmail === null,
    phone: row.phone,
    // Not `pendingPhone === null`: a number that predates US-DISC-11 sits in
    // `phone` with nothing pending and has still never been proven. See the
    // column comment on `users.phone_verified_at`.
    phoneVerified: row.phoneVerifiedAt !== null,
    pendingPhone: row.pendingPhone,
    timezone: row.timezone,
    locale: row.locale,
    avatarUrl: row.avatarUrl,
    city: row.city,
    dateOfBirth: row.dateOfBirth,
    bio: row.bio,
    displayCurrency: row.displayCurrency,
  };
}
