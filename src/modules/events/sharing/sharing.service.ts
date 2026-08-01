import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/env.validation';
import type { EventResponseDto } from '../dto/event-response.dto';
import type { EventActor } from '../events.types';
import { EventsService } from '../events.service';
import { ShareResponseDto } from './dto/share-response.dto';

const NOT_PUBLIC_WARNING =
  "This event isn't public yet — the share link may not be reachable until you publish it.";

/** Build share links + a pre-filled message for promoting an event (US-EVT-15). */
@Injectable()
export class SharingService {
  private readonly baseUrl: string;

  constructor(
    private readonly events: EventsService,
    config: ConfigService<Env, true>,
  ) {
    this.baseUrl = config.getOrThrow('PUBLIC_WEB_URL', { infer: true });
  }

  async share(actor: EventActor, eventId: string): Promise<ShareResponseDto> {
    const event = await this.events.getEvent(actor, eventId);
    const publicUrl = `${this.baseUrl}/e/${event.slug}`;
    const message = shareMessage(event);
    const reachable = isReachable(event);
    return {
      publicUrl,
      registrationUrl: publicUrl,
      shareMessage: message,
      channels: buildChannels(message, publicUrl, event.name),
      isPublic: reachable,
      warning: reachable ? null : NOT_PUBLIC_WARNING,
    };
  }
}

/** "Join me at {title} — {date} at {location}" (date shown in Bangkok time). */
function shareMessage(event: EventResponseDto): string {
  const date = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(event.startAt));
  const location =
    event.venueName ||
    event.city ||
    (event.isOnline ? 'online' : 'a venue to be announced');
  return `Join me at ${event.name} — ${date} at ${location}`;
}

/** Reachable = published (not draft/cancelled) and not private. */
function isReachable(event: EventResponseDto): boolean {
  return (
    event.status !== 'draft' &&
    event.status !== 'cancelled' &&
    event.visibility !== 'private'
  );
}

function buildChannels(message: string, url: string, title: string) {
  const u = encodeURIComponent(url);
  const m = encodeURIComponent(message);
  const mu = encodeURIComponent(`${message} ${url}`);
  return {
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${u}`,
    x: `https://twitter.com/intent/tweet?text=${m}&url=${u}`,
    line: `https://line.me/R/msg/text/?${mu}`,
    whatsapp: `https://wa.me/?text=${mu}`,
    email: `mailto:?subject=${encodeURIComponent(title)}&body=${mu}`,
  };
}
