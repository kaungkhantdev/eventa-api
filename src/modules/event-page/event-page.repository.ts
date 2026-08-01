import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, ne } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../db/drizzle.constants';
import { events } from '../../db/schema';
import { withTenant } from '../../db/tenant';

export type PageValues = Partial<{
  slug: string;
  landingTemplateId: string;
  accentColor: string;
  agendaTitle: string | null;
  speakersTitle: string | null;
}>;

/** Data access for an event's public-page settings (US-PAGE-10). */
@Injectable()
export class EventPageRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** Is this public address already used by ANOTHER event in the workspace? */
  async slugTaken(
    organizationId: number,
    eventId: string,
    slug: string,
  ): Promise<boolean> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .select({ id: events.id })
        .from(events)
        .where(
          and(
            eq(events.organizationId, organizationId),
            eq(events.slug, slug),
            ne(events.id, eventId),
            isNull(events.deletedAt),
          ),
        )
        .limit(1);
      return row !== undefined;
    });
  }

  async updatePage(
    organizationId: number,
    eventId: string,
    values: PageValues,
  ) {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .update(events)
        .set({ ...values, updatedAt: new Date() })
        .where(
          and(
            eq(events.id, eventId),
            eq(events.organizationId, organizationId),
          ),
        )
        .returning({
          slug: events.slug,
          landingTemplateId: events.landingTemplateId,
          accentColor: events.accentColor,
          visibility: events.visibility,
        });
      return row;
    });
  }
}
