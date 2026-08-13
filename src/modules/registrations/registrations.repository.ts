import { Inject, Injectable } from '@nestjs/common';
import { type SQL, and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../db/drizzle.constants';
import { events, orders } from '../../db/schema';
import { withTenant } from '../../db/tenant';
import type {
  RegistrationCounts,
  RegistrationFilters,
  RegistrationRow,
} from './registrations.types';

/**
 * Data access for the registrations queue (US-REG-01). Cross-event and
 * org-wide, unlike the per-event Monitor tab — one predicate builder serves
 * both the page and the tab counts, so the numbers always describe the list.
 */
@Injectable()
export class RegistrationsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async page(
    organizationId: number,
    filters: RegistrationFilters,
  ): Promise<{ items: RegistrationRow[]; total: number }> {
    return withTenant(this.db, organizationId, async (tx) => {
      const where = this.queueWhere(organizationId, filters);
      const [{ count }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(orders)
        .innerJoin(events, eq(events.id, orders.eventId))
        .where(where);
      const rows = await tx
        .select(this.columns())
        .from(orders)
        .innerJoin(events, eq(events.id, orders.eventId))
        .where(where)
        .orderBy(desc(orders.registeredAt), desc(orders.id))
        .limit(filters.limit)
        .offset((filters.page - 1) * filters.limit);
      return { items: rows.map(toRow), total: count };
    });
  }

  /** All five tab totals in ONE scan, so they describe the same instant. */
  async countByStatus(
    organizationId: number,
    filters: Omit<RegistrationFilters, 'status'>,
  ): Promise<RegistrationCounts> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .select({
          pending: sql<number>`count(*) FILTER (WHERE ${orders.status} = 'pending')::int`,
          confirmed: sql<number>`count(*) FILTER (WHERE ${orders.status} = 'confirmed')::int`,
          waitlisted: sql<number>`count(*) FILTER (WHERE ${orders.status} = 'waitlisted')::int`,
          cancelled: sql<number>`count(*) FILTER (WHERE ${orders.status} = 'cancelled')::int`,
          rejected: sql<number>`count(*) FILTER (WHERE ${orders.status} = 'rejected')::int`,
        })
        .from(orders)
        .innerJoin(events, eq(events.id, orders.eventId))
        .where(this.queueWhere(organizationId, filters));
      return row;
    });
  }

  async findById(
    organizationId: number,
    orderId: string,
  ): Promise<RegistrationRow | null> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .select(this.columns())
        .from(orders)
        .innerJoin(events, eq(events.id, orders.eventId))
        .where(
          and(
            eq(orders.organizationId, organizationId),
            eq(orders.id, orderId),
          ),
        )
        .limit(1);
      return row ? toRow(row) : null;
    });
  }

  private columns() {
    return {
      id: orders.id,
      reference: orders.reference,
      eventId: orders.eventId,
      eventName: events.name,
      buyerName: orders.buyerName,
      buyerEmail: orders.buyerEmail,
      status: orders.status,
      paymentStatus: orders.paymentStatus,
      seats: orders.seats,
      totalSatang: orders.totalSatang,
      registeredAt: orders.registeredAt,
      confirmedAt: orders.confirmedAt,
      rejectedAt: orders.rejectedAt,
      cancelledAt: orders.cancelledAt,
    };
  }

  private queueWhere(
    organizationId: number,
    filters: Omit<RegistrationFilters, 'status'> & {
      status?: RegistrationFilters['status'];
    },
  ): SQL | undefined {
    const clauses: (SQL | undefined)[] = [
      eq(orders.organizationId, organizationId),
    ];
    if (filters.status) clauses.push(eq(orders.status, filters.status));
    if (filters.eventId) clauses.push(eq(orders.eventId, filters.eventId));
    if (filters.search) {
      const term = `%${filters.search}%`;
      clauses.push(
        or(
          ilike(orders.buyerName, term),
          ilike(orders.buyerEmail, term),
          ilike(orders.reference, term),
        ),
      );
    }
    return and(...clauses);
  }
}

function toRow(row: Record<string, unknown>): RegistrationRow {
  return {
    id: row.id as string,
    reference: row.reference as string,
    eventId: row.eventId as string,
    eventName: row.eventName as string,
    buyerName: row.buyerName as string,
    buyerEmail: row.buyerEmail as string,
    status: row.status as RegistrationRow['status'],
    paymentStatus: row.paymentStatus as RegistrationRow['paymentStatus'],
    seats: Number(row.seats),
    totalSatang: Number(row.totalSatang),
    registeredAt: row.registeredAt as Date,
    confirmedAt: (row.confirmedAt as Date | null) ?? null,
    rejectedAt: (row.rejectedAt as Date | null) ?? null,
    cancelledAt: (row.cancelledAt as Date | null) ?? null,
  };
}
