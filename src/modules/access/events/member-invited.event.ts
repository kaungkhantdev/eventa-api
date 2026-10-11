import type { OutboxEventInput } from '../../platform/outbox.port';

/** Routing key for a teammate's join link (consumed by eventa-worker). */
export const IDENTITY_MEMBER_INVITED = 'identity.member_invited';

export interface MemberInvitedInput {
  organizationId: number;
  userId: string;
  /** The name the inviting Admin typed — free text about somebody else. */
  name: string;
  email: string;
  /** The workspace they are being asked to join, so the mail can say which. */
  organizationName: string;
  /** Absolute link that sets a password and activates (already holds the token). */
  acceptUrl: string;
  occurredAt: string;
}

/**
 * Builds the outbox entry for a teammate's invitation email (US-SET-11).
 *
 * A URL rather than the raw token, matching the sign-up confirmation and the
 * password reset: the only thing the worker should be able to do with it is
 * put it in a mail, and a bare token invites somebody to use it for something
 * else. `version` lets producer and consumer evolve apart.
 *
 * It carries the WORKSPACE NAME because the reader has no other way to tell
 * which one they are joining — an invitation to "a workspace" is one nobody
 * can safely accept.
 */
export function memberInvitedEvent(
  input: MemberInvitedInput,
): OutboxEventInput {
  return {
    organizationId: input.organizationId,
    aggregateType: 'user',
    aggregateId: input.userId,
    routingKey: IDENTITY_MEMBER_INVITED,
    payload: {
      version: 1,
      organizationId: input.organizationId,
      userId: input.userId,
      name: input.name,
      email: input.email,
      organizationName: input.organizationName,
      acceptUrl: input.acceptUrl,
      occurredAt: input.occurredAt,
    },
  };
}
