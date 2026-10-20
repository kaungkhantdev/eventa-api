/** The message-templates module's named constants. */

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

/**
 * The thank-you that carries the survey link. Named because feedback reads the
 * delivery log by it to know who was asked (US-MSG-08): it must equal
 * eventa-worker's `POST_EVENT_THANKYOU_SLUG`, the kind the worker logs, and a
 * rename on either side alone would quietly report that nobody was asked.
 */
export const POST_EVENT_THANKYOU_SLUG = 'post-event-thankyou';

/** `{{ first_name }}` — whitespace inside the braces is what people type. */
export const TAG = /\{\{\s*([\w.]+)\s*\}\}/g;
