import type { OutboxEventInput } from '../../platform/outbox.port';

export const INVITE_SENT_ROUTING_KEY = 'invitation.sent';
const VERSION = 1;

export interface InviteSentPayload extends Record<string, unknown> {
  version: number;
  invitationId: string;
  eventId: string;
  eventName: string;
  recipientName: string;
  recipientEmail: string;
  /** The organizer's personal note, shown above the invitation body. */
  message: string | null;
  /** Absolute link into the event's registration flow. */
  registerUrl: string;
  sentAt: string;
}

/**
 * One invitation email to queue (US-REG-06). The link is ABSOLUTE and built
 * here rather than by the worker — the worker has no idea which host the
 * public site is on, and a relative link in an email is a dead link.
 */
export function inviteSentEvent(input: {
  organizationId: number;
  eventId: string;
  eventName: string;
  recipientName: string;
  recipientEmail: string;
  message: string | null;
  registerUrl: string;
  sentAt: Date;
}): OutboxEventInput {
  const payload: InviteSentPayload = {
    version: VERSION,
    invitationId: `${input.eventId}:${input.recipientEmail}`,
    eventId: input.eventId,
    eventName: input.eventName,
    recipientName: input.recipientName,
    recipientEmail: input.recipientEmail,
    message: input.message,
    registerUrl: input.registerUrl,
    sentAt: input.sentAt.toISOString(),
  };
  return {
    organizationId: input.organizationId,
    aggregateType: 'invitation',
    aggregateId: input.eventId,
    routingKey: INVITE_SENT_ROUTING_KEY,
    payload,
  };
}
