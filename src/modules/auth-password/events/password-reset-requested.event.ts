import type { OutboxEventInput } from '../../platform/outbox.port';

/** Routing key for a password-reset email (consumed by eventa-worker). */
export const IDENTITY_PASSWORD_RESET_REQUESTED =
  'identity.password_reset_requested';

export interface PasswordResetRequestedInput {
  organizationId: number;
  userId: string;
  name: string;
  email: string;
  /** Absolute link the recipient opens to set a new password (includes the token). */
  resetUrl: string;
  occurredAt: string;
}

/**
 * Builds the outbox entry for a "reset your password" email. The worker renders and
 * sends it; the single-use link/token is supplied here. `version` lets producer and
 * consumer evolve apart.
 */
export function passwordResetRequestedEvent(
  input: PasswordResetRequestedInput,
): OutboxEventInput {
  return {
    organizationId: input.organizationId,
    aggregateType: 'user',
    aggregateId: input.userId,
    routingKey: IDENTITY_PASSWORD_RESET_REQUESTED,
    payload: {
      version: 1,
      organizationId: input.organizationId,
      userId: input.userId,
      name: input.name,
      email: input.email,
      resetUrl: input.resetUrl,
      occurredAt: input.occurredAt,
    },
  };
}
