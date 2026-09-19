import type { messageChannelEnum } from '../../db/schema';

export type MessageChannel = (typeof messageChannelEnum.enumValues)[number];

/**
 * How much say an organizer has over one automated message.
 *
 * - `controlled` — Eventa sends this today AND eventa-worker checks the kill
 *   switch before it does. Only these may be switched off.
 * - `planned` — no trigger sends this yet. Showing it as "Active" would tell an
 *   organizer their attendees are getting a message that nobody sends.
 *
 * Two states, not three: there is deliberately no "sent, but you cannot stop
 * it". Every message this platform sends is either the organizer's to control
 * or not being sent at all, and a switch that moves without changing anything
 * is worse than no switch.
 */
export const TEMPLATE_DELIVERY = ['controlled', 'planned'] as const;
export type TemplateDelivery = (typeof TEMPLATE_DELIVERY)[number];

export interface MessageTemplateDefinition {
  slug: string;
  title: string;
  /** What fires it, in the organizer's words. */
  description: string;
  channels: MessageChannel[];
  delivery: TemplateDelivery;
  /**
   * A message attendees are entitled to — their ticket, their receipt, the news
   * that an event is off. US-MSG-02 requires a warning and a confirmation
   * before one of these is switched off, so the UI is told which they are here
   * rather than keeping its own copy of the list.
   */
  expected: boolean;
}

/**
 * Every automated message Eventa knows about (US-MSG-01/02).
 *
 * This is a CATALOG, not a table. A template is a trigger the platform owns,
 * not something an organizer authors — a message with nothing to fire it would
 * never be sent, which is why there is no "new template". `message_templates`
 * rows carry only a workspace's DEVIATIONS from this list, and that is what
 * makes an absent row mean active: a workspace that has never opened these
 * settings still gets its confirmations.
 *
 * `delivery` is a statement about eventa-worker, which owns the sending. Keep
 * it honest: a slug becomes `controlled` on the day a handler both sends it and
 * checks `message_templates.active`, and not before.
 *
 * Email only, throughout. There is no SMS provider in the product yet, so an
 * SMS badge would promise a channel nothing can deliver on.
 */
export const MESSAGE_TEMPLATE_CATALOG: readonly MessageTemplateDefinition[] = [
  {
    slug: 'registration-confirmation',
    title: 'Registration confirmation',
    description:
      'Sent the moment a registration is paid for, carrying the attendee’s ticket and order summary.',
    channels: ['email'],
    delivery: 'controlled',
    expected: true,
  },
  {
    slug: 'cancellation-notice',
    title: 'Cancellation notice',
    description:
      'Sent to every confirmed attendee when an event is cancelled, with the organizer’s reason.',
    channels: ['email'],
    delivery: 'controlled',
    expected: true,
  },
  {
    slug: 'payment-receipt',
    title: 'Payment receipt',
    description: 'An itemized receipt for a successful payment, VAT included.',
    channels: ['email'],
    delivery: 'planned',
    expected: true,
  },
  {
    slug: 'event-reminder',
    title: 'Event reminder',
    description:
      'Sent 24 hours before an event starts, with the time and place.',
    channels: ['email'],
    delivery: 'planned',
    expected: false,
  },
  {
    slug: 'waitlist-offer',
    title: 'Waitlist offer',
    description:
      'Sent when a seat frees up, offering it to the next person on the waitlist.',
    channels: ['email'],
    delivery: 'planned',
    expected: false,
  },
  {
    slug: 'post-event-thankyou',
    title: 'Post-event thank-you',
    description: 'Sent the day after an event, with a link to leave feedback.',
    channels: ['email'],
    delivery: 'planned',
    expected: false,
  },
];

export function templateBySlug(
  slug: string,
): MessageTemplateDefinition | undefined {
  return MESSAGE_TEMPLATE_CATALOG.find((entry) => entry.slug === slug);
}
