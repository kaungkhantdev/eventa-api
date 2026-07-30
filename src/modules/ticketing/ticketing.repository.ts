import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, isNull, ne, sql } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../db/drizzle.constants';
import { organizations, ticketTypes } from '../../db/schema';
import { withTenant } from '../../db/tenant';
import type { NewTicketValues, TicketRow } from './ticketing.types';

const DEFAULT_VAT_RATE = 0.07;

/** Data access for the Ticketing context. All reads/writes are tenant-scoped. */
@Injectable()
export class TicketingRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** Is `name` already used by a live tier on this event (optionally excluding one)? */
  async nameExists(
    organizationId: number,
    eventId: string,
    name: string,
    excludeId?: string,
  ): Promise<boolean> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .select({ id: ticketTypes.id })
        .from(ticketTypes)
        .where(
          and(
            eq(ticketTypes.organizationId, organizationId),
            eq(ticketTypes.eventId, eventId),
            eq(ticketTypes.name, name),
            isNull(ticketTypes.deletedAt),
            excludeId ? ne(ticketTypes.id, excludeId) : undefined,
          ),
        )
        .limit(1);
      return row !== undefined;
    });
  }

  async insert(values: NewTicketValues): Promise<TicketRow> {
    return withTenant(this.db, values.organizationId, async (tx) => {
      const [row] = await tx.insert(ticketTypes).values(values).returning();
      return row;
    });
  }

  async listByEvent(
    organizationId: number,
    eventId: string,
  ): Promise<TicketRow[]> {
    return withTenant(this.db, organizationId, (tx) =>
      tx
        .select()
        .from(ticketTypes)
        .where(
          and(
            eq(ticketTypes.organizationId, organizationId),
            eq(ticketTypes.eventId, eventId),
            isNull(ticketTypes.deletedAt),
          ),
        )
        .orderBy(asc(ticketTypes.createdAt)),
    );
  }

  async findTicket(
    organizationId: number,
    eventId: string,
    ticketId: string,
  ): Promise<TicketRow | null> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .select()
        .from(ticketTypes)
        .where(
          and(
            eq(ticketTypes.id, ticketId),
            eq(ticketTypes.eventId, eventId),
            eq(ticketTypes.organizationId, organizationId),
            isNull(ticketTypes.deletedAt),
          ),
        )
        .limit(1);
      return row ?? null;
    });
  }

  /** Optimistic update; null when no row matched (concurrent change) → caller 409s. */
  async update(
    organizationId: number,
    ticketId: string,
    values: Partial<NewTicketValues>,
    currentVersion: number,
  ): Promise<TicketRow | null> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .update(ticketTypes)
        .set({ ...values, version: currentVersion + 1, updatedAt: new Date() })
        .where(
          and(
            eq(ticketTypes.id, ticketId),
            eq(ticketTypes.organizationId, organizationId),
            eq(ticketTypes.version, currentVersion),
            isNull(ticketTypes.deletedAt),
          ),
        )
        .returning();
      return row ?? null;
    });
  }

  async softDelete(organizationId: number, ticketId: string): Promise<boolean> {
    return withTenant(this.db, organizationId, async (tx) => {
      const rows = await tx
        .update(ticketTypes)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(ticketTypes.id, ticketId),
            eq(ticketTypes.organizationId, organizationId),
            isNull(ticketTypes.deletedAt),
          ),
        )
        .returning({ id: ticketTypes.id });
      return rows.length > 0;
    });
  }

  /** Number of live tiers on the event (guards "can't remove the last one"). */
  async countActive(organizationId: number, eventId: string): Promise<number> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(ticketTypes)
        .where(
          and(
            eq(ticketTypes.organizationId, organizationId),
            eq(ticketTypes.eventId, eventId),
            isNull(ticketTypes.deletedAt),
          ),
        );
      return row.count;
    });
  }

  /** Sum of `total` across the event's live tiers (seat-map shortfall check). */
  async sumQuantities(
    organizationId: number,
    eventId: string,
  ): Promise<number> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .select({
          total: sql<number>`coalesce(sum(${ticketTypes.total}), 0)::int`,
        })
        .from(ticketTypes)
        .where(
          and(
            eq(ticketTypes.organizationId, organizationId),
            eq(ticketTypes.eventId, eventId),
            isNull(ticketTypes.deletedAt),
          ),
        );
      return row.total;
    });
  }

  /** Tickets sold across the event's live tiers (proxy for "has registrations"). */
  async sumSold(organizationId: number, eventId: string): Promise<number> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .select({
          sold: sql<number>`coalesce(sum(${ticketTypes.sold}), 0)::int`,
        })
        .from(ticketTypes)
        .where(
          and(
            eq(ticketTypes.organizationId, organizationId),
            eq(ticketTypes.eventId, eventId),
            isNull(ticketTypes.deletedAt),
          ),
        );
      return row.sold;
    });
  }

  /** The org's VAT rate (numeric string → number); default 7% if unset. */
  async orgVatRate(organizationId: number): Promise<number> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .select({ vatRate: organizations.vatRate })
        .from(organizations)
        .where(eq(organizations.id, organizationId))
        .limit(1);
      return row ? Number(row.vatRate) : DEFAULT_VAT_RATE;
    });
  }
}
