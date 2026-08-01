import { Injectable } from '@nestjs/common';
import { DomainException } from '../../../common/errors/domain.exception';
import { Clock } from '../../../common/time/clock';
import { OutboxPort } from '../../platform/outbox.port';
import { attendeesEmailRequestedEvent } from '../events/attendees-email-requested.event';
import { EventsRepository } from '../events.repository';
import type { EventActor } from '../events.types';
import { EventStatsPort } from '../ports/event-stats.port';
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
    private readonly repo: EventsRepository,
    private readonly stats: EventStatsPort,
    private readonly outbox: OutboxPort,
    private readonly clock: Clock,
  ) {}

  async emailAll(
    actor: EventActor,
    eventId: string,
    input: EmailAttendeesDto,
  ): Promise<BroadcastResultDto> {
    const event = await this.repo.findEvent(actor.organizationId, eventId);
    if (!event) {
      throw DomainException.notFound(
        `Event ${eventId} not found in this workspace.`,
      );
    }
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
