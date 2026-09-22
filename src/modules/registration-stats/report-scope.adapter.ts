import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../db/drizzle.constants';
import { events } from '../../db/schema';
import { withTenant } from '../../db/tenant';
import { ReportScopePort } from '../reports/ports/report-scope.port';

/**
 * The name of the event a report was filtered to (US-RPT-11), so Reports can
 * print it on an export without reading the events table itself.
 *
 * Scoped by organization as well as by id: the export's "Applied filters" line
 * is written into a file that leaves the product, and a name fetched by id
 * alone would put another workspace's event into this one's PDF.
 */
@Injectable()
export class ReportScopeAdapter extends ReportScopePort {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {
    super();
  }

  async eventName(
    organizationId: number,
    eventId: string,
  ): Promise<string | null> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .select({ name: events.name })
        .from(events)
        .where(
          and(
            eq(events.id, eventId),
            eq(events.organizationId, organizationId),
            isNull(events.deletedAt),
          ),
        )
        .limit(1);
      return row?.name ?? null;
    });
  }
}
