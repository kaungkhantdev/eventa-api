/** The event-program module's named constants. */

export const TIME = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

export const MAX_DAY = 60;

export const MAX_LIMIT = 100;

export const DEFAULT_LIMIT = 24;

export const MAX_SEARCH = 120;

/** Routing key for a session that moved on a schedule people are following. */
export const SESSION_CHANGED = 'program.session_changed';

/**
 * The only fields whose change is worth telling an attendee about (US-PROG-03):
 * when it happens and where. A retitled or re-described session is still the
 * same session at the same time in the same room, and mailing everyone who
 * bookmarked it for that would train them to ignore the ones that matter.
 */
export const MATERIAL_FIELDS = ['day', 'startTime', 'endTime', 'room'] as const;

/** Events whose schedule someone is actually watching. */
export const LIVE_EVENT_STATUSES = ['upcoming', 'live'] as const;

export const CONFIRM_REMOVAL =
  'Removing this session will NOT notify attendees who bookmarked it, and cannot be undone. Re-send with confirm=true to proceed.';

/** A not-yet-inserted session excludes nothing when conflicts are checked. */
export const NO_SESSION_YET = '';

export const CONFIRM_SPEAKER_REMOVAL =
  'Removing this speaker takes them off ALL of their sessions and cannot be undone. Re-send with confirm=true to proceed.';

export const DUPLICATE_EMAIL =
  'Another speaker on this event already uses that email address.';
