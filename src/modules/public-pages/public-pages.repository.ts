import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../db/drizzle.constants';
import {
  categories,
  eventFaqs,
  eventHighlights,
  events,
  sessionSpeakers,
  sessions,
  speakers,
  ticketTypes,
} from '../../db/schema';

/** Statuses whose page is live to the public — a draft or cancelled event is not. */
const LIVE_STATUSES = ['planned', 'upcoming', 'live'] as const;
/** Only a public event is reachable by link; unlisted/private are not. */
const PUBLIC_VISIBILITY = 'public';

/**
 * Reads for the ANONYMOUS public page. Deliberately not tenant-scoped: a visitor
 * has no tenant context, and the event's own row supplies the organization for
 * every child query — so a page can only ever assemble its own event's content.
 */
@Injectable()
export class PublicPagesRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** The live, publicly-visible event for a slug — null for anything else. */
  async findPublishedBySlug(slug: string) {
    const [row] = await this.db
      .select({
        id: events.id,
        organizationId: events.organizationId,
        slug: events.slug,
        name: events.name,
        description: events.description,
        type: events.type,
        status: events.status,
        visibility: events.visibility,
        startAt: events.startAt,
        endAt: events.endAt,
        timezone: events.timezone,
        isOnline: events.isOnline,
        onlineNote: events.onlineNote,
        venueName: events.venueName,
        venueAddress: events.venueAddress,
        city: events.city,
        coverImage: events.coverImage,
        accentColor: events.accentColor,
        organizerName: events.organizerName,
        landingTemplateId: events.landingTemplateId,
        agendaTitle: events.agendaTitle,
        speakersTitle: events.speakersTitle,
        publishedAt: events.publishedAt,
        categoryName: categories.name,
      })
      .from(events)
      .leftJoin(categories, eq(categories.id, events.categoryId))
      .where(
        and(
          eq(events.slug, slug),
          eq(events.visibility, PUBLIC_VISIBILITY),
          isNull(events.deletedAt),
        ),
      )
      .limit(1);
    if (!row) return null;
    const live = LIVE_STATUSES.some((s) => s === row.status);
    return live && row.publishedAt !== null ? row : null;
  }

  highlights(eventId: string) {
    return this.db
      .select({ text: eventHighlights.text, icon: eventHighlights.icon })
      .from(eventHighlights)
      .where(eq(eventHighlights.eventId, eventId))
      .orderBy(asc(eventHighlights.position), asc(eventHighlights.id));
  }

  faqs(eventId: string) {
    return this.db
      .select({ question: eventFaqs.question, answer: eventFaqs.answer })
      .from(eventFaqs)
      .where(eq(eventFaqs.eventId, eventId))
      .orderBy(asc(eventFaqs.position), asc(eventFaqs.id));
  }

  async agenda(eventId: string) {
    const rows = await this.db
      .select({
        id: sessions.id,
        title: sessions.title,
        day: sessions.day,
        startTime: sessions.startTime,
        endTime: sessions.endTime,
        type: sessions.type,
        room: sessions.room,
        speakerName: speakers.name,
      })
      .from(sessions)
      .leftJoin(sessionSpeakers, eq(sessionSpeakers.sessionId, sessions.id))
      .leftJoin(speakers, eq(speakers.id, sessionSpeakers.speakerId))
      .where(and(eq(sessions.eventId, eventId), isNull(sessions.deletedAt)))
      .orderBy(
        asc(sessions.day),
        asc(sessions.sortOrder),
        asc(sessions.startTime),
      );
    return rows;
  }

  speakers(eventId: string) {
    return this.db
      .select({
        name: speakers.name,
        role: speakers.role,
        talkTitle: speakers.talkTitle,
        initials: speakers.initials,
        tone: speakers.tone,
      })
      .from(speakers)
      .where(and(eq(speakers.eventId, eventId), isNull(speakers.deletedAt)))
      .orderBy(asc(speakers.id));
  }

  tickets(eventId: string) {
    return this.db
      .select({
        id: ticketTypes.id,
        name: ticketTypes.name,
        priceSatang: ticketTypes.priceSatang,
        isFree: ticketTypes.isFree,
        status: ticketTypes.status,
        total: ticketTypes.total,
        sold: ticketTypes.sold,
        includes: ticketTypes.includes,
        isRecommended: ticketTypes.isRecommended,
        badge: ticketTypes.badge,
        salesStartAt: ticketTypes.salesStartAt,
        salesEndAt: ticketTypes.salesEndAt,
      })
      .from(ticketTypes)
      .where(
        and(eq(ticketTypes.eventId, eventId), isNull(ticketTypes.deletedAt)),
      )
      .orderBy(asc(ticketTypes.id));
  }
}
