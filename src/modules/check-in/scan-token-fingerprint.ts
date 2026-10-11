import { createHash } from 'node:crypto';

/**
 * A non-reversible digest of the code a scanner presented, for the
 * `scan_attempts` ledger (US-REG-12).
 *
 * The ledger deliberately does NOT hold the raw token. `tickets.qr_token` IS
 * the bearer credential — holding that string is the entitlement to walk in,
 * which is why `dto/order-placed.dto.ts` already calls it one — and the ledger
 * is append-only, outlives both the event and the ticket, and is readable by
 * everyone who may work or review a door. Copying live credentials into it
 * would turn a door-incident log into a list of working passes, so an exported
 * or over-shared log would be a set of usable tickets rather than a record of
 * what happened.
 *
 * The digest keeps every question the ledger exists to answer. A recognised
 * code already carries its `ticket_id`, so "was this ticket turned away?" never
 * needed the token; grouping on the digest separates "one damaged pass
 * presented forty times" from "forty different bad codes", which is the
 * difference between a broken ticket and an attack; and "was THIS code
 * presented?" stays a plain lookup, because whoever holds the code can hash it
 * the same way.
 *
 * It is genuinely one-way *here*: `checkout/order-reference.ts` mints a token
 * as 24 characters from a 32-symbol alphabet (~120 bits), so there is no
 * dictionary to walk back through — unlike a digest of something low-entropy,
 * which a hash only pretends to protect. Storing a credential as a digest is
 * also already the house answer, in `api_keys.key_hash` and in
 * `auth-two-factor`'s recovery codes.
 *
 * The FULL digest is kept rather than a truncation like
 * `auth-password-fingerprint`'s sixteen characters: that one only has to match
 * a single known hash, whereas this is a grouping key across a whole night's
 * scans, where a collision would fuse two unrelated bad codes into one
 * "repeatedly refused" story and send someone hunting a counterfeiter who does
 * not exist.
 */
export function fingerprintScanToken(qrToken: string): string {
  return createHash('sha256').update(qrToken).digest('hex');
}
