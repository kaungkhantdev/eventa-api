import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../db/drizzle.constants';
import {
  events,
  orderItems,
  orders,
  seatAssignments,
  seats,
  ticketTypes,
  tickets,
} from '../../db/schema';
import type {
  MyRegistrationRow,
  TicketPassRow,
} from './attendee-tickets.types';

const CONFIRMED = 'confirmed';
/** A personal portal, not an export: one person's purchases are bounded. */
const MAX_REGISTRATIONS = 200;

/**
 * The attendee-portal read model (US-DISC-07/09), in the mould of
 * `PublicPagesRepository` and `RegistrationStatsRepository`: a dedicated
 * read-only surface over registration data.
 *
 * Deliberately CROSS-TENANT: an attendee's registrations span every workspace
 * on the platform, so no `organization_id` scopes these queries. The scope is
 * the PERSON — every query is bound to the signed-in account's email, which is
 * what checkout stamped on the order. Nothing here writes.
 */
@Injectable()
export class AttendeeTicketsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** Every confirmed registration for this email, joined to what the card shows. */
  async registrationsByEmail(email: string): Promise<MyRegistrationRow[]> {
    const rows = await this.db
      .select({
        orderId: orders.id,
        reference: orders.reference,
        eventId: events.id,
        eventSlug: events.slug,
        eventName: events.name,
        startAt: events.startAt,
        endAt: events.endAt,
        timezone: events.timezone,
        venueName: events.venueName,
        venueAddress: events.venueAddress,
        city: events.city,
        isOnline: events.isOnline,
        coverImage: events.coverImage,
        ticketTypeName: ticketTypes.name,
        ticketCount: orders.seats,
        attended: sql<boolean>`EXISTS (
          SELECT 1 FROM ${tickets}
          WHERE ${tickets.orderId} = ${orders.id}
            AND ${tickets.status} = 'checked_in'
        )`,
      })
      .from(orders)
      .innerJoin(events, eq(events.id, orders.eventId))
      .leftJoin(orderItems, eq(orderItems.orderId, orders.id))
      .leftJoin(ticketTypes, eq(ticketTypes.id, orderItems.ticketTypeId))
      .where(
        and(
          eq(orders.buyerEmail, email),
          eq(orders.status, CONFIRMED),
          isNull(orders.deletedAt),
        ),
      )
      .orderBy(asc(events.startAt), asc(orders.id))
      .limit(MAX_REGISTRATIONS);
    return rows;
  }

  /**
   * One issued ticket with everything its pass prints — or null when it does
   * not exist OR does not belong to this email. The two cases are deliberately
   * indistinguishable: ownership is enforced by resolution.
   */
  async ticketByIdForEmail(
    ticketId: string,
    email: string,
  ): Promise<TicketPassRow | null> {
    const [row] = await this.db
      .select({
        id: tickets.id,
        orderId: tickets.orderId,
        orderReference: orders.reference,
        qrToken: tickets.qrToken,
        status: tickets.status,
        holderName: tickets.holderName,
        ticketLabel: tickets.ticketLabel,
        eventName: events.name,
        eventSlug: events.slug,
        startAt: events.startAt,
        timezone: events.timezone,
        venueName: events.venueName,
        venueAddress: events.venueAddress,
        city: events.city,
        isOnline: events.isOnline,
        seatSection: seats.section,
        seatRow: seats.rowLabel,
        seatNumber: seats.seatNumber,
      })
      .from(tickets)
      .innerJoin(orders, eq(orders.id, tickets.orderId))
      .innerJoin(events, eq(events.id, tickets.eventId))
      .leftJoin(
        seatAssignments,
        and(
          eq(seatAssignments.ticketId, tickets.id),
          isNull(seatAssignments.releasedAt),
        ),
      )
      .leftJoin(seats, eq(seats.id, seatAssignments.seatId))
      .where(
        and(
          eq(tickets.id, ticketId),
          eq(orders.buyerEmail, email),
          isNull(tickets.deletedAt),
        ),
      )
      .limit(1);
    if (!row) return null;
    const siblings = await this.db
      .select({ id: tickets.id })
      .from(tickets)
      .where(and(eq(tickets.orderId, row.orderId), isNull(tickets.deletedAt)))
      .orderBy(asc(tickets.id));
    return { ...row, siblingTicketIds: siblings.map((s) => s.id) };
  }
}
