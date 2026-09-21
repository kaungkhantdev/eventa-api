import { Injectable } from '@nestjs/common';
import { AnnouncementsService } from '../announcements/announcements.service';
import { EventsService } from '../events/events.service';
import type { EventActor } from '../events/events.types';
import { EventStatsPort } from '../events/ports/event-stats.port';
import { BroadcastResultDto } from './dto/broadcast-result.dto';
import type { EmailAttendeesDto } from './dto/email-attendees.dto';

/**
 * "Email all attendees" (US-EVT-14) — the producer half. Validates the request,
 * resolves how many attendees it is going to, and hands it to the announcements
 * module, which writes the record and the outbox event in one transaction; the
 * Engagement worker (E12) resolves recipients and sends. Nothing is delivered
 * synchronously here.
 *
 * The record is what makes this answerable afterwards (US-MSG-04). Before it
 * existed a broadcast reached hundreds of people and left nothing behind but an
 * outbox row that the relay would consume.
 */
@Injectable()
export class AttendeeBroadcastService {
  constructor(
    private readonly events: EventsService,
    private readonly stats: EventStatsPort,
    private readonly announcements: AnnouncementsService,
  ) {}

  async emailAll(
    actor: EventActor,
    eventId: string,
    input: EmailAttendeesDto,
  ): Promise<BroadcastResultDto> {
    await this.events.getEvent(actor, eventId); // 404 if not in the caller's org
    const recipients = await this.stats.attendeeCount(
      actor.organizationId,
      eventId,
    );
    await this.announcements.send(actor.organizationId, {
      eventId,
      subject: input.subject,
      body: input.message,
      recipientCount: recipients,
      sentByUserId: actor.userId,
    });
    return { eventId, recipients, queued: true };
  }
}
