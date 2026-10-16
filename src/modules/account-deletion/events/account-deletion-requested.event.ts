import type { OutboxEventInput } from '../../platform/outbox.port';

/**
 * Routing key for a confirmed account deletion (consumed by eventa-worker).
 * The worker sends the confirmation email. It does NOT anonymize the personal
 * data: that PDPA scrub is unbuilt on both sides, so the soft-deleted row
 * still holds the email. The address is free for a new sign-up anyway,
 * because `uq_users_org_email_persona` only covers live rows.
 */
export const IDENTITY_ACCOUNT_DELETION_REQUESTED =
  'identity.account_deletion_requested';

export interface AccountDeletionRequestedInput {
  organizationId: number;
  userId: string;
  name: string;
  /** Carried in the event — the row's copy is scheduled to be scrubbed. */
  email: string;
  occurredAt: string;
}

/** Builds the outbox entry written in the SAME transaction as the soft delete. */
export function accountDeletionRequestedEvent(
  input: AccountDeletionRequestedInput,
): OutboxEventInput {
  return {
    organizationId: input.organizationId,
    aggregateType: 'user',
    aggregateId: input.userId,
    routingKey: IDENTITY_ACCOUNT_DELETION_REQUESTED,
    payload: {
      version: 1,
      organizationId: input.organizationId,
      userId: input.userId,
      name: input.name,
      email: input.email,
      occurredAt: input.occurredAt,
    },
  };
}
