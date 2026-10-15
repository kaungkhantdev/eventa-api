/**
 * The slug of the ONE platform-owned organization that holds every attendee
 * account (US-DISC-08).
 *
 * Organizer accounts are scoped to the workspace they belong to — `users` is
 * unique on (organization_id, email, persona) and organizer login names an
 * `orgSlug`. Attendees are different: their tickets, receipts and saved events
 * span every organizer on the platform, so scoping their LOGIN to one workspace
 * would give one person a separate account per organizer and make "all my
 * tickets in one place" impossible. Instead, every `persona = 'attendee'` user
 * lives in this seeded organization (migration 0026), and attendee sign-in
 * resolves here without — and never accepts — an orgSlug.
 *
 * Per-organizer `attendees` CRM rows still exist in each workspace and link
 * back to the one platform user via `users.attendee_id`.
 */
export const PLATFORM_ORG_SLUG = 'eventa';

/**
 * What every attendee-account flow says when that organization is missing.
 * It is seeded by migration 0026, so its absence is a broken deployment —
 * said out loud, and in the same words whichever flow (sign-up, or an account
 * from a booking) runs into it.
 */
export const ATTENDEE_ACCOUNTS_UNAVAILABLE =
  'Attendee accounts are unavailable right now. Please try again later.';
