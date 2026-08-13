/**
 * The only fields whose change is worth telling an attendee about (US-PROG-03):
 * when it happens and where. A retitled or re-described session is still the
 * same session at the same time in the same room, and mailing everyone who
 * bookmarked it for that would train them to ignore the ones that matter.
 */
const MATERIAL_FIELDS = ['day', 'startTime', 'endTime', 'room'] as const;

/** Events whose schedule someone is actually watching. */
export const LIVE_EVENT_STATUSES = ['upcoming', 'live'] as const;

/** The slice of a session a material-change test looks at. */
export type SessionSnapshot = Record<string, unknown>;

export function isMaterialChange(
  before: SessionSnapshot,
  after: SessionSnapshot,
): boolean {
  return MATERIAL_FIELDS.some((field) => before[field] !== after[field]);
}

/**
 * Whether to queue the "this session moved" notice.
 *
 * Three conditions, all required, and the default is silence. The organizer
 * must ASK — US-PROG-03 is explicit that no message goes out unless they choose
 * it — the change must actually be material, and the event must be one people
 * are following. A draft event has no attendees to tell; a completed or
 * cancelled one has nobody left who needs to know.
 */
export function shouldNotify(
  before: SessionSnapshot,
  after: SessionSnapshot,
  eventStatus: string,
  requested: boolean | undefined,
): boolean {
  if (requested !== true) return false;
  if (!(LIVE_EVENT_STATUSES as readonly string[]).includes(eventStatus)) {
    return false;
  }
  return isMaterialChange(before, after);
}
