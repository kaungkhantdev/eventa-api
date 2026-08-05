import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DomainException } from '../../common/errors/domain.exception';
import { qrSvg } from '../../common/qr/qr';
import type { Env } from '../../config/env.validation';
import { EventsService } from '../events/events.service';
import type { EventActor } from '../events/events.types';
import { TicketingService } from '../ticketing/ticketing.service';
import { TicketShareDto } from './dto/ticket-share.dto';

const NOT_PUBLISHED_WARNING =
  "This event isn't published yet — publish it first, or the link and QR won't open for anyone.";

/**
 * A shareable registration link and matching QR for one ticket type (US-TKT-06),
 * so a poster or a post drops someone straight onto the right ticket.
 *
 * This is a *registration* link, not an entry pass: it opens the sign-up page
 * with the tier preselected and can be scanned by any number of people. Each
 * buyer's personal entry QR is issued with their ticket, elsewhere.
 */
@Injectable()
export class TicketSharingService {
  private readonly baseUrl: string;

  constructor(
    private readonly events: EventsService,
    private readonly tickets: TicketingService,
    config: ConfigService<Env, true>,
  ) {
    this.baseUrl = config.getOrThrow('PUBLIC_WEB_URL', { infer: true });
  }

  async share(
    actor: EventActor,
    eventId: string,
    ticketId: string,
  ): Promise<TicketShareDto> {
    const { event, ticketName, url } = await this.resolve(
      actor,
      eventId,
      ticketId,
    );
    const published = isPublished(event);
    return {
      ticketId,
      ticketName,
      registrationUrl: url,
      qrSvg: await qrSvg(url),
      // Stated explicitly so a caller can prove the QR and the link agree.
      qrEncodes: url,
      isPublished: published,
      warning: published ? null : NOT_PUBLISHED_WARNING,
    };
  }

  /** The same QR on its own, for "Download QR" — an SVG prints at any size. */
  async qrImage(
    actor: EventActor,
    eventId: string,
    ticketId: string,
  ): Promise<string> {
    const { url } = await this.resolve(actor, eventId, ticketId);
    return qrSvg(url);
  }

  private async resolve(
    actor: EventActor,
    eventId: string,
    ticketId: string,
  ): Promise<{
    event: { slug: string; status: string; visibility: string };
    ticketName: string;
    url: string;
  }> {
    // Ticketing owns the tier; ask it rather than reading ticket_types here.
    const [event, tiers] = await Promise.all([
      this.events.getEvent(actor, eventId),
      this.tickets.listTickets(actor, eventId),
    ]);
    const tier = tiers.find((t) => t.id === ticketId);
    if (!tier) {
      throw DomainException.notFound(
        'That ticket type was not found on this event.',
      );
    }
    return {
      event,
      ticketName: tier.name,
      url: `${this.baseUrl}/e/${event.slug}/register?ticket=${ticketId}`,
    };
  }
}

/** Shareable = actually reachable by a stranger: published, live and public. */
function isPublished(event: { status: string; visibility: string }): boolean {
  return (
    event.status !== 'draft' &&
    event.status !== 'cancelled' &&
    event.visibility !== 'private'
  );
}
