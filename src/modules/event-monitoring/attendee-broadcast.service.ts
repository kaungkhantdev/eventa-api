import { Injectable } from '@nestjs/common';
import { Clock } from '../../common/time/clock';
import { OutboxPort } from '../platform/outbox.port';
import { attendeesEmailRequestedEvent } from '../events/events/attendees-email-requested.event';
import { EventsService } from '../events/events.service';
import type { EventActor } from '../events/events.types';
import { EventStatsPort } from '../events/ports/event-stats.port';
import { BroadcastResultDto } from './dto/broadcast-result.dto';
import type { EmailAttendeesDto } from './dto/email-attendees.dto';

/**
 * "Email all attendees" (US-EVT-14) — the producer half. Validates the request and
 * writes an outbox broadcast event in the same request; the Engagement worker (E12)
 * resolves recipients and sends. Nothing is delivered synchronously here.
 */
@Injectable()
export class AttendeeBroadcastService {
  constructor(
    private readonly events: EventsService,
    private readonly stats: EventStatsPort,
    private readonly outbox: OutboxPort,
    private readonly clock: Clock,
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
    await this.outbox.enqueue(
      attendeesEmailRequestedEvent({
        organizationId: actor.organizationId,
        eventId,
        subject: input.subject,
        message: input.message,
        requestedByUserId: actor.userId,
        recipientCount: recipients,
        occurredAt: this.clock.now().toISOString(),
      }),
    );
    return { eventId, recipients, queued: true };
  }
}
