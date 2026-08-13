import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DomainException } from '../../common/errors/domain.exception';
import { Clock } from '../../common/time/clock';
import type { AuthContext } from '../auth/auth.types';
import { startsAt } from './meeting-bucket';
import { assertSchedulable, placeOf } from './meeting-schedule';
import {
  type MeetingSyncIntent,
  meetingSyncEvent,
} from './events/meeting-sync.event';
import { MeetingEventPort } from './ports/meeting-event.port';
import { MeetingsRepository } from './meetings.repository';
import type { MeetingPatch, MeetingRow, NewMeeting } from './meetings.types';

const GONE = "That meeting isn't available.";
const ALREADY_CANCELLED =
  'This meeting was cancelled and can no longer be edited.';
const CHANGED_UNDERNEATH =
  'Someone else changed this meeting — reload it and try again.';
const NO_SUCH_EVENT = "That event isn't in this workspace.";

export interface ScheduleMeetingCommand {
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  type: NewMeeting['type'];
  mode: NewMeeting['mode'];
  person: string;
  role?: string;
  guestEmail: string;
  eventId?: string;
  notes?: string;
  idempotencyKey?: string;
}

export type RescheduleMeetingCommand = Partial<ScheduleMeetingCommand> & {
  /** The version the organizer was looking at — the concurrency guard. */
  version: number;
};

/**
 * Booking and changing meetings (E12: US-MTG-03/04/05).
 *
 * Two things are deliberately NOT here. The calendar is not called — the
 * meeting commits with an outbox event beside it and the worker does the invite,
 * the Meet link and the reminder, which is what makes "the meeting is still
 * kept" true even when Google is unreachable. And where a meeting takes place is
 * never taken from the request: the MODE decides it, so an in-person meeting
 * shows the event's real venue and a video one carries no stale location.
 */
@Injectable()
export class MeetingsService {
  constructor(
    private readonly repo: MeetingsRepository,
    private readonly events: MeetingEventPort,
    private readonly clock: Clock,
  ) {}

  async schedule(
    auth: AuthContext,
    command: ScheduleMeetingCommand,
  ): Promise<{ meeting: MeetingRow; created: boolean }> {
    const now = this.clock.now();
    assertSchedulable(
      {
        title: command.title,
        date: command.date,
        startTime: command.startTime,
        endTime: command.endTime,
        mode: command.mode,
      },
      now,
    );
    const place = placeOf(
      command.mode,
      await this.venueFor(auth.organizationId, command.eventId),
    );
    return this.repo.schedule(
      auth.organizationId,
      {
        title: command.title.trim(),
        meetingDate: command.date,
        startTime: command.startTime,
        endTime: command.endTime,
        type: command.type,
        mode: command.mode,
        person: command.person.trim(),
        role: command.role ?? null,
        guestEmail: command.guestEmail,
        eventId: command.eventId ?? null,
        location: place.location,
        notes: command.notes ?? null,
        // The panel is one submit, not a resumable flow, so there is no client
        // key to honour — this makes a double-tapped Save resolve to one booking.
        idempotencyKey: command.idempotencyKey ?? randomUUID(),
        createdBy: auth.userId,
      },
      (row) => this.syncEvent(row, 'create', place.needsLink, now),
    );
  }

  async reschedule(
    auth: AuthContext,
    id: string,
    command: RescheduleMeetingCommand,
  ): Promise<MeetingRow> {
    const now = this.clock.now();
    const current = await this.mustFind(auth, id);
    if (current.status === 'cancelled') {
      throw DomainException.conflict(ALREADY_CANCELLED);
    }
    const merged = { ...toCommand(current), ...defined(command) };
    assertSchedulable(
      {
        title: merged.title,
        date: merged.date,
        startTime: merged.startTime,
        endTime: merged.endTime,
        mode: merged.mode,
      },
      now,
    );
    const place = placeOf(
      merged.mode,
      await this.venueFor(auth.organizationId, merged.eventId),
    );
    const patch: MeetingPatch = {
      title: merged.title.trim(),
      meetingDate: merged.date,
      startTime: merged.startTime,
      endTime: merged.endTime,
      type: merged.type,
      mode: merged.mode,
      person: merged.person.trim(),
      role: merged.role ?? null,
      guestEmail: merged.guestEmail,
      eventId: merged.eventId ?? null,
      location: place.location,
      notes: merged.notes ?? null,
      // A meeting that is no longer video must lose its Meet link, or the guest
      // is sent to an empty call instead of the venue (US-MTG-05).
      link: place.needsLink ? current.link : null,
    };
    const updated = await this.repo.reschedule(
      auth.organizationId,
      id,
      command.version,
      patch,
      (row) => this.syncEvent(row, 'update', place.needsLink, now),
    );
    if (!updated) throw DomainException.conflict(CHANGED_UNDERNEATH);
    return updated;
  }

  async cancel(
    auth: AuthContext,
    id: string,
    reason: string | null,
  ): Promise<MeetingRow> {
    const now = this.clock.now();
    const cancelled = await this.repo.cancel(
      auth.organizationId,
      id,
      reason,
      (row) => this.syncEvent(row, 'cancel', false, now),
    );
    if (!cancelled) {
      // Either it is not ours, or it was already cancelled — both mean there is
      // nothing here to call off, and neither should say which.
      throw DomainException.conflict(ALREADY_CANCELLED);
    }
    return cancelled;
  }

  async retrySync(auth: AuthContext, id: string): Promise<MeetingRow> {
    const now = this.clock.now();
    const meeting = await this.mustFind(auth, id);
    const retried = await this.repo.retrySync(auth.organizationId, id, (row) =>
      this.syncEvent(
        row,
        meeting.status === 'cancelled' ? 'cancel' : intentFor(row),
        row.mode === 'Video',
        now,
      ),
    );
    if (!retried) throw DomainException.notFound(GONE);
    return retried;
  }

  private async mustFind(auth: AuthContext, id: string): Promise<MeetingRow> {
    const meeting = await this.repo.findById(auth.organizationId, id);
    if (!meeting) throw DomainException.notFound(GONE);
    return meeting;
  }

  /**
   * The event's venue, and the tenancy check in the same call: an id from
   * another workspace resolves to nothing and is refused rather than silently
   * saved as a general meeting.
   */
  private async venueFor(
    organizationId: number,
    eventId: string | null | undefined,
  ): Promise<string | null> {
    if (!eventId) return null;
    const event = await this.events.findForMeeting(organizationId, eventId);
    if (!event) throw DomainException.validation(NO_SUCH_EVENT);
    return event.venueName;
  }

  private syncEvent(
    row: MeetingRow,
    intent: MeetingSyncIntent,
    needsLink: boolean,
    now: Date,
  ) {
    return meetingSyncEvent({
      organizationId: row.organizationId,
      meetingId: row.id,
      intent,
      title: row.title,
      startsAt: startsAt(row.meetingDate, row.startTime).toISOString(),
      endsAt: startsAt(row.meetingDate, row.endTime).toISOString(),
      guestEmail: row.guestEmail,
      person: row.person,
      mode: row.mode,
      needsLink,
      location: row.location,
      notes: row.notes,
      externalEventId: row.externalEventId,
      cancellationReason: row.cancellationReason,
      occurredAt: now.toISOString(),
    });
  }
}

/**
 * The keys the caller actually SENT.
 *
 * A validated DTO materializes every declared field, so an untouched one is
 * present-and-`undefined` rather than absent — and spreading that over the
 * stored meeting would blank the title, date and times of any partial edit.
 * This is why a PATCH must merge on defined values, not on own properties.
 */
function defined<T extends object>(patch: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

/** A retry recreates the invite when the calendar never got one at all. */
function intentFor(row: MeetingRow): MeetingSyncIntent {
  return row.externalEventId ? 'update' : 'create';
}

/** The stored row expressed as the command shape, so an edit can merge onto it. */
function toCommand(row: MeetingRow): ScheduleMeetingCommand {
  return {
    title: row.title,
    date: row.meetingDate,
    startTime: row.startTime,
    endTime: row.endTime,
    type: row.type,
    mode: row.mode,
    person: row.person,
    role: row.role ?? undefined,
    guestEmail: row.guestEmail,
    eventId: row.eventId ?? undefined,
    notes: row.notes ?? undefined,
  };
}
