import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../db/drizzle.constants';
import { events, messageDeliveries } from '../../db/schema';
import { withTenant } from '../../db/tenant';

export type DeliveryStatus = 'sent' | 'failed';

export interface DeliveryRow {
  id: string;
  kind: string;
  channel: string;
  recipientEmail: string;
  recipientName: string | null;
  eventId: string | null;
  /** Null when the event has since been deleted; the send still happened. */
  eventName: string | null;
  status: DeliveryStatus;
  error: string | null;
  sentAt: Date;
}

export interface DeliveryFilter {
  status?: DeliveryStatus;
  kind?: string;
  q?: string;
  page: number;
  limit: number;
}

export interface DeliveryPage {
  rows: DeliveryRow[];
  total: number;
  /** How many of the MATCHED set failed — the number worth acting on. */
  failed: number;
}

/**
 * The delivery log (US-MSG-06). Read-only here: eventa-worker writes these rows
 * as it sends, because that is the only moment anything knows what the
 * transport did with a message.
 */
@Injectable()
export class MessageDeliveriesRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async list(
    organizationId: number,
    filter: DeliveryFilter,
  ): Promise<DeliveryPage> {
    const where = and(
      eq(messageDeliveries.organizationId, organizationId),
      filter.status ? eq(messageDeliveries.status, filter.status) : undefined,
      filter.kind ? eq(messageDeliveries.kind, filter.kind) : undefined,
      searchOf(filter.q),
    );

    return withTenant(this.db, organizationId, async (tx) => {
      const [[totals], rows] = await Promise.all([
        tx
          .select({
            total: count(),
            // Counted over the SAME filter as the rows, so "3 failed" always
            // describes the list beneath it rather than the whole workspace.
            //
            // Written as literal SQL with the table spelled out rather than by
            // interpolating the column: Drizzle strips table qualifiers off
            // interpolated columns in some select-list positions, which renders
            // valid SQL that quietly means something else.
            failed: sql<string>`count(*) filter (where message_deliveries.status = 'failed')`,
          })
          .from(messageDeliveries)
          .where(where),
        tx
          .select({
            id: messageDeliveries.id,
            kind: messageDeliveries.kind,
            channel: messageDeliveries.channel,
            recipientEmail: messageDeliveries.recipientEmail,
            recipientName: messageDeliveries.recipientName,
            eventId: messageDeliveries.eventId,
            eventName: events.name,
            status: messageDeliveries.status,
            error: messageDeliveries.error,
            sentAt: messageDeliveries.sentAt,
          })
          .from(messageDeliveries)
          .leftJoin(events, eq(events.id, messageDeliveries.eventId))
          .where(where)
          .orderBy(desc(messageDeliveries.sentAt), desc(messageDeliveries.id))
          .limit(filter.limit)
          .offset((filter.page - 1) * filter.limit),
      ]);

      return {
        total: Number(totals.total),
        failed: Number(totals.failed),
        rows: rows.map((row) => ({ ...row, id: String(row.id) })),
      };
    });
  }

  /** Every kind this workspace has actually sent, for the filter control. */
  async kinds(organizationId: number): Promise<string[]> {
    return withTenant(this.db, organizationId, async (tx) => {
      const rows = await tx
        .selectDistinct({ kind: messageDeliveries.kind })
        .from(messageDeliveries)
        .where(eq(messageDeliveries.organizationId, organizationId))
        .orderBy(messageDeliveries.kind);
      return rows.map((row) => row.kind);
    });
  }
}

/**
 * Search across the person and the address, because an organizer diagnosing a
 * failure has one or the other — a name from the registration list, or the
 * address off a bounce.
 */
function searchOf(term: string | undefined): SQL | undefined {
  const trimmed = term?.trim();
  if (!trimmed) return undefined;
  const pattern = `%${trimmed}%`;
  return or(
    ilike(messageDeliveries.recipientEmail, pattern),
    ilike(messageDeliveries.recipientName, pattern),
  );
}
