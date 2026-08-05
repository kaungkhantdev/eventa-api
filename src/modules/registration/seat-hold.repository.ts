import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  asc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lte,
  notInArray,
  sql,
} from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../db/drizzle.constants';
import {
  seatAssignments,
  seatHolds,
  seatMaps,
  seats,
  ticketTypes,
} from '../../db/schema';
import { withTenant, type Tx } from '../../db/tenant';
import type { CheckoutSeat } from '../checkout/checkout.types';
import type { HoldQuantityResult, HoldSeatsResult } from './seat-hold.types';

type NewSeatHold = typeof seatHolds.$inferInsert;

const ACTIVE = 'active' as const;

/**
 * Data access for the checkout seat-hold engine. These methods run the money-path
 * reservation transaction: they lock inventory rows (`SELECT … FOR UPDATE`) across
 * seats / ticket_types and write `seat_holds` atomically. This is the sanctioned
 * cross-context transaction (AGENTS.md: "money/inventory … in one DB transaction").
 * Every query is tenant-scoped by `organization_id` and by RLS (defence in depth),
 * and every method is safe for a direct caller (the checkout slice) — not only the
 * validated service path.
 */
@Injectable()
export class SeatHoldRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /**
   * Reserve specific seats, all-or-nothing. Locks the seat rows `FOR UPDATE` so
   * concurrent buyers serialize; self-heals any lapsed hold on those seats first
   * (freeing the `uq_seat_hold_active` unique), then re-checks availability under
   * the lock before inserting. A seat is holdable only if it exists, belongs to
   * this event, is `available`, has no active hold, and has no live assignment.
   */
  async holdSeats(
    organizationId: number,
    eventId: string,
    seatIds: number[],
    expiresAt: Date,
    now: Date,
    orderId?: string,
  ): Promise<HoldSeatsResult> {
    // Dedupe at the boundary: a repeated id would otherwise insert two active
    // rows for one seat and trip uq_seat_hold_active (a 500). No ids → nothing held.
    const ids = [...new Set(seatIds)];
    if (ids.length === 0) return { ok: false, unavailableSeatIds: [] };

    return withTenant(this.db, organizationId, async (tx) => {
      const locked = await tx
        .select()
        .from(seats)
        .where(
          and(eq(seats.organizationId, organizationId), inArray(seats.id, ids)),
        )
        .for('update');
      const seatById = new Map(locked.map((s) => [s.id, s]));
      const eventByMap = await this.eventByMap(
        tx,
        organizationId,
        locked.map((s) => s.seatMapId),
      );

      await this.expireLapsedForSeats(tx, organizationId, ids, now);
      const heldSet = await this.activeHeldSeatIds(tx, organizationId, ids);
      const assignedSet = await this.assignedSeatIds(tx, organizationId, ids);

      const unavailableSeatIds = ids.filter((id) => {
        const seat = seatById.get(id);
        return (
          !seat ||
          eventByMap.get(seat.seatMapId) !== eventId ||
          seat.status !== 'available' ||
          heldSet.has(id) ||
          assignedSet.has(id)
        );
      });
      if (unavailableSeatIds.length > 0) {
        return { ok: false, unavailableSeatIds };
      }

      const holds = await tx
        .insert(seatHolds)
        .values(
          ids.map((seatId): NewSeatHold => ({
            organizationId,
            eventId,
            seatId,
            quantity: 1,
            status: ACTIVE,
            expiresAt,
            orderId: orderId ?? null,
          })),
        )
        .returning();
      return { ok: true, holds };
    });
  }

  /**
   * Reserve a quantity against a GA tier. Locks the ticket-type row `FOR UPDATE`
   * to serialize buyers, self-heals lapsed GA holds, then reserves only if
   * `total − sold − activeHeld` still covers the request (never oversells).
   */
  async holdQuantity(
    organizationId: number,
    eventId: string,
    ticketTypeId: string,
    quantity: number,
    expiresAt: Date,
    now: Date,
    orderId?: string,
  ): Promise<HoldQuantityResult> {
    // Guard the money-path invariant even for a direct caller: a non-positive
    // quantity must never insert a hold (it would corrupt the availability sum).
    if (!Number.isInteger(quantity) || quantity < 1) {
      return { ok: false, available: 0 };
    }

    return withTenant(this.db, organizationId, async (tx) => {
      const [tier] = await tx
        .select()
        .from(ticketTypes)
        .where(
          and(
            eq(ticketTypes.id, ticketTypeId),
            eq(ticketTypes.organizationId, organizationId),
            eq(ticketTypes.eventId, eventId),
            isNull(ticketTypes.deletedAt),
          ),
        )
        .for('update');
      if (!tier) return { ok: false, available: 0 };

      await this.expireLapsedForTier(tx, organizationId, ticketTypeId, now);
      const held = await this.activeHeldQuantity(
        tx,
        organizationId,
        ticketTypeId,
      );
      const available = Math.max(0, tier.total - tier.sold - held);
      if (quantity > available) return { ok: false, available };

      const [hold] = await tx
        .insert(seatHolds)
        .values({
          organizationId,
          eventId,
          ticketTypeId,
          quantity,
          status: ACTIVE,
          expiresAt,
          orderId: orderId ?? null,
        })
        .returning();
      return { ok: true, hold };
    });
  }

  /**
   * Every seat of an event's map with whether it can be picked right now — backs
   * `SeatMapPort` for drawing the checkout seat map (US-DISC-04). A seat is
   * offered only if it is `available`, has no unexpired active hold, and carries
   * no live assignment; a lapsed hold reserves nothing, so it does not block.
   *
   * A READ, not a reservation: no row locks, and the answer may be stale by the
   * time the buyer clicks. `holdSeats` re-checks under a lock and remains the
   * only authority — this exists so the map greys out what is obviously gone.
   */
  async seatsForEvent(
    organizationId: number,
    eventId: string,
    now: Date,
    ownHoldIds: number[] = [],
  ): Promise<CheckoutSeat[]> {
    return withTenant(this.db, organizationId, async (tx) => {
      const rows = await tx
        .select({
          id: seats.id,
          section: seats.section,
          rowLabel: seats.rowLabel,
          seatNumber: seats.seatNumber,
          ticketTypeId: seats.ticketTypeId,
          status: seats.status,
          heldUntil: seatHolds.expiresAt,
          assignedAt: seatAssignments.assignedAt,
        })
        .from(seats)
        .innerJoin(seatMaps, eq(seats.seatMapId, seatMaps.id))
        .leftJoin(
          seatHolds,
          and(
            eq(seatHolds.seatId, seats.id),
            eq(seatHolds.status, ACTIVE),
            gt(seatHolds.expiresAt, now),
            // The caller's own reservation does not make a seat unavailable
            // to the caller — otherwise confirming your own hold would 409.
            ownHoldIds.length > 0
              ? notInArray(seatHolds.id, ownHoldIds)
              : undefined,
          ),
        )
        .leftJoin(
          seatAssignments,
          and(
            eq(seatAssignments.seatId, seats.id),
            isNull(seatAssignments.releasedAt),
          ),
        )
        .where(
          and(
            eq(seats.organizationId, organizationId),
            eq(seatMaps.eventId, eventId),
          ),
        )
        .orderBy(asc(seats.section), asc(seats.rowLabel), asc(seats.id));
      return rows.map((r) => ({
        id: r.id,
        section: r.section,
        rowLabel: r.rowLabel,
        seatNumber: r.seatNumber,
        ticketTypeId: r.ticketTypeId,
        available:
          r.status === 'available' &&
          r.heldUntil === null &&
          r.assignedAt === null,
      }));
    });
  }

  /**
   * The distinct ticket tiers backing the given seats within an event — the sales
   * eligibility gate reads these before reserving. Seats with no tier are omitted;
   * a read outside the reservation transaction (no locking), scoped by tenant + event.
   */
  async ticketTypeIdsForSeats(
    organizationId: number,
    eventId: string,
    seatIds: number[],
  ): Promise<string[]> {
    const ids = [...new Set(seatIds)];
    if (ids.length === 0) return [];
    return withTenant(this.db, organizationId, async (tx) => {
      const rows = await tx
        .selectDistinct({ ticketTypeId: seats.ticketTypeId })
        .from(seats)
        .innerJoin(seatMaps, eq(seats.seatMapId, seatMaps.id))
        .where(
          and(
            eq(seats.organizationId, organizationId),
            inArray(seats.id, ids),
            eq(seatMaps.eventId, eventId),
            isNotNull(seats.ticketTypeId),
          ),
        );
      return rows
        .map((r) => r.ticketTypeId)
        .filter((id): id is string => id !== null);
    });
  }

  /**
   * Is a checkout still holding this tier? Only unexpired `active` holds count —
   * a lapsed one reserves nothing and must not block the organizer (US-TKT-05).
   */
  async hasActiveHolds(
    organizationId: number,
    ticketTypeId: string,
    now: Date,
  ): Promise<boolean> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .select({ id: seatHolds.id })
        .from(seatHolds)
        .where(
          and(
            eq(seatHolds.organizationId, organizationId),
            eq(seatHolds.ticketTypeId, ticketTypeId),
            eq(seatHolds.status, 'active'),
            sql`${seatHolds.expiresAt} > ${now}`,
          ),
        )
        .limit(1);
      return row !== undefined;
    });
  }

  /** Release active holds early (buyer abandoned checkout) — frees the inventory. */
  async release(organizationId: number, holdIds: number[]): Promise<void> {
    if (holdIds.length === 0) return;
    await withTenant(this.db, organizationId, async (tx) => {
      await tx
        .update(seatHolds)
        .set({ status: 'released' })
        .where(
          and(
            eq(seatHolds.organizationId, organizationId),
            inArray(seatHolds.id, holdIds),
            eq(seatHolds.status, ACTIVE),
          ),
        );
    });
  }

  /** Flip this tenant's lapsed active holds to `expired`; returns how many. */
  async expireStale(organizationId: number, now: Date): Promise<number> {
    return withTenant(this.db, organizationId, async (tx) => {
      const swept = await tx
        .update(seatHolds)
        .set({ status: 'expired' })
        .where(
          and(
            eq(seatHolds.organizationId, organizationId),
            eq(seatHolds.status, ACTIVE),
            lte(seatHolds.expiresAt, now),
          ),
        )
        .returning({ id: seatHolds.id });
      return swept.length;
    });
  }

  /** Map each seat_map id to the event it belongs to (for event-membership checks). */
  private async eventByMap(
    tx: Tx,
    organizationId: number,
    seatMapIds: number[],
  ): Promise<Map<number, string>> {
    const ids = [...new Set(seatMapIds)];
    if (ids.length === 0) return new Map();
    const rows = await tx
      .select({ id: seatMaps.id, eventId: seatMaps.eventId })
      .from(seatMaps)
      .where(
        and(
          eq(seatMaps.organizationId, organizationId),
          inArray(seatMaps.id, ids),
        ),
      );
    return new Map(rows.map((r) => [r.id, r.eventId]));
  }

  private async expireLapsedForSeats(
    tx: Tx,
    organizationId: number,
    seatIds: number[],
    now: Date,
  ): Promise<void> {
    await tx
      .update(seatHolds)
      .set({ status: 'expired' })
      .where(
        and(
          eq(seatHolds.organizationId, organizationId),
          inArray(seatHolds.seatId, seatIds),
          eq(seatHolds.status, ACTIVE),
          lte(seatHolds.expiresAt, now),
        ),
      );
  }

  private async expireLapsedForTier(
    tx: Tx,
    organizationId: number,
    ticketTypeId: string,
    now: Date,
  ): Promise<void> {
    await tx
      .update(seatHolds)
      .set({ status: 'expired' })
      .where(
        and(
          eq(seatHolds.organizationId, organizationId),
          eq(seatHolds.ticketTypeId, ticketTypeId),
          eq(seatHolds.status, ACTIVE),
          lte(seatHolds.expiresAt, now),
        ),
      );
  }

  private async activeHeldSeatIds(
    tx: Tx,
    organizationId: number,
    seatIds: number[],
  ): Promise<Set<number | null>> {
    const rows = await tx
      .select({ seatId: seatHolds.seatId })
      .from(seatHolds)
      .where(
        and(
          eq(seatHolds.organizationId, organizationId),
          inArray(seatHolds.seatId, seatIds),
          eq(seatHolds.status, ACTIVE),
        ),
      );
    return new Set(rows.map((r) => r.seatId));
  }

  private async assignedSeatIds(
    tx: Tx,
    organizationId: number,
    seatIds: number[],
  ): Promise<Set<number>> {
    const rows = await tx
      .select({ seatId: seatAssignments.seatId })
      .from(seatAssignments)
      .where(
        and(
          eq(seatAssignments.organizationId, organizationId),
          inArray(seatAssignments.seatId, seatIds),
          isNull(seatAssignments.releasedAt),
        ),
      );
    return new Set(rows.map((r) => r.seatId));
  }

  private async activeHeldQuantity(
    tx: Tx,
    organizationId: number,
    ticketTypeId: string,
  ): Promise<number> {
    const [row] = await tx
      .select({
        held: sql<number>`coalesce(sum(${seatHolds.quantity}), 0)::int`,
      })
      .from(seatHolds)
      .where(
        and(
          eq(seatHolds.organizationId, organizationId),
          eq(seatHolds.ticketTypeId, ticketTypeId),
          eq(seatHolds.status, ACTIVE),
        ),
      );
    return row.held;
  }
}
