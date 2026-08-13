import type { OutboxEventInput } from '../../platform/outbox.port';

/**
 * One contract, three intents. The worker's calendar handler needs to create,
 * update or withdraw the same invite, and routing them separately would let a
 * `cancelled` overtake the `rescheduled` it supersedes — the outbox preserves
 * order per aggregate, and only within one routing key.
 */
export const MEETING_SYNC_REQUESTED = 'meeting.sync_requested';

export type MeetingSyncIntent = 'create' | 'update' | 'cancel';

export interface MeetingSyncInput {
  organizationId: number;
  meetingId: string;
  intent: MeetingSyncIntent;
  title: string;
  /** The UTC instants, resolved from the Bangkok wall clock the organizer set. */
  startsAt: string;
  endsAt: string;
  guestEmail: string;
  person: string;
  mode: string;
  /** True when the calendar must mint a Meet link for this meeting. */
  needsLink: boolean;
  location: string | null;
  notes: string | null;
  /** The calendar's own id, so an update amends rather than duplicates. */
  externalEventId: string | null;
  cancellationReason: string | null;
  occurredAt: string;
}

/**
 * Asks the workspace calendar to make this meeting real (US-MTG-04): send the
 * guest an invite, mint a Meet link for video, and set the 15-minute reminder.
 *
 * Written to the outbox in the SAME transaction as the meeting itself, which is
 * the whole design: the booking is never conditional on Google being reachable,
 * so "the meeting is still kept and marked as not yet synced" is a property of
 * the write rather than a rescue path. The worker reports back by setting
 * `sync_status`, and a retry simply re-enqueues this event.
 *
 * `startsAt`/`endsAt` are sent as UTC instants rather than the stored wall
 * clock: a calendar API wants an unambiguous moment, and resolving Bangkok here
 * — where the offset rule already lives — keeps the worker from having to know
 * the product's timezone.
 */
export function meetingSyncEvent(input: MeetingSyncInput): OutboxEventInput {
  return {
    organizationId: input.organizationId,
    aggregateType: 'meeting',
    aggregateId: input.meetingId,
    routingKey: MEETING_SYNC_REQUESTED,
    payload: {
      version: 1,
      organizationId: input.organizationId,
      meetingId: input.meetingId,
      intent: input.intent,
      title: input.title,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      guestEmail: input.guestEmail,
      person: input.person,
      mode: input.mode,
      needsLink: input.needsLink,
      location: input.location,
      notes: input.notes,
      externalEventId: input.externalEventId,
      cancellationReason: input.cancellationReason,
      occurredAt: input.occurredAt,
    },
  };
}
