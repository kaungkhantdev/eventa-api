import { Injectable } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain.exception';
import { slugify } from '../../common/util/slugify';
import { EventsService } from '../events/events.service';
import type { EventActor } from '../events/events.types';
import { EventPageRepository } from './event-page.repository';
import type {
  PageSettings,
  PreviewInput,
  PreviewPage,
  UpdatePageInput,
} from './event-page.types';

/** Used when no accent is set, or the one given is unusable (US-PAGE-10). */
const DEFAULT_ACCENT = '#2563EB';
const ACCENT_PATTERN = /^#[0-9a-f]{6}$/i;
const DEFAULT_TEMPLATE = 'aurora';
const DEFAULT_AGENDA_TITLE = 'Agenda';
const DEFAULT_SPEAKERS_TITLE = 'Speakers';
/** A preview with no date still needs one to render; an hour is a sane default. */
const PREVIEW_DEFAULT_DURATION_MS = 60 * 60 * 1000;

/**
 * The organizer's control over the public page: which design it uses, the public
 * address it lives at, its accent colour (US-PAGE-10), and a live preview of
 * unsaved content (US-PAGE-09).
 *
 * Publishing itself stays in EventsService — it already owns the readiness gate
 * (title, date, at least one ticket) and the publish/unpublish lifecycle.
 */
@Injectable()
export class EventPageService {
  constructor(
    private readonly repo: EventPageRepository,
    private readonly events: EventsService,
  ) {}

  /**
   * Bind a design, address and colour. Switching design never touches content,
   * so an organizer can change their mind after publishing with nothing lost.
   */
  async updatePage(
    actor: EventActor,
    eventId: string,
    input: UpdatePageInput,
  ): Promise<PageSettings> {
    await this.events.getEvent(actor, eventId); // 404s outside the caller's org
    const values: Record<string, unknown> = {};
    if (input.template !== undefined) values.landingTemplateId = input.template;
    if (input.accentColor !== undefined) {
      values.accentColor = usableAccent(input.accentColor);
    }
    if (input.agendaTitle !== undefined) values.agendaTitle = input.agendaTitle;
    if (input.speakersTitle !== undefined) {
      values.speakersTitle = input.speakersTitle;
    }
    if (input.slug !== undefined) {
      values.slug = await this.reserveSlug(actor, eventId, input.slug);
    }
    const saved = await this.repo.updatePage(
      actor.organizationId,
      eventId,
      values,
    );
    if (!saved) throw DomainException.notFound('Event not found.');
    return {
      slug: saved.slug,
      template: saved.landingTemplateId ?? DEFAULT_TEMPLATE,
      accentColor: usableAccent(saved.accentColor),
      published: saved.visibility === 'public',
    };
  }

  /** The address must be free within the workspace — the shared link is stable. */
  private async reserveSlug(
    actor: EventActor,
    eventId: string,
    requested: string,
  ): Promise<string> {
    const slug = slugify(requested, 'event');
    if (await this.repo.slugTaken(actor.organizationId, eventId, slug)) {
      throw DomainException.conflict(
        `The address "${slug}" is already in use — pick another.`,
      );
    }
    return slug;
  }

  /**
   * Render a page from values the organizer has typed but NOT saved. Nothing is
   * written — no event, page or draft — and the result is flagged so it is never
   * indexed or counted in public analytics.
   */
  preview(actor: EventActor, input: PreviewInput): Promise<PreviewPage> {
    const startAt = input.startAt ?? new Date().toISOString();
    const endAt =
      input.endAt ??
      new Date(
        new Date(startAt).getTime() + PREVIEW_DEFAULT_DURATION_MS,
      ).toISOString();
    const online = input.isOnline ?? false;
    return Promise.resolve({
      isPreview: true,
      event: {
        id: 'preview',
        slug: 'preview',
        name: input.name ?? 'Untitled event',
        description: input.description ?? null,
        type: input.type ?? 'Conference',
        categoryName: null,
        startAt,
        endAt,
        timezone: 'Asia/Bangkok',
        isOnline: online,
        // An online preview never shows a location, exactly like a live page.
        onlineNote: online ? (input.onlineNote ?? null) : null,
        venueName: online ? null : (input.venueName ?? null),
        venueAddress: online ? null : (input.venueAddress ?? null),
        city: online ? null : (input.city ?? null),
        coverImage: input.coverImage ?? null,
        accentColor: usableAccent(input.accentColor ?? null),
        organizerName: input.organizerName ?? '',
        template: input.template ?? DEFAULT_TEMPLATE,
        locale: 'en',
      },
      highlights: (input.highlights ?? []).map((text) => ({
        text,
        icon: null,
      })),
      agenda: [],
      speakers: [],
      tickets: [],
      faqs: [],
      registration: { open: false, reason: 'This is a preview.' },
      sections: {
        agenda: input.agendaTitle ?? DEFAULT_AGENDA_TITLE,
        speakers: input.speakersTitle ?? DEFAULT_SPEAKERS_TITLE,
      },
      share: {
        title: input.name ?? 'Untitled event',
        description: input.description ?? '',
        image: input.coverImage ?? null,
        url: '',
        noIndex: true, // a preview must never leak into public search
      },
    });
  }
}

function usableAccent(accent: string | null | undefined): string {
  return accent && ACCENT_PATTERN.test(accent) ? accent : DEFAULT_ACCENT;
}
