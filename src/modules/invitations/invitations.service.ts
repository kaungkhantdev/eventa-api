import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Clock } from '../../common/time/clock';
import type { Env } from '../../config/env.validation';
import type { AuthContext } from '../auth/auth.types';
import { EventsService } from '../events/events.service';
import { inviteSentEvent } from './events/invite-sent.event';
import { InvitationsRepository } from './invitations.repository';
import {
  INVITE_DEDUPE_WINDOW_MS,
  type InviteOutcome,
  type SendInviteInput,
} from './invitations.types';

/**
 * Inviting someone to an event (US-REG-06).
 *
 * An invite is a promise to attend, not a booking: nothing here touches
 * capacity, holds or tickets. The seat is only reserved if the invitee
 * actually goes through registration.
 *
 * A repeat invite to the same person and event inside the dedupe window is
 * SUPPRESSED rather than refused — the organizer's intent was "make sure they
 * were asked", and an error would be a worse answer than silence. The response
 * says which happened.
 */
@Injectable()
export class InvitationsService {
  private readonly publicWebUrl: string;

  constructor(
    private readonly repo: InvitationsRepository,
    private readonly events: EventsService,
    private readonly clock: Clock,
    config: ConfigService<Env, true>,
  ) {
    this.publicWebUrl = config.getOrThrow('PUBLIC_WEB_URL', { infer: true });
  }

  async invite(
    auth: AuthContext,
    input: SendInviteInput,
  ): Promise<InviteOutcome> {
    // Resolving the event through its own service is the tenancy check: an
    // event from another workspace simply 404s before anything is written.
    const event = await this.events.getEvent(
      { organizationId: auth.organizationId, userId: auth.userId },
      input.eventId,
    );
    const now = this.clock.now();
    const email = input.recipientEmail.trim().toLowerCase();
    const recorded = await this.repo.record(
      {
        organizationId: auth.organizationId,
        eventId: input.eventId,
        recipientName: input.recipientName.trim(),
        recipientEmail: email,
        message: input.message?.trim() || null,
        invitedBy: auth.userId,
        now,
        resendCutoff: new Date(now.getTime() - INVITE_DEDUPE_WINDOW_MS),
      },
      (sentAt) =>
        inviteSentEvent({
          organizationId: auth.organizationId,
          eventId: input.eventId,
          eventName: event.name,
          recipientName: input.recipientName.trim(),
          recipientEmail: email,
          message: input.message?.trim() || null,
          registerUrl: `${this.publicWebUrl}/events/${event.slug}`,
          sentAt,
        }),
    );
    if (!recorded) {
      // Already invited recently: no second email, and we say so plainly.
      return { sent: false, recipientEmail: email, sentAt: now };
    }
    return { sent: true, recipientEmail: email, sentAt: recorded.sentAt };
  }
}
