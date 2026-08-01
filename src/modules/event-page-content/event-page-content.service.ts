import { Injectable } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain.exception';
import { EventsService } from '../events/events.service';
import type { EventActor } from '../events/events.types';
import { EventPageContentRepository } from './event-page-content.repository';

/** Keeps a page readable; beyond this it is a document, not a highlight list. */
const MAX_HIGHLIGHTS = 12;
const MAX_FAQS = 30;

export interface HighlightView {
  text: string;
  icon: string | null;
}
export interface FaqView {
  question: string;
  answer: string;
}

/**
 * The supplementary content an organizer arranges on the public page —
 * highlights (US-PAGE-04) and FAQs (US-PAGE-06). Both are ordered lists replaced
 * as a whole, so what the organizer sees is exactly what the page renders.
 */
@Injectable()
export class EventPageContentService {
  constructor(
    private readonly repo: EventPageContentRepository,
    private readonly events: EventsService,
  ) {}

  async listHighlights(
    actor: EventActor,
    eventId: string,
  ): Promise<HighlightView[]> {
    await this.events.getEvent(actor, eventId);
    const rows = await this.repo.listHighlights(actor.organizationId, eventId);
    return rows.map((r) => ({ text: r.text, icon: r.icon }));
  }

  async setHighlights(
    actor: EventActor,
    eventId: string,
    items: HighlightView[],
  ): Promise<HighlightView[]> {
    await this.events.getEvent(actor, eventId);
    if (items.length > MAX_HIGHLIGHTS) {
      throw DomainException.validation(
        `A page shows at most ${MAX_HIGHLIGHTS} highlights.`,
      );
    }
    const rows = await this.repo.replaceHighlights(
      actor.organizationId,
      eventId,
      items,
    );
    return rows.map((r) => ({ text: r.text, icon: r.icon }));
  }

  async listFaqs(actor: EventActor, eventId: string): Promise<FaqView[]> {
    await this.events.getEvent(actor, eventId);
    const rows = await this.repo.listFaqs(actor.organizationId, eventId);
    return rows.map((r) => ({ question: r.question, answer: r.answer }));
  }

  async setFaqs(
    actor: EventActor,
    eventId: string,
    items: FaqView[],
  ): Promise<FaqView[]> {
    await this.events.getEvent(actor, eventId);
    if (items.length > MAX_FAQS) {
      throw DomainException.validation(
        `A page shows at most ${MAX_FAQS} FAQs.`,
      );
    }
    const rows = await this.repo.replaceFaqs(
      actor.organizationId,
      eventId,
      items,
    );
    return rows.map((r) => ({ question: r.question, answer: r.answer }));
  }
}
