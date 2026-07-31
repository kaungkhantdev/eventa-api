import type { OutboxEventInput } from '../../platform/outbox.port';

/** Routing key for a new account's email-confirmation (consumed by eventa-worker). */
export const IDENTITY_EMAIL_VERIFICATION_REQUESTED =
  'identity.email_verification_requested';

export interface EmailVerificationRequestedInput {
  organizationId: number;
  userId: string;
  name: string;
  email: string;
  /** Absolute link the recipient opens to confirm (already includes the token). */
  verifyUrl: string;
  occurredAt: string;
}

/**
 * Builds the outbox entry for a sign-up confirmation email. The worker (E7
 * Engagement / this repo's identity handler) renders and sends it via the email
 * provider. `version` lets producer/consumer evolve apart.
 */
export function emailVerificationRequestedEvent(
  input: EmailVerificationRequestedInput,
): OutboxEventInput {
  return {
    organizationId: input.organizationId,
    aggregateType: 'user',
    aggregateId: input.userId,
    routingKey: IDENTITY_EMAIL_VERIFICATION_REQUESTED,
    payload: {
      version: 1,
      organizationId: input.organizationId,
      userId: input.userId,
      name: input.name,
      email: input.email,
      verifyUrl: input.verifyUrl,
      occurredAt: input.occurredAt,
    },
  };
}
