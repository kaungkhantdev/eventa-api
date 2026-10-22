import type { OutboxEventInput } from '../../platform/outbox.port';
import { IDENTITY_SIGNED_IN } from '../../../common/constants/auth.constants';

export interface SignedInInput {
  organizationId: number;
  userId: string;
  device: string;
  ip: string | null;
  occurredAt: string;
}

/** Builds the outbox entry for a sign-in. `version` lets producer/consumer overlap. */
export function signedInEvent(input: SignedInInput): OutboxEventInput {
  return {
    organizationId: input.organizationId,
    aggregateType: 'user',
    aggregateId: input.userId,
    routingKey: IDENTITY_SIGNED_IN,
    payload: {
      version: 1,
      organizationId: input.organizationId,
      userId: input.userId,
      device: input.device,
      ip: input.ip,
      occurredAt: input.occurredAt,
    },
  };
}
