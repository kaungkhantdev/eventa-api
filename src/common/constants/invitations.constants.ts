/** The invitations module's named constants. */

export const MAX_NAME = 120;

export const INVITE_SENT_ROUTING_KEY = 'invitation.sent';

export const VERSION = 1;

/** How long an identical invite is suppressed rather than re-sent. */
export const INVITE_DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;

export const MAX_MESSAGE_LENGTH = 250;
