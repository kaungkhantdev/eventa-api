import type { OutboxEventInput } from '../../platform/outbox.port';
import type { Locale } from '../auth-booking-signup.types';

/** Routing key for a booking's create-your-account email (consumed by eventa-worker). */
export const IDENTITY_BOOKING_ACCOUNT_LINK_REQUESTED =
  'identity.booking_account_link_requested';

export interface BookingAccountLinkRequestedInput {
  /** The PLATFORM organization — every attendee account lives there (US-DISC-08). */
  organizationId: number;
  orderId: string;
  /** The buyer's name, from the order. */
  name: string;
  /** The booking's buyer email — the only address the link is ever sent to. */
  email: string;
  eventName: string;
  /** Absolute link the recipient opens to choose a password (includes the token). */
  claimUrl: string;
  /** ISO-8601 UTC — when the link stops working. */
  expiresAt: string;
  locale: Locale;
  occurredAt: string;
}

/**
 * Builds the outbox entry for "keep your tickets in an Eventa account"
 * (US-DISC-15). The worker renders and sends it; the one-time link and its
 * token are supplied here, as `resetUrl` is for a password reset. `version`
 * lets producer and consumer evolve apart.
 *
 * The aggregate is the ORDER: no account exists yet, and none may until the
 * link is opened. The payload carries a live credential and an address, so
 * neither it nor any part of it is ever logged.
 */
export function bookingAccountLinkRequestedEvent(
  input: BookingAccountLinkRequestedInput,
): OutboxEventInput {
  return {
    organizationId: input.organizationId,
    aggregateType: 'order',
    aggregateId: input.orderId,
    routingKey: IDENTITY_BOOKING_ACCOUNT_LINK_REQUESTED,
    payload: {
      version: 1,
      organizationId: input.organizationId,
      orderId: input.orderId,
      name: input.name,
      email: input.email,
      eventName: input.eventName,
      claimUrl: input.claimUrl,
      expiresAt: input.expiresAt,
      locale: input.locale,
      occurredAt: input.occurredAt,
    },
  };
}
