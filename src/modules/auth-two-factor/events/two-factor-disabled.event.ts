import type { OutboxEventInput } from '../../platform/outbox.port';

/** Routing key for the "two-factor was turned off" notice (consumed by the worker). */
export const IDENTITY_TWO_FACTOR_DISABLED = 'identity.two_factor_disabled';

export interface TwoFactorDisabledInput {
  organizationId: number;
  userId: string;
  name: string;
  email: string;
  occurredAt: string;
}

/**
 * Built when two-factor is switched off (US-SET-03). The worker emails the member
 * so a silent removal by someone with their session is still noticed.
 */
export function twoFactorDisabledEvent(
  input: TwoFactorDisabledInput,
): OutboxEventInput {
  return {
    organizationId: input.organizationId,
    aggregateType: 'user',
    aggregateId: input.userId,
    routingKey: IDENTITY_TWO_FACTOR_DISABLED,
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
