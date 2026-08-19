import { Inject, Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../db/drizzle.constants';
import { eventFaqs, eventHighlights } from '../../db/schema';
import { withTenant } from '../../db/tenant';

export type HighlightRow = typeof eventHighlights.$inferSelect;
export type FaqRow = typeof eventFaqs.$inferSelect;

/** Data access for the ordered page content an organizer arranges. */
@Injectable()
export class EventPageContentRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  listHighlights(
    organizationId: number,
    eventId: string,
  ): Promise<HighlightRow[]> {
    return withTenant(this.db, organizationId, (tx) =>
      tx
        .select()
        .from(eventHighlights)
        .where(eq(eventHighlights.eventId, eventId))
        .orderBy(asc(eventHighlights.position), asc(eventHighlights.id)),
    );
  }

  listFaqs(organizationId: number, eventId: string): Promise<FaqRow[]> {
    return withTenant(this.db, organizationId, (tx) =>
      tx
        .select()
        .from(eventFaqs)
        .where(eq(eventFaqs.eventId, eventId))
        .orderBy(asc(eventFaqs.position), asc(eventFaqs.id)),
    );
  }

  /**
   * Replace the whole ordered list in one transaction — the organizer arranges
   * them as a set, so a partial write would leave a visibly wrong order.
   */
  async replaceHighlights(
    organizationId: number,
    eventId: string,
    items: { text: string; icon?: string | null }[],
  ): Promise<HighlightRow[]> {
    return withTenant(this.db, organizationId, async (tx) => {
      await tx
        .delete(eventHighlights)
        .where(eq(eventHighlights.eventId, eventId));
      if (items.length > 0) {
        await tx.insert(eventHighlights).values(
          items.map((item, position) => ({
            organizationId,
            eventId,
            text: item.text,
            icon: item.icon ?? null,
            position,
          })),
        );
      }
      return tx
        .select()
        .from(eventHighlights)
        .where(eq(eventHighlights.eventId, eventId))
        .orderBy(asc(eventHighlights.position), asc(eventHighlights.id));
    });
  }

  async replaceFaqs(
    organizationId: number,
    eventId: string,
    items: { question: string; answer: string }[],
  ): Promise<FaqRow[]> {
    return withTenant(this.db, organizationId, async (tx) => {
      await tx.delete(eventFaqs).where(eq(eventFaqs.eventId, eventId));
      if (items.length > 0) {
        await tx.insert(eventFaqs).values(
          items.map((item, position) => ({
            organizationId,
            eventId,
            question: item.question,
            answer: item.answer,
            position,
          })),
        );
      }
      return tx
        .select()
        .from(eventFaqs)
        .where(eq(eventFaqs.eventId, eventId))
        .orderBy(asc(eventFaqs.position), asc(eventFaqs.id));
    });
  }
}
