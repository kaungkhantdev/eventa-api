import type { OutboxEventInput } from '../../platform/outbox.port';
import { IDENTITY_EMAIL_CHANGE_REQUESTED } from '../../../common/constants/users.constants';

export interface EmailChangeRequestedInput {
  organizationId: number;
  userId: string;
  name: string;
  /** The REQUESTED address — the link is sent here, never to the current one. */
  email: string;
  confirmUrl: string;
  occurredAt: string;
}

/**
 * Builds the outbox entry for an email change (US-SET-01). The worker delivers the
 * confirmation link to the new address; the account's sign-in email is unchanged
 * until that link is opened. `version` lets producer/consumer evolve apart.
 */
export function emailChangeRequestedEvent(
  input: EmailChangeRequestedInput,
): OutboxEventInput {
  return {
    organizationId: input.organizationId,
    aggregateType: 'user',
    aggregateId: input.userId,
    routingKey: IDENTITY_EMAIL_CHANGE_REQUESTED,
    payload: {
      version: 1,
      organizationId: input.organizationId,
      userId: input.userId,
      name: input.name,
      email: input.email,
      confirmUrl: input.confirmUrl,
      occurredAt: input.occurredAt,
    },
  };
}
