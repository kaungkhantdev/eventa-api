import { createHash } from 'node:crypto';

/**
 * A short, non-reversible fingerprint of a password hash. Embedded in reset tokens
 * so a link stops working the moment the password changes — making resets single-use
 * without any server-side token store.
 */
export function passwordFingerprint(passwordHash: string): string {
  return createHash('sha256').update(passwordHash).digest('hex').slice(0, 16);
}
