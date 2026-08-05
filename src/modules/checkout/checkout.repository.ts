import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gt, inArray, isNotNull, isNull } from 'drizzle-orm';
import { DomainException } from '../../common/errors/domain.exception';
import { DRIZZLE, type Database } from '../../db/drizzle.constants';
import {
  attendees,
  discountRedemptions,
  orderItems,
  orders,
  organizations,
  seatAssignments,
  seatHolds,
  seats,
  ticketTypes,
  tickets,
} from '../../db/schema';
import { withTenant, type Tx } from '../../db/tenant';
import { OutboxPort, type OutboxEventInput } from '../platform/outbox.port';
import type { OrderTotals } from './checkout-pricing';

/** Fallbacks if a workspace row somehow has none — the Thai statutory rate. */
const DEFAULT_VAT_RATE = 0.07;
const DEFAULT_SERVICE_FEE_RATE = 0.05;

/** The two rates that turn a ticket subtotal into what the attendee pays. */
export interface OrgRates {
  vatRate: number;
  serviceFeeRate: number;
}

export type OrderRow = typeof orders.$inferSelect;
export type TicketRow = typeof tickets.$inferSelect;

/** Everything the money-path transaction needs, resolved before it opens. */
export interface PlaceOrderInput {
  organizationId: number;
  eventId: string;
  reference: string;
  idempotencyKey: string;
  buyer: { name: string; email: string; phone?: string };
  ticketTypeId: string;
  ticketTypeName: string;
  quantity: number;
  /** Reserved seating only; index-aligned with `qrTokens`. */
  seatIds: number[] | null;
  holdIds: number[];
  unitPriceSatang: number;
  totals: OrderTotals;
  discountCodeId: string | null;
  /** True when nothing is owed — a paid order waits for the payment (US-DISC-05). */
  issueTickets: boolean;
  /** Pre-generated, one per admission, so the transaction stays deterministic. */
  qrTokens: string[];
  /** The outbox entry to write beside the order, or null when there is none yet. */
  buildEvent: (order: OrderRow, issued: TicketRow[]) => OutboxEventInput | null;
  now: Date;
}

/** What was placed — `replayed` when an identical request already did this. */
export interface PlacedOrder {
  order: OrderRow;
  tickets: TicketRow[];
  replayed: boolean;
}

/** Everything the settlement transaction needs, resolved before it opens. */
export interface SettleOrderInput {
  organizationId: number;
  orderId: string;
  /** One fresh QR token per admission, minted as tickets are written. */
  mintQrToken: () => string;
  buildConfirmedEvent: (
    order: OrderRow,
    ticketCount: number,
  ) => OutboxEventInput;
  buildRefundEvent: (order: OrderRow, reason: string) => OutboxEventInput;
  /** Runs INSIDE the settlement transaction — the payment ledger's flip to paid. */
  recordPayment: (tx: Tx) => Promise<void>;
  now: Date;
}

export interface SettlementOutcome {
  outcome: 'settled' | 'already_settled' | 'refund_required';
  reference: string;
  ticketCount: number;
}

/** What the settlement judged: the order line, its tier, and the seat picture. */
interface SettlementContext {
  line: {
    orderItemId: number;
    ticketTypeId: string;
    quantity: number;
    tierName: string;
    sold: number;
    total: number;
  } | null;
  seatIds: number[];
  takenSeatIds: number[];
}

/** Why a settlement cannot be honoured, or null when it can. */
function settlementBlocker(context: SettlementContext): string | null {
  if (!context.line) {
    return 'The ticket type on this order no longer exists.';
  }
  const { sold, total, quantity } = context.line;
  if (total !== UNLIMITED && sold + quantity > total) {
    return 'The tickets sold out while the payment was being made.';
  }
  if (context.takenSeatIds.length > 0) {
    return 'The seats were taken while the payment was being made.';
  }
  // A reserved-seating order must seat every admission it is about to ticket.
  if (context.seatIds.length > 0 && context.seatIds.length !== quantity) {
    return 'The seat reservation no longer matches the order.';
  }
  return null;
}

/** An allocation of 0 means unlimited — mirrors `TicketingPolicy`. */
const UNLIMITED = 0;
const ACTIVE_HOLD = 'active';

/**
 * Data access for the checkout, including THE money-path transaction
 * (`placeOrder`). Tenant-scoped throughout, and the tenant always comes from the
 * event rather than the caller.
 */
@Injectable()
export class CheckoutRepository {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly outbox: OutboxPort,
  ) {}

  /**
   * Place an order, and — when nothing is owed — issue its tickets, in ONE
   * transaction (AGENTS.md: money/inventory is synchronous, row-locked and
   * idempotent; never behind the queue).
   *
   * The order of operations is the safety property:
   *   1. An existing order for this idempotency key short-circuits the whole
   *      thing, so a double-tapped Confirm returns the first registration rather
   *      than placing a second.
   *   2. The buyer's holds are re-checked as still active — a lapsed hold means
   *      the inventory went back on sale and this order cannot be honoured.
   *   3. The ticket type is locked `FOR UPDATE` before `sold` moves, so two
   *      confirms cannot push it past its allocation.
   *   4. Seat assignments rely on `uq_seat_active`: if another buyer's order won
   *      the seat between the hold and here, the insert fails and this whole
   *      transaction rolls back — nobody is charged for a seat they did not get.
   *   5. The outbox row is written INSIDE the transaction, so the confirmation
   *      email lives or dies with the ticket it promises.
   */
  async placeOrder(input: PlaceOrderInput): Promise<PlacedOrder> {
    return withTenant(this.db, input.organizationId, async (tx) => {
      const existing = await this.findByIdempotencyKey(
        tx,
        input.organizationId,
        input.idempotencyKey,
      );
      if (existing) return { ...existing, replayed: true };

      await this.assertHoldsStillActive(tx, input);
      const attendeeId = await this.upsertAttendee(tx, input);
      const order = await this.insertOrder(tx, input, attendeeId);
      const item = await this.insertOrderItem(tx, input, order.id);
      const issued = input.issueTickets
        ? await this.issueTickets(tx, input, order, item.id, attendeeId)
        : [];
      if (input.issueTickets) await this.convertHolds(tx, input);
      // A paid order keeps its holds live but stamps them with the order, so
      // settlement can find its seats and an expiry can release exactly these.
      if (!input.issueTickets) await this.attachHolds(tx, input, order.id);
      await this.recordRedemption(tx, input, order.id);
      const event = input.buildEvent(order, issued);
      if (event) await this.outbox.enqueueIn(tx, event);
      // Sorted the same way the replay reads them, so confirming twice returns
      // an identical response rather than the same tickets in another order.
      return { order, tickets: byId(issued), replayed: false };
    });
  }

  /**
   * An order looked up with NO tenant scope — the payment surface's equivalent
   * of `organizationIdFor`: an anonymous buyer has no tenant, and the order row
   * (reached by an unguessable uuid) is what establishes one.
   */
  async findOrderAnyTenant(orderId: string): Promise<OrderRow | null> {
    const [row] = await this.db
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);
    return row ?? null;
  }

  /** A tenant-scoped order read (settlement pre-flight). */
  async orderById(
    organizationId: number,
    orderId: string,
  ): Promise<OrderRow | null> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .select()
        .from(orders)
        .where(
          and(
            eq(orders.id, orderId),
            eq(orders.organizationId, organizationId),
          ),
        )
        .limit(1);
      return row ?? null;
    });
  }

  /**
   * The money arrived — complete a pending paid order (US-DISC-05): issue one
   * ticket per admission, assign the held seats, bump `sold`, convert the holds,
   * flip the order to confirmed/paid, and queue the confirmation — with the
   * caller's `recordPayment` running in the SAME transaction, so the ledger line
   * and the tickets it paid for commit together or not at all.
   *
   * Exactly-once: the order row is locked `FOR UPDATE` and an already-confirmed
   * order reports `already_settled` without touching anything but the ledger.
   *
   * When the inventory can no longer be honoured — the tier sold out or a seat
   * was assigned to someone else while the money was in flight — the order is
   * cancelled, the holds released, and a refund event queued INSTEAD of issuing
   * tickets. Money wins over a mere hold, but never over an assigned seat.
   */
  async settleOrder(input: SettleOrderInput): Promise<SettlementOutcome> {
    return withTenant(this.db, input.organizationId, async (tx) => {
      const order = await this.lockOrder(tx, input);
      if (order.status === 'confirmed') {
        await input.recordPayment(tx);
        return {
          outcome: 'already_settled',
          reference: order.reference,
          ticketCount: order.seats,
        };
      }
      if (order.status !== 'pending') {
        return this.refuseSettlement(
          tx,
          input,
          order,
          'The order was no longer open when the payment arrived.',
        );
      }
      const context = await this.loadSettlement(tx, input, order);
      const blocked = settlementBlocker(context);
      if (blocked) return this.refuseSettlement(tx, input, order, blocked);
      return this.completeSettlement(tx, input, order, context);
    });
  }

  /** Give a lapsed/failed payment's held inventory back (US-DISC-05). */
  async releaseHoldsForOrder(
    organizationId: number,
    orderId: string,
  ): Promise<void> {
    await withTenant(this.db, organizationId, async (tx) => {
      await tx
        .update(seatHolds)
        .set({ status: 'released' })
        .where(
          and(
            eq(seatHolds.organizationId, organizationId),
            eq(seatHolds.orderId, orderId),
            eq(seatHolds.status, ACTIVE_HOLD),
          ),
        );
    });
  }

  /** Queue a refund for money that arrived on an order already paid for. */
  async enqueueRefund(
    organizationId: number,
    event: OutboxEventInput,
  ): Promise<void> {
    await withTenant(this.db, organizationId, (tx) =>
      this.outbox.enqueueIn(tx, event),
    );
  }

  private async lockOrder(tx: Tx, input: SettleOrderInput): Promise<OrderRow> {
    const [order] = await tx
      .select()
      .from(orders)
      .where(
        and(
          eq(orders.id, input.orderId),
          eq(orders.organizationId, input.organizationId),
        ),
      )
      .for('update');
    if (!order) throw DomainException.notFound("This order isn't available.");
    return order;
  }

  private async loadSettlement(
    tx: Tx,
    input: SettleOrderInput,
    order: OrderRow,
  ): Promise<SettlementContext> {
    const [line] = await tx
      .select({
        orderItemId: orderItems.id,
        ticketTypeId: orderItems.ticketTypeId,
        quantity: orderItems.quantity,
        tierName: ticketTypes.name,
        sold: ticketTypes.sold,
        total: ticketTypes.total,
      })
      .from(orderItems)
      .innerJoin(ticketTypes, eq(ticketTypes.id, orderItems.ticketTypeId))
      .where(eq(orderItems.orderId, order.id))
      .limit(1);
    // Lock the tier before judging capacity, so two settlements serialize.
    if (line) {
      await tx
        .select({ id: ticketTypes.id })
        .from(ticketTypes)
        .where(eq(ticketTypes.id, line.ticketTypeId))
        .for('update');
    }
    const seatIds = await this.heldSeatIds(tx, input, order.id);
    return {
      line: line ?? null,
      seatIds,
      takenSeatIds: await this.seatsAlreadyAssigned(tx, input, seatIds),
    };
  }

  private async heldSeatIds(
    tx: Tx,
    input: SettleOrderInput,
    orderId: string,
  ): Promise<number[]> {
    const held = await tx
      .select({ seatId: seatHolds.seatId })
      .from(seatHolds)
      .where(
        and(
          eq(seatHolds.organizationId, input.organizationId),
          eq(seatHolds.orderId, orderId),
          isNotNull(seatHolds.seatId),
        ),
      );
    return held.map((h) => h.seatId).filter((id): id is number => id !== null);
  }

  /**
   * A seat assigned to someone else is gone for good — a hold merely reserves,
   * an assignment IS a ticket. Locked `FOR UPDATE` so a racing settlement of the
   * same seat serializes behind this one and sees its assignment.
   */
  private async seatsAlreadyAssigned(
    tx: Tx,
    input: SettleOrderInput,
    seatIds: number[],
  ): Promise<number[]> {
    if (seatIds.length === 0) return [];
    await tx
      .select({ id: seats.id })
      .from(seats)
      .where(inArray(seats.id, seatIds))
      .for('update');
    const taken = await tx
      .select({ seatId: seatAssignments.seatId })
      .from(seatAssignments)
      .where(
        and(
          eq(seatAssignments.organizationId, input.organizationId),
          inArray(seatAssignments.seatId, seatIds),
          isNull(seatAssignments.releasedAt),
        ),
      );
    return taken.map((t) => t.seatId);
  }

  /** The losing side of the race: cancel, release, refund — never a ticket. */
  private async refuseSettlement(
    tx: Tx,
    input: SettleOrderInput,
    order: OrderRow,
    reason: string,
  ): Promise<SettlementOutcome> {
    await tx
      .update(orders)
      .set({
        status: 'cancelled',
        paymentStatus: 'paid',
        cancelledAt: input.now,
        updatedAt: input.now,
        version: order.version + 1,
      })
      .where(eq(orders.id, order.id));
    await tx
      .update(seatHolds)
      .set({ status: 'released' })
      .where(
        and(
          eq(seatHolds.organizationId, input.organizationId),
          eq(seatHolds.orderId, order.id),
          eq(seatHolds.status, ACTIVE_HOLD),
        ),
      );
    await input.recordPayment(tx);
    await this.outbox.enqueueIn(tx, input.buildRefundEvent(order, reason));
    return {
      outcome: 'refund_required',
      reference: order.reference,
      ticketCount: 0,
    };
  }

  private async completeSettlement(
    tx: Tx,
    input: SettleOrderInput,
    order: OrderRow,
    context: SettlementContext,
  ): Promise<SettlementOutcome> {
    const line = context.line as NonNullable<SettlementContext['line']>;
    await tx
      .update(ticketTypes)
      .set({ sold: line.sold + line.quantity, updatedAt: input.now })
      .where(eq(ticketTypes.id, line.ticketTypeId));
    const issued = await tx
      .insert(tickets)
      .values(
        Array.from({ length: line.quantity }, () => ({
          organizationId: input.organizationId,
          orderId: order.id,
          orderItemId: line.orderItemId,
          eventId: order.eventId,
          ticketTypeId: line.ticketTypeId,
          attendeeId: order.attendeeId,
          qrToken: input.mintQrToken(),
          holderName: order.buyerName,
          ticketLabel: line.tierName,
        })),
      )
      .returning();
    if (context.seatIds.length > 0) {
      await tx.insert(seatAssignments).values(
        context.seatIds.map((seatId, index) => ({
          organizationId: input.organizationId,
          seatId,
          ticketId: issued[index].id,
        })),
      );
    }
    await tx
      .update(seatHolds)
      .set({ status: 'converted', orderId: null })
      .where(
        and(
          eq(seatHolds.organizationId, input.organizationId),
          eq(seatHolds.orderId, order.id),
        ),
      );
    const [updated] = await tx
      .update(orders)
      .set({
        status: 'confirmed',
        paymentStatus: 'paid',
        updatedAt: input.now,
        version: order.version + 1,
      })
      .where(eq(orders.id, order.id))
      .returning();
    await input.recordPayment(tx);
    await this.outbox.enqueueIn(
      tx,
      input.buildConfirmedEvent(updated, issued.length),
    );
    return {
      outcome: 'settled',
      reference: order.reference,
      ticketCount: issued.length,
    };
  }

  /** The order this buyer's key already produced, if any (idempotent replay). */
  private async findByIdempotencyKey(
    tx: Tx,
    organizationId: number,
    idempotencyKey: string,
  ): Promise<{ order: OrderRow; tickets: TicketRow[] } | null> {
    const [order] = await tx
      .select()
      .from(orders)
      .where(
        and(
          eq(orders.organizationId, organizationId),
          eq(orders.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);
    if (!order) return null;
    const issued = await tx
      .select()
      .from(tickets)
      .where(eq(tickets.orderId, order.id))
      .orderBy(asc(tickets.id));
    return { order, tickets: issued };
  }

  /**
   * The reservation must still be live. A lapsed hold released the inventory
   * back to everyone else, so honouring it here would oversell — the buyer is
   * told to pick again, and has not been charged (US-DISC-04/06).
   */
  private async assertHoldsStillActive(
    tx: Tx,
    input: PlaceOrderInput,
  ): Promise<void> {
    const live = await tx
      .select({ id: seatHolds.id })
      .from(seatHolds)
      .where(
        and(
          eq(seatHolds.organizationId, input.organizationId),
          inArray(seatHolds.id, input.holdIds),
          eq(seatHolds.status, ACTIVE_HOLD),
          gt(seatHolds.expiresAt, input.now),
        ),
      );
    if (live.length === input.holdIds.length) return;
    throw DomainException.conflict(
      'Your seats were released while you were checking out. Please choose again.',
    );
  }

  /** One CRM row per person per workspace; a repeat buyer updates, never duplicates. */
  private async upsertAttendee(
    tx: Tx,
    input: PlaceOrderInput,
  ): Promise<number> {
    const [row] = await tx
      .insert(attendees)
      .values({
        organizationId: input.organizationId,
        name: input.buyer.name,
        email: input.buyer.email,
        phone: input.buyer.phone ?? null,
      })
      .onConflictDoUpdate({
        target: [attendees.organizationId, attendees.email],
        set: { name: input.buyer.name, updatedAt: input.now },
      })
      .returning({ id: attendees.id });
    return row.id;
  }

  private async insertOrder(
    tx: Tx,
    input: PlaceOrderInput,
    attendeeId: number,
  ): Promise<OrderRow> {
    const [row] = await tx
      .insert(orders)
      .values({
        organizationId: input.organizationId,
        reference: input.reference,
        idempotencyKey: input.idempotencyKey,
        eventId: input.eventId,
        attendeeId,
        buyerName: input.buyer.name,
        buyerEmail: input.buyer.email,
        buyerPhone: input.buyer.phone ?? null,
        status: input.issueTickets ? 'confirmed' : 'pending',
        paymentStatus: input.issueTickets ? 'paid' : 'pending',
        seats: input.quantity,
        subtotalSatang: input.totals.subtotalSatang,
        discountCodeId: input.discountCodeId,
        discountAmountSatang: input.totals.discountSatang,
        vatAmountSatang: input.totals.vatSatang,
        totalSatang: input.totals.totalSatang,
      })
      .returning();
    return row;
  }

  private async insertOrderItem(
    tx: Tx,
    input: PlaceOrderInput,
    orderId: string,
  ): Promise<{ id: number }> {
    const [row] = await tx
      .insert(orderItems)
      .values({
        organizationId: input.organizationId,
        orderId,
        ticketTypeId: input.ticketTypeId,
        quantity: input.quantity,
        unitPriceSatang: input.unitPriceSatang,
        lineSubtotalSatang: input.totals.subtotalSatang,
      })
      .returning({ id: orderItems.id });
    return row;
  }

  /** Bump `sold` under a row lock, then mint one ticket per admission. */
  private async issueTickets(
    tx: Tx,
    input: PlaceOrderInput,
    order: OrderRow,
    orderItemId: number,
    attendeeId: number,
  ): Promise<TicketRow[]> {
    await this.reserveAllocation(tx, input);
    const issued = await tx
      .insert(tickets)
      .values(
        input.qrTokens.map((qrToken) => ({
          organizationId: input.organizationId,
          orderId: order.id,
          orderItemId,
          eventId: input.eventId,
          ticketTypeId: input.ticketTypeId,
          attendeeId,
          qrToken,
          holderName: input.buyer.name,
          ticketLabel: input.ticketTypeName,
        })),
      )
      .returning();
    await this.assignSeats(tx, input, issued);
    return issued;
  }

  private async reserveAllocation(
    tx: Tx,
    input: PlaceOrderInput,
  ): Promise<void> {
    const [tier] = await tx
      .select()
      .from(ticketTypes)
      .where(
        and(
          eq(ticketTypes.id, input.ticketTypeId),
          eq(ticketTypes.organizationId, input.organizationId),
        ),
      )
      .for('update');
    if (!tier) {
      throw DomainException.conflict('That ticket type is no longer on sale.');
    }
    const sold = tier.sold + input.quantity;
    if (tier.total !== UNLIMITED && sold > tier.total) {
      throw DomainException.conflict(
        'Those tickets sold out while you were checking out. Please choose again.',
      );
    }
    await tx
      .update(ticketTypes)
      .set({ sold, updatedAt: input.now })
      .where(eq(ticketTypes.id, input.ticketTypeId));
  }

  /**
   * Bind each ticket to its seat. `uq_seat_active` is the real guard: if another
   * buyer's order took the seat first this insert fails, the transaction rolls
   * back, and nobody is charged for a seat they did not get (US-DISC-06).
   */
  private async assignSeats(
    tx: Tx,
    input: PlaceOrderInput,
    issued: TicketRow[],
  ): Promise<void> {
    if (!input.seatIds || input.seatIds.length === 0) return;
    await tx.insert(seatAssignments).values(
      input.seatIds.map((seatId, index) => ({
        organizationId: input.organizationId,
        seatId,
        ticketId: issued[index].id,
      })),
    );
  }

  /** A converted hold has become a ticket; it no longer reserves anything. */
  private async convertHolds(tx: Tx, input: PlaceOrderInput): Promise<void> {
    if (input.holdIds.length === 0) return;
    await tx
      .update(seatHolds)
      .set({ status: 'converted', orderId: null })
      .where(
        and(
          eq(seatHolds.organizationId, input.organizationId),
          inArray(seatHolds.id, input.holdIds),
        ),
      );
  }

  private async attachHolds(
    tx: Tx,
    input: PlaceOrderInput,
    orderId: string,
  ): Promise<void> {
    if (input.holdIds.length === 0) return;
    await tx
      .update(seatHolds)
      .set({ orderId })
      .where(
        and(
          eq(seatHolds.organizationId, input.organizationId),
          inArray(seatHolds.id, input.holdIds),
        ),
      );
  }

  /** The row set that `discount_codes.used` counts (US-TKT-11). */
  private async recordRedemption(
    tx: Tx,
    input: PlaceOrderInput,
    orderId: string,
  ): Promise<void> {
    if (!input.discountCodeId || input.totals.discountSatang === 0) return;
    await tx
      .insert(discountRedemptions)
      .values({
        organizationId: input.organizationId,
        discountCodeId: input.discountCodeId,
        orderId,
        buyerEmail: input.buyer.email,
        amountSatang: input.totals.discountSatang,
      })
      .onConflictDoNothing();
  }

  /**
   * VAT and service-fee rates for the workspace selling the ticket. Read at the
   * moment of pricing rather than baked into a constant, so a workspace that
   * negotiated a different fee is charged its own.
   */
  async orgRates(organizationId: number): Promise<OrgRates> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .select({
          vatRate: organizations.vatRate,
          serviceFeeRate: organizations.serviceFeeRate,
        })
        .from(organizations)
        .where(eq(organizations.id, organizationId))
        .limit(1);
      return {
        vatRate: row ? Number(row.vatRate) : DEFAULT_VAT_RATE,
        serviceFeeRate: row
          ? Number(row.serviceFeeRate)
          : DEFAULT_SERVICE_FEE_RATE,
      };
    });
  }
}

/**
 * Tickets are interchangeable admissions, so their order carries no meaning —
 * but it must be the SAME order every time, or an idempotent replay would look
 * like a different response. `id` is stable and unique; the replay reads them
 * back with the matching `ORDER BY`.
 */
function byId(rows: TicketRow[]): TicketRow[] {
  return [...rows].sort((a, b) => a.id.localeCompare(b.id));
}
