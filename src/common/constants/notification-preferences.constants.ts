/** The notification-preferences module's named constants. */

/**
 * Which topics each audience can be alerted about (both derived from the schema
 * enum). Organizers watch their events' commerce; attendees manage reminders and
 * marketing (US-DISC-12). Order confirmations and receipts are transactional —
 * they are deliberately in NEITHER list, so nothing here can switch them off.
 */
export const ATTENDEE_CATEGORIES = ['reminder', 'marketing'] as const;

/** Defaults when a member has never touched a topic. */
export const DEFAULT_EMAIL = true;

export const DEFAULT_SMS = false;
