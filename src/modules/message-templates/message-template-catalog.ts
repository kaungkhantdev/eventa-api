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
  /**
   * What an ABSENT `message_templates` row means for this message: whether a
   * workspace that has never touched it sends it.
   *
   * Never false for an `expected` message — a new workspace must confirm its
   * registrations without anybody first finding this page. eventa-worker
   * decides what is actually SENT from its own copy of the false ones,
   * `OFF_UNTIL_SWITCHED_ON_SLUGS` in its src/db/schema/messaging.ts, so change
   * both together: if they disagree, the page says "Inactive" while attendees
   * are mailed, or "Active" while nobody is.
   */
  defaultActive: boolean;
  /**
   * Merge fields this message can actually fill (US-MSG-02).
   *
   * These must agree with what eventa-worker substitutes for this slug — see
   * `mergeFieldsFor` in its `confirmation-email.ts` / `event-cancelled.handler`.
   * A field listed here that the worker does not fill would validate and then
   * reach an attendee as literal braces; one the worker fills but that is not
   * listed would be refused on save. Keep the two lists together.
   *
   * Empty for a message nothing sends: there is nothing to fill it with.
   */
  tags: string[];
}

/**
 * The thank-you that carries the survey link. Named because feedback reads the
 * delivery log by it to know who was asked (US-MSG-08): it must equal
 * eventa-worker's `POST_EVENT_THANKYOU_SLUG`, the kind the worker logs, and a
 * rename on either side alone would quietly report that nobody was asked.
 */
export const POST_EVENT_THANKYOU_SLUG = 'post-event-thankyou';

/**
 * Every automated message Eventa knows about (US-MSG-01/02).
 *
 * This is a CATALOG, not a table. A template is a trigger the platform owns,
 * not something an organizer authors — a message with nothing to fire it would
 * never be sent, which is why there is no "new template". `message_templates`
 * rows carry only a workspace's DEVIATIONS from this list, so an absent row
 * means the entry's `defaultActive`: on for everything a workspace would be
 * surprised NOT to send — a workspace that has never opened these settings
 * still gets its confirmations — and off for the event reminder, which is mail
 * a workspace must choose to send.
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
      'Sent the moment a registration is confirmed — paid for, or approved on an event that requires approval — carrying the attendee’s ticket and order summary.',
    channels: ['email'],
    delivery: 'controlled',
    expected: true,
    defaultActive: true,
    tags: ['{{first_name}}', '{{event_name}}'],
  },
  {
    slug: 'cancellation-notice',
    title: 'Cancellation notice',
    // eventa-worker's `cancellationRecipients`: a registration still waiting
    // for approval may have paid, and is told too — with its own refund line.
    description:
      'Sent to every confirmed attendee — and everyone whose registration is still awaiting approval — when an event is cancelled, with the organizer’s reason.',
    channels: ['email'],
    delivery: 'controlled',
    expected: true,
    defaultActive: true,
    tags: ['{{first_name}}', '{{event_name}}', '{{reason}}'],
  },
  {
    slug: 'payment-receipt',
    title: 'Payment receipt',
    // Two switches govern it — this one, and "Email receipts" in the payment
    // settings (US-SET-10) — and eventa-worker sends only when both are on.
    // Saying so here is what stops one of them looking broken.
    description:
      'An itemized receipt, VAT included, sent when a paid registration is confirmed — at payment, or at approval on an event that requires approval. Also needs “Email receipts” on in payment settings.',
    channels: ['email'],
    delivery: 'controlled',
    expected: true,
    defaultActive: true,
    tags: ['{{first_name}}', '{{event_name}}'],
  },
  {
    slug: 'event-reminder',
    title: 'Event reminder',
    description:
      'Sent the day before an event starts, with the time, the place and the tickets.',
    channels: ['email'],
    delivery: 'controlled',
    expected: false,
    // Off until a workspace switches it on: once PUBLIC_WEB_URL is set, a
    // default of on would start mailing every workspace's attendees about
    // every event, unasked.
    defaultActive: false,
    tags: ['{{first_name}}', '{{event_name}}', '{{event_venue}}'],
  },
  {
    slug: 'waitlist-offer',
    title: 'Waitlist offer',
    // Governs the notice that an offer lapsed as well: somebody who was never
    // told of an offer should not be told it expired.
    description:
      'Sent when a seat is offered to someone on the waitlist, with the deadline to pay for it — and again if that deadline passes.',
    channels: ['email'],
    delivery: 'controlled',
    expected: false,
    defaultActive: true,
    tags: ['{{first_name}}', '{{event_name}}', '{{ticket_type}}'],
  },
  {
    slug: POST_EVENT_THANKYOU_SLUG,
    title: 'Post-event thank-you',
    // Only when there is a LIVE survey: a link to "no survey to answer" is a
    // worse message than none, so an event without one is simply not thanked.
    description:
      'Sent the day after an event that has a live survey, with the link to answer it.',
    channels: ['email'],
    delivery: 'controlled',
    expected: false,
    defaultActive: true,
    tags: ['{{first_name}}', '{{event_name}}', '{{survey_url}}'],
  },
];

export function templateBySlug(
  slug: string,
): MessageTemplateDefinition | undefined {
  return MESSAGE_TEMPLATE_CATALOG.find((entry) => entry.slug === slug);
}
