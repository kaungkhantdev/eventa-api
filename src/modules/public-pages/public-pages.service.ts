import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DomainException } from '../../common/errors/domain.exception';
import { Clock } from '../../common/time/clock';
import type { Env } from '../../config/env.validation';
import { PublicPagesRepository } from './public-pages.repository';
import type {
  PublicPage,
  PublicSession,
  PublicTicket,
  RegistrationState,
} from './public-pages.types';

/** Below this many remaining, the tier shows an urgency line (US-PAGE-05). */
const LOW_STOCK_THRESHOLD = 10;
/** Used when the organizer set no accent colour, or set an unusable one. */
const DEFAULT_ACCENT = '#2563EB';
const ACCENT_PATTERN = /^#[0-9a-f]{6}$/i;
const DEFAULT_TEMPLATE = 'aurora';
const DEFAULT_AGENDA_TITLE = 'Agenda';
const DEFAULT_SPEAKERS_TITLE = 'Speakers';
/** Tier states that are not purchasable. */
const UNAVAILABLE_STATUSES = ['paused', 'soldout'];

/**
 * Assembles the anonymous public event page (US-PAGE-01…06, 08).
 *
 * Read-only by construction: it starts registration but never books, holds a seat
 * or reads attendee data. An online event's private join link is never part of
 * this payload — only the promise of when it arrives.
 */
@Injectable()
export class PublicPagesService {
  private readonly publicWebUrl: string;

  constructor(
    private readonly repo: PublicPagesRepository,
    private readonly clock: Clock,
    config: ConfigService<Env, true>,
  ) {
    this.publicWebUrl = config.getOrThrow('PUBLIC_WEB_URL', { infer: true });
  }

  async getPage(slug: string): Promise<PublicPage> {
    const event = await this.repo.findPublishedBySlug(slug);
    if (!event) {
      throw DomainException.notFound("This event page isn't available.");
    }
    const [highlights, agendaRows, speakers, ticketRows, faqs] =
      await Promise.all([
        this.repo.highlights(event.id),
        this.repo.agenda(event.id),
        this.repo.speakers(event.id),
        this.repo.tickets(event.id),
        this.repo.faqs(event.id),
      ]);

    const registration = this.registrationState(event, ticketRows);
    return {
      event: this.toPublicEvent(event),
      highlights,
      agenda: groupAgenda(agendaRows),
      speakers,
      tickets: ticketRows.map((t) => this.toPublicTicket(t, registration)),
      faqs,
      registration,
      sections: {
        agenda: event.agendaTitle ?? DEFAULT_AGENDA_TITLE,
        speakers: event.speakersTitle ?? DEFAULT_SPEAKERS_TITLE,
      },
      share: {
        title: event.name,
        description: event.description ?? '',
        image: event.coverImage,
        // The clean public address — never carries tracking or personal data.
        url: `${this.publicWebUrl}/e/${event.slug}`,
        noIndex: false,
      },
    };
  }

  private toPublicEvent(
    event: Awaited<ReturnType<PublicPagesRepository['findPublishedBySlug']>> &
      object,
  ): PublicPage['event'] {
    // An online event never publishes a physical location, even if one is stored.
    const physical = !event.isOnline;
    return {
      id: event.id,
      slug: event.slug,
      name: event.name,
      description: event.description,
      type: event.type,
      categoryName: event.categoryName,
      startAt: event.startAt.toISOString(),
      endAt: event.endAt?.toISOString() ?? null,
      timezone: event.timezone,
      isOnline: event.isOnline,
      onlineNote: event.isOnline ? event.onlineNote : null,
      venueName: physical ? event.venueName : null,
      venueAddress: physical ? event.venueAddress : null,
      city: physical ? event.city : null,
      coverImage: event.coverImage,
      accentColor: usableAccent(event.accentColor),
      organizerName: event.organizerName,
      template: event.landingTemplateId ?? DEFAULT_TEMPLATE,
      locale: 'en',
    };
  }

  /**
   * Whether registration can start at all. Closed once the event has begun; not
   * yet open while every tier is still waiting for its sales window.
   */
  private registrationState(
    event: { startAt: Date },
    tickets: { salesStartAt: Date | null; salesEndAt: Date | null }[],
  ): RegistrationState {
    const now = this.clock.now();
    if (event.startAt.getTime() <= now.getTime()) {
      return { open: false, reason: 'Registration is closed.' };
    }
    if (tickets.length === 0) {
      return { open: false, reason: "Registration isn't open yet." };
    }
    const anyOnSale = tickets.some((t) => this.inSalesWindow(t, now));
    return anyOnSale
      ? { open: true, reason: null }
      : { open: false, reason: "Registration isn't open yet." };
  }

  private inSalesWindow(
    tier: { salesStartAt: Date | null; salesEndAt: Date | null },
    now: Date,
  ): boolean {
    if (tier.salesStartAt && tier.salesStartAt.getTime() > now.getTime()) {
      return false;
    }
    if (tier.salesEndAt && tier.salesEndAt.getTime() < now.getTime()) {
      return false;
    }
    return true;
  }

  private toPublicTicket(
    tier: {
      id: string;
      name: string;
      priceSatang: number;
      isFree: boolean;
      status: string;
      total: number | null;
      sold: number;
      includes: string[] | null;
      isRecommended: boolean;
      badge: string | null;
      salesStartAt: Date | null;
      salesEndAt: Date | null;
    },
    registration: RegistrationState,
  ): PublicTicket {
    const remaining =
      tier.total === null ? null : Math.max(0, tier.total - tier.sold);
    const soldOut =
      remaining === 0 || UNAVAILABLE_STATUSES.includes(tier.status);
    const onSale = this.inSalesWindow(tier, this.clock.now());
    return {
      id: tier.id,
      name: tier.name,
      priceLabel: priceLabel(tier.isFree, tier.priceSatang),
      priceSatang: tier.priceSatang,
      isFree: tier.isFree,
      includes: tier.includes ?? [],
      isRecommended: tier.isRecommended,
      badge: tier.badge,
      soldOut,
      urgency: urgencyLine(remaining, soldOut),
      canRegister: registration.open && onSale && !soldOut,
    };
  }
}

/** Satang → the all-in Baht the attendee pays; VAT is already inside the price. */
function priceLabel(isFree: boolean, priceSatang: number): string {
  if (isFree) return 'Free';
  if (priceSatang === 0) return 'RSVP';
  const baht = priceSatang / 100;
  return `฿${baht.toLocaleString('en-US', {
    minimumFractionDigits: baht % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

function urgencyLine(
  remaining: number | null,
  soldOut: boolean,
): string | null {
  if (soldOut || remaining === null) return null;
  if (remaining > LOW_STOCK_THRESHOLD) return null;
  return `Going fast — only ${remaining} left`;
}

/** An unusable colour quietly falls back to the brand default (US-PAGE-10). */
function usableAccent(accent: string | null): string {
  return accent && ACCENT_PATTERN.test(accent) ? accent : DEFAULT_ACCENT;
}

/** The join produces one row per speaker; fold them back into one session each. */
function groupAgenda(
  rows: {
    id: string;
    title: string;
    day: number;
    startTime: string;
    endTime: string | null;
    type: string;
    room: string | null;
    speakerName: string | null;
  }[],
): PublicSession[] {
  const byId = new Map<string, PublicSession>();
  for (const row of rows) {
    const existing = byId.get(row.id);
    if (existing) {
      if (row.speakerName) existing.speakerNames.push(row.speakerName);
      continue;
    }
    byId.set(row.id, {
      title: row.title,
      day: row.day,
      startTime: row.startTime,
      endTime: row.endTime,
      type: row.type,
      room: row.room,
      speakerNames: row.speakerName ? [row.speakerName] : [],
    });
  }
  return [...byId.values()];
}
