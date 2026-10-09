import type { OutboxEventInput } from '../../platform/outbox.port';

/** Routing key for the "your password was changed" notice (consumed by the worker). */
export const IDENTITY_PASSWORD_CHANGED = 'identity.password_changed';

export interface PasswordChangedInput {
  organizationId: number;
  userId: string;
  name: string;
  email: string;
  /**
   * How many of the account's OTHER sessions the change signed out — the second
   * half of what the reader needs to know, because it happens in the same
   * operation and they did not ask for it separately.
   *
   * A count rather than a flag: "4 other devices were signed out" tells someone
   * who only ever uses a phone that something they did not recognise has been
   * ended, which a bare "other devices were signed out" does not. `0` is
   * meaningful too and must not be confused with "unknown" — it says the
   * account had nothing else signed in, so the worker drops the sentence
   * instead of printing a number.
   */
  otherSessionsSignedOut: number;
  occurredAt: string;
}

/**
 * Built when a signed-in member changes their own password (US-ACC-05 /
 * US-DISC-12 criterion 4). The worker emails the account holder so a change
 * made by somebody holding their session is still noticed — a password change
 * nobody is told about is how a stolen session becomes a permanent one.
 *
 * It is written to the outbox in the SAME transaction as the password write
 * (see `PasswordRepository.setPassword`). If the two could diverge, the
 * guarantee is gone in the direction that matters: a committed change whose
 * notice was lost is exactly the silent takeover this event exists to announce.
 *
 * Deliberately NOT carried, in the genre `identity.two_factor_disabled` set:
 * - no link, so the mail cannot train its reader to click one in a security
 *   alert;
 * - no device or IP address, which this request does not reliably know, and an
 *   invented "unknown device" line is worse than silence;
 * - no locale — the worker reads the account's own language, as its other
 *   identity handlers do;
 * - never the password, old or new, nor any hash or token of one.
 *
 * `version` lets producer and consumer evolve apart.
 */
export function passwordChangedEvent(
  input: PasswordChangedInput,
): OutboxEventInput {
  return {
    organizationId: input.organizationId,
    aggregateType: 'user',
    aggregateId: input.userId,
    routingKey: IDENTITY_PASSWORD_CHANGED,
    payload: {
      version: 1,
      organizationId: input.organizationId,
      userId: input.userId,
      name: input.name,
      email: input.email,
      otherSessionsSignedOut: input.otherSessionsSignedOut,
      occurredAt: input.occurredAt,
    },
  };
}
