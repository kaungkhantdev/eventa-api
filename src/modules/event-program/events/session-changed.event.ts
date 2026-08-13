import type { OutboxEventInput } from '../../platform/outbox.port';

/** Routing key for a session that moved on a schedule people are following. */
export const SESSION_CHANGED = 'program.session_changed';

/** When and where a session sits. `day` is the event day number, not a date. */
export interface SessionWhen {
  day: number;
  startTime: string;
  endTime: string | null;
  room: string | null;
}

export interface SessionChangedInput {
  organizationId: number;
  eventId: string;
  sessionId: string;
  title: string;
  /** Where it was, so the notice can say what changed rather than just "changed". */
  previous: SessionWhen;
  current: SessionWhen;
  occurredAt: string;
}

/**
 * Builds the outbox entry for US-PROG-03's optional notice: an organizer moved
 * a session's day, time or room on an event people are following, and chose to
 * tell the attendees who added it to their schedule.
 *
 * Written in the SAME transaction as the session update, so a moved session and
 * the message announcing it commit together — an attendee can never be told
 * about a change that was rolled back, nor left uninformed about one that stuck.
 *
 * Both the old and new values travel: "Hall A → Hall B" is a useful message and
 * "this session changed" is not, and only the producer still knows the before.
 */
export function sessionChangedEvent(
  input: SessionChangedInput,
): OutboxEventInput {
  return {
    organizationId: input.organizationId,
    aggregateType: 'session',
    aggregateId: input.sessionId,
    routingKey: SESSION_CHANGED,
    payload: {
      version: 1,
      organizationId: input.organizationId,
      eventId: input.eventId,
      sessionId: input.sessionId,
      title: input.title,
      previous: input.previous,
      current: input.current,
      occurredAt: input.occurredAt,
    },
  };
}
