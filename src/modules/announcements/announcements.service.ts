import { Injectable } from '@nestjs/common';
import { Clock } from '../../common/time/clock';
import { Paginated } from '../../common/http/paginated';
import type { AuthContext } from '../auth/auth.types';
import { attendeesEmailRequestedEvent } from '../events/events/attendees-email-requested.event';
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

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;

/**
 * Broadcasts an organizer has sent to an event's attendees (US-MSG-04).
 *
 * This module owns the *record*; the sending itself is eventa-worker's, reached
 * through the outbox event written beside the row. What it deliberately does
 * NOT own is choosing the audience — the broadcast path takes one event's
 * confirmed attendees, and a service that pretended to segment them would be
 * inventing a capability the send has no way to honour.
 *
 * There is no scheduling (US-MSG-05) for the same reason: nothing in the
 * product can send later, so every announcement here has already gone.
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
}
