import { Injectable } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain.exception';
import { Clock } from '../../common/time/clock';
import { Paginated } from '../../common/http/paginated';
import type { AuthContext } from '../auth/auth.types';
import { attendeesEmailRequestedEvent } from '../events/events/attendees-email-requested.event';
import {
  assertSchedulable,
  unchangeableBecause,
} from './announcement-schedule';
import {
  AnnouncementsRepository,
  type AnnouncementListRow,
  type AnnouncementRow,
} from './announcements.repository';

/** What an organizer is broadcasting, once the caller has resolved the audience. */
export interface SendAnnouncement {
  eventId: string;
  subject: string;
  body: string;
  /** Attendees at the moment of sending — informational, not a receipt. */
  recipientCount: number;
  sentByUserId: string;
}

/** The same broadcast, to go at a time the organizer picked (US-MSG-04). */
export interface ScheduleAnnouncement {
  eventId: string;
  subject: string;
  body: string;
  sentByUserId: string;
  sendAt: Date;
}

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const NOT_FOUND = 'Announcement not found.';

/**
 * Broadcasts an organizer has sent to an event's attendees (US-MSG-04).
 *
 * This module owns the *record*; the sending itself is eventa-worker's, reached
 * through the outbox event written beside the row. What it deliberately does
 * NOT own is choosing the audience — the broadcast path takes one event's
 * confirmed attendees, and a service that pretended to segment them would be
 * inventing a capability the send has no way to honour.
 *
 * One can also be SCHEDULED (US-MSG-04/05): recorded now with no outbox event,
 * and sent by eventa-worker's sweep when its time comes. Until then the
 * organizer can cancel it or move it; once the sweep has claimed it, neither.
 * The time rules live in `announcement-schedule.ts`.
 */
@Injectable()
export class AnnouncementsService {
  constructor(
    private readonly repo: AnnouncementsRepository,
    private readonly clock: Clock,
  ) {}

  /**
   * Record the broadcast and enqueue its send.
   *
   * One clock reading for both, so the history cannot claim a different instant
   * from the message it queued.
   */
  async send(
    organizationId: number,
    input: SendAnnouncement,
  ): Promise<AnnouncementRow> {
    const sentAt = this.clock.now();
    return this.repo.record(
      organizationId,
      { ...input, sentAt },
      attendeesEmailRequestedEvent({
        organizationId,
        eventId: input.eventId,
        subject: input.subject,
        message: input.body,
        requestedByUserId: input.sentByUserId,
        recipientCount: input.recipientCount,
        occurredAt: sentAt.toISOString(),
      }),
    );
  }

  /**
   * Record one to go later. Nothing is queued: the worker writes the send when
   * the time comes, counting the audience as it is then.
   */
  async schedule(
    organizationId: number,
    input: ScheduleAnnouncement,
  ): Promise<AnnouncementRow> {
    assertSchedulable(input.sendAt, this.clock.now());
    return this.repo.recordScheduled(organizationId, {
      eventId: input.eventId,
      subject: input.subject,
      body: input.body,
      sentByUserId: input.sentByUserId,
      scheduledFor: input.sendAt,
    });
  }

  /** Call one off before it goes. It stays in the history, as cancelled. */
  async cancel(auth: AuthContext, id: number): Promise<AnnouncementListRow> {
    const cancelled = await this.repo.cancel(auth.organizationId, id, {
      userId: auth.userId,
      now: this.clock.now(),
    });
    return cancelled ?? this.refuseChange(auth.organizationId, id);
  }

  /**
   * Move one to a new time. Its audience is resolved when it goes, so moving
   * it changes who it reaches only by who has registered in between.
   */
  async reschedule(
    auth: AuthContext,
    id: number,
    sendAt: Date,
  ): Promise<AnnouncementListRow> {
    const now = this.clock.now();
    assertSchedulable(sendAt, now);
    const moved = await this.repo.reschedule(auth.organizationId, id, {
      sendAt,
      now,
    });
    return moved ?? this.refuseChange(auth.organizationId, id);
  }

  async list(
    auth: AuthContext,
    query: { eventId?: string; page?: number; limit?: number },
  ): Promise<Paginated<AnnouncementListRow>> {
    const page = query.page ?? DEFAULT_PAGE;
    const limit = query.limit ?? DEFAULT_LIMIT;
    // Paged by the database. Narrowing here instead would leave the total
    // disagreeing with the rows beneath it.
    const { rows, total } = await this.repo.list(auth.organizationId, {
      eventId: query.eventId,
      page,
      limit,
    });
    return Paginated.of(rows, total, page, limit);
  }

  /**
   * Nothing scheduled was changed — say why. Missing and another workspace's
   * read the same, so an id cannot be used to learn what exists elsewhere.
   */
  private async refuseChange(
    organizationId: number,
    id: number,
  ): Promise<never> {
    const current = await this.repo.find(organizationId, id);
    if (!current) throw DomainException.notFound(NOT_FOUND);
    throw unchangeableBecause(current.status);
  }
}
