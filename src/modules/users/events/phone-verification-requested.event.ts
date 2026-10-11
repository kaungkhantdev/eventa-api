import type { OutboxEventInput } from '../../platform/outbox.port';

/** Routing key for the "here is your confirmation code" text (consumed by eventa-worker). */
export const IDENTITY_PHONE_VERIFICATION_REQUESTED =
  'identity.phone_verification_requested';

export interface PhoneVerificationRequestedInput {
  organizationId: number;
  userId: string;
  name: string;
  /** The REQUESTED number, E.164 — the text goes here, never to the current one. */
  phone: string;
  /** The six digits, in the clear. See the note below on why. */
  code: string;
  /** When the code stops working, so the copy can say so. ISO-8601 UTC. */
  expiresAt: string;
  occurredAt: string;
}

/**
 * Builds the outbox entry for a phone change (US-DISC-11 AC3). The worker texts
 * the code to the requested number; the number Eventa actually sends to is
 * unchanged until the member types that code back. `version` lets producer and
 * consumer evolve apart.
 *
 * THE CODE TRAVELS IN THE CLEAR, and it has to: `users.phone_code_hash` holds
 * only a digest, and a digest cannot be texted to anybody. This is the same
 * bargain `identity.email_change_requested` already makes, whose `confirmUrl`
 * carries a signed token that is likewise the whole credential. What bounds it
 * is the row's life — the relay ships and clears an outbox row in seconds —
 * against a code that dies in minutes and takes five guesses. What must NOT
 * happen is this payload reaching a log: AGENTS.md forbids logging a code or a
 * phone number, and both are in here.
 *
 * NO LOCALE FIELD, matching `identity.email_change_requested`: the worker
 * already resolves language itself (the member's preference, then the
 * workspace's, then English) and a copy sent on the bus would be a second
 * answer that could disagree with it.
 */
export function phoneVerificationRequestedEvent(
  input: PhoneVerificationRequestedInput,
): OutboxEventInput {
  return {
    organizationId: input.organizationId,
    aggregateType: 'user',
    aggregateId: input.userId,
    routingKey: IDENTITY_PHONE_VERIFICATION_REQUESTED,
    payload: {
      version: 1,
      organizationId: input.organizationId,
      userId: input.userId,
      name: input.name,
      phone: input.phone,
      code: input.code,
      expiresAt: input.expiresAt,
      occurredAt: input.occurredAt,
    },
  };
}
