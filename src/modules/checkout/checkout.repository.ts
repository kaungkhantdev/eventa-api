import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  asc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  max,
  ne,
  sql,
} from 'drizzle-orm';
import { DomainException } from '../../common/errors/domain.exception';
import { DRIZZLE, type Database } from '../../db/drizzle.constants';
import {
  attendees,
  discountRedemptions,
  events,
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
import type { BillableOrder } from '../invoices/ports/invoice-order.port';
import { OutboxPort, type OutboxEventInput } from '../platform/outbox.port';
import { rejectionRefunds } from '../registrations/registration-decision';
import {
  DECISION_HOLD_EXPIRY,
  isAwaitingApproval,
  statusAfterRefund,
} from './approval-rules';
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
  /** The organizer who entered it by hand (US-REG-03); absent on self-service. */
  createdBy?: string;
  /** True when nothing is owed — a paid order waits for the payment (US-DISC-05). */
  issueTickets: boolean;
  /** The event's "Require approval" rule, copied onto the order (US-REG-02). */
  requiresApproval: boolean;
  /**
   * Free, on an approval event: the organizer's decision is all that is left,
   * so the places are counted now and the reservation outlives its timer.
   */
  awaitsDecision: boolean;
  /** Pre-generated, one per admission, so the transaction stays deterministic. */
  qrTokens: string[];
  /** The outbox entry to write beside the order, or null when there is none yet. */
  buildEvent: (order: OrderRow, issued: TicketRow[]) => OutboxEventInput | null;
  now: Date;
}

/** A waitlist entry to write: priced, but holding nothing (US-REG-04). */
export interface JoinWaitlistInput {
  organizationId: number;
  eventId: string;
  reference: string;
  idempotencyKey: string;
  buyer: { name: string; email: string; phone?: string };
  ticketTypeId: string;
  quantity: number;
  unitPriceSatang: number;
  totals: OrderTotals;
  now: Date;
}

/** The entry, and where it stands; 1 is next in line. */
export interface JoinedWaitlist {
  order: OrderRow;
  position: number;
}

/** The fields an order row is written from, whichever path writes it. */
type OrderInsert = Pick<
  PlaceOrderInput,
  | 'organizationId'
  | 'reference'
  | 'idempotencyKey'
  | 'eventId'
  | 'buyer'
  | 'quantity'
  | 'totals'
> &
  Partial<
    Pick<PlaceOrderInput, 'discountCodeId' | 'createdBy' | 'requiresApproval'>
  >;

/** A waitlist entry with the one line it is waiting for. */
export interface WaitlistEntry {
  order: OrderRow;
  ticketTypeId: string;
  ticketTypeName: string;
  quantity: number;
}

/** Recording an offer whose seats are already held (US-REG-04). */
export interface MarkOfferedInput {
  organizationId: number;
  orderId: string;
  offeredBy: string;
  offerExpiresAt: Date;
  now: Date;
  buildEvent: (order: OrderRow) => OutboxEventInput;
}

/** Where a new order starts out. */
interface OrderState {
  status: OrderRow['status'];
  paymentStatus: OrderRow['paymentStatus'];
  /** Set when it starts out waiting for the organizer (US-REG-02). */
  approvalRequestedAt?: Date | null;
}

/** A registration nobody has been offered a seat for yet. */
const WAITLISTED: OrderState = {
  status: 'waitlisted',
  paymentStatus: 'pending',
};

/** What was placed — `replayed` when an identical request already did this. */
export interface PlacedOrder {
  order: OrderRow;
  tickets: TicketRow[];
  replayed: boolean;
}

/** Everything the settlement transaction needs, resolved before it opens. */
/**
 * Who is settling, and therefore what a refusal means.
 *
 * `payment` — money has arrived. A refusal must move that money back, so the
 * order is cancelled and a refund queued: the buyer has been charged either
 * way, and leaving the order open would let it be charged twice.
 *
 * `approval` — an organizer is deciding (US-REG-02). Nothing has been charged
 * that this refusal must undo, so a refusal changes NOTHING: the registration
 * stays where it was, awaiting a decision, and the organizer is offered the
 * waitlist. Cancelling here would terminate a sign-up on the strength of a
 * transient sell-out.
 */
export type SettlementMode = 'payment' | 'approval';

export interface SettleOrderInput {
  organizationId: number;
  orderId: string;
  /** Defaults to `payment` — the path that existed before approvals. */
  mode?: SettlementMode;
  /** The organizer, on the approval path only. Stamped onto the order. */
  decidedBy?: string;
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

export interface RejectOrderInput {
  organizationId: number;
  orderId: string;
  decidedBy: string;
  reason: string | null;
  /** The decider holds the refund permission — see `rejectOrder`. */
  mayRefund: boolean;
  buildRejectedEvent: (order: OrderRow) => OutboxEventInput;
  now: Date;
}

/** A rejection, and whether it left money to give back (US-REG-02). */
export interface RejectedOrder {
  reference: string;
  /** Paid for while it waited, and not refunded yet — the caller refunds it. */
  refundDue: boolean;
}

interface SettlementBase {
  reference: string;
  ticketCount: number;
  /** Why it could not be honoured — set only on `unavailable`. */
  reason?: string;
}

/**
 * Money arrived: it bought tickets, it has to go back — or, on an order that
 * requires approval (US-REG-02), it paid for places now waiting for the
 * organizer's decision (`awaiting_approval`, no tickets yet).
 */
export interface PaymentSettlement extends SettlementBase {
  outcome:
    'settled' | 'already_settled' | 'refund_required' | 'awaiting_approval';
}

/** An organizer decided: it either issued tickets, or nothing happened. */
export interface ApprovalSettlement extends SettlementBase {
  outcome: 'settled' | 'already_settled' | 'unavailable';
}

/**
 * The two modes can each produce only three of the four outcomes, and the
 * overloads on `settleOrder` make that a fact the compiler checks rather than a
 * comment: an approval can never hand its caller a `refund_required` to handle,
 * and a payment can never be told `unavailable` and quietly drop the money.
 */
export type SettlementOutcome = PaymentSettlement | ApprovalSettlement;

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
  /**
   * The order's places are already in `sold` — it has been waiting for approval
   * (US-REG-02). Counting them again would refuse the last place as sold out
   * because of the order itself, and leave `sold` one order too high.
   */
  placesCounted: boolean;
}

/**
 * The same four refusals, worded for whoever is about to read them. A buyer is
 * told what happened to their money; an organizer is told what to do next.
 */
const BLOCKERS = {
  payment: {
    noTier: 'The ticket type on this order no longer exists.',
    soldOut: 'The tickets sold out while the payment was being made.',
    seatsTaken: 'The seats were taken while the payment was being made.',
    seatMismatch: 'The seat reservation no longer matches the order.',
    seatsReleased:
      'The seats were released before the payment arrived, so they could not be kept for approval.',
  },
  approval: {
    noTier: 'The ticket type on this registration no longer exists.',
    soldOut:
      'This ticket is now sold out — offer the attendee the waitlist instead.',
    seatsTaken: 'The seat on this registration has been taken by someone else.',
    seatMismatch: 'The seat reservation no longer matches the registration.',
  },
} as const satisfies Record<SettlementMode, Record<string, string>>;

/** Why a settlement cannot be honoured, or null when it can. */
function settlementBlocker(
  context: SettlementContext,
  mode: SettlementMode,
): string | null {
  const said = BLOCKERS[mode];
  if (!context.line) return said.noTier;
  const { sold, total, quantity } = context.line;
  const counted = context.placesCounted;
  if (!counted && total !== UNLIMITED && sold + quantity > total) {
    return said.soldOut;
  }
  if (context.takenSeatIds.length > 0) return said.seatsTaken;
  // A reserved-seating order must seat every admission it is about to ticket.
  if (context.seatIds.length > 0 && context.seatIds.length !== quantity) {
    return said.seatMismatch;
  }
  return null;
}

/** The two states awaiting a decision — approvable, and rejectable. */
const AWAITING_DECISION = ['pending', 'waitlisted'] as const;
const DECIDED_ELSEWHERE =
  'This registration was decided by someone else — refresh to see where it stands.';
/** A payment landed between the organizer reading the list and clicking. */
const PAID_WHILE_DECIDING =
  'This registration was paid for while you were deciding — refresh to see where it stands.';

/** An allocation of 0 means unlimited — mirrors `TicketingPolicy`. */
const UNLIMITED = 0;
const ACTIVE_HOLD = 'active';
/** A ticket that still admits someone — the set a refund takes back. */
const LIVE_TICKET_STATUSES = ['issued', 'checked_in'] as const;

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
      const order = await this.insertOrder(
        tx,
        input,
        attendeeId,
        initialState(input),
      );
      const item = await this.insertOrderItem(tx, input, order.id);
      const issued = input.issueTickets
        ? await this.issueTickets(tx, input, order, item.id, attendeeId)
        : [];
      await this.settleHolds(tx, input, order.id);
      await this.recordRedemption(tx, input, order.id);
      const event = input.buildEvent(order, issued);
      if (event) await this.outbox.enqueueIn(tx, event);
      // Sorted the same way the replay reads them, so confirming twice returns
      // an identical response rather than the same tickets in another order.
      return { order, tickets: byId(issued), replayed: false };
    });
  }

  /**
   * Put a buyer in line for a sold-out ticket (US-REG-04): the entry and its
   * line item are written together or not at all.
   *
   * Two things make it safe to repeat. A repeated idempotency key returns what
   * that key already made. And somebody already waiting for this ticket gets
   * their existing place back rather than a second one behind it — two entries
   * would mean two offers to one person for seats somebody else was owed.
   */
  async joinWaitlist(input: JoinWaitlistInput): Promise<JoinedWaitlist> {
    return withTenant(this.db, input.organizationId, async (tx) => {
      const existing =
        (
          await this.findByIdempotencyKey(
            tx,
            input.organizationId,
            input.idempotencyKey,
          )
        )?.order ?? (await this.alreadyWaiting(tx, input));
      const order = existing ?? (await this.insertWaitlistEntry(tx, input));
      const ahead = await this.waitlistAhead(
        tx,
        input.organizationId,
        order.id,
      );
      return { order, position: ahead + 1 };
    });
  }

  /** A registration and the ticket it waits for, or null if not this workspace's. */
  async waitlistEntry(
    organizationId: number,
    orderId: string,
  ): Promise<WaitlistEntry | null> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .select({
          order: orders,
          ticketTypeId: orderItems.ticketTypeId,
          ticketTypeName: ticketTypes.name,
          quantity: orderItems.quantity,
        })
        .from(orders)
        .innerJoin(orderItems, eq(orderItems.orderId, orders.id))
        .innerJoin(ticketTypes, eq(ticketTypes.id, orderItems.ticketTypeId))
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
   * Turn a waitlist entry into an offer (US-REG-04), under the order's row
   * lock: `pending` — so paying is the ordinary checkout payment — with who
   * offered it, until when, and how many were ahead in line, and the offer
   * email queued in the same transaction.
   *
   * The seats are held BEFORE this runs, by the seat-hold engine; this only
   * records the offer. Somebody else deciding first is a conflict, and the
   * caller gives the hold back.
   */
  async markOffered(input: MarkOfferedInput): Promise<OrderRow> {
    return withTenant(this.db, input.organizationId, async (tx) => {
      const order = await this.lockOrder(tx, input);
      if (order.status !== WAITLISTED.status) {
        throw DomainException.conflict(DECIDED_ELSEWHERE);
      }
      const skipped = await this.waitlistAhead(
        tx,
        input.organizationId,
        order.id,
      );
      const [offered] = await tx
        .update(orders)
        .set({
          status: 'pending',
          offeredAt: input.now,
          offeredBy: input.offeredBy,
          offerExpiresAt: input.offerExpiresAt,
          offerSkipped: skipped,
          updatedAt: input.now,
          version: order.version + 1,
        })
        .where(eq(orders.id, order.id))
        .returning();
      await this.outbox.enqueueIn(tx, input.buildEvent(offered));
      return offered;
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

  /**
   * An order, its tickets and its event name, reached by the order's uuid alone
   * (US-DISC-06/07).
   *
   * No tenant scope, exactly like `findOrderAnyTenant` above and for the same
   * reason: the buyer is a guest with no workspace, and the unguessable uuid IS
   * the capability — it is what the confirmation email hands them. Nothing here
   * is looked up by reference or email, which are both things a stranger could
   * guess or already know.
   */
  async findGuestOrder(orderId: string): Promise<{
    order: OrderRow;
    tickets: TicketRow[];
    eventName: string;
    lines: {
      ticketTypeName: string;
      quantity: number;
      unitPriceSatang: number;
      lineSubtotalSatang: number;
    }[];
  } | null> {
    const [row] = await this.db
      .select({ order: orders, eventName: events.name })
      .from(orders)
      .innerJoin(events, eq(events.id, orders.eventId))
      .where(eq(orders.id, orderId))
      .limit(1);
    if (!row) return null;
    const issued = await this.db
      .select()
      .from(tickets)
      .where(eq(tickets.orderId, orderId))
      .orderBy(asc(tickets.id));
    const lines = await this.db
      .select({
        ticketTypeName: ticketTypes.name,
        quantity: orderItems.quantity,
        unitPriceSatang: orderItems.unitPriceSatang,
        lineSubtotalSatang: orderItems.lineSubtotalSatang,
      })
      .from(orderItems)
      .innerJoin(ticketTypes, eq(ticketTypes.id, orderItems.ticketTypeId))
      .where(eq(orderItems.orderId, orderId))
      .orderBy(asc(orderItems.id));
    return {
      order: row.order,
      tickets: issued,
      eventName: row.eventName,
      lines,
    };
  }

  /**
   * When this order's seats stop being reserved — the buyer's actual deadline.
   *
   * The latest of its live holds, because they all have to survive for the
   * order to be honoured. `null` once none are active: either the order settled
   * and they converted, or the clock already ran out. The caller decides which
   * of those it is from the order's own status.
   *
   * No tenant, like `findGuestOrder` — an anonymous buyer has no workspace, and
   * the order's uuid is what establishes one.
   */
  async holdExpiryForOrder(orderId: string): Promise<Date | null> {
    const [row] = await this.db
      .select({ expiresAt: max(seatHolds.expiresAt) })
      .from(seatHolds)
      .where(
        and(eq(seatHolds.orderId, orderId), eq(seatHolds.status, ACTIVE_HOLD)),
      );
    return row?.expiresAt ?? null;
  }

  /**
   * The name of the event an order is for, reached by the order's uuid alone.
   *
   * Same no-tenant read as `findOrderAnyTenant`, and for the same reason: an
   * anonymous buyer paying for their order has no workspace.
   */
  async eventNameForOrder(orderId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ name: events.name })
      .from(orders)
      .innerJoin(events, eq(events.id, orders.eventId))
      .where(eq(orders.id, orderId))
      .limit(1);
    return row?.name ?? null;
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
   * The order an invoice may be raised against (US-FIN-07), with the event name
   * the invoice line item prints. Cancelled orders are excluded — there is
   * nothing left to bill once the registration is undone.
   */
  async findBillableOrder(
    organizationId: number,
    orderId: string,
  ): Promise<BillableOrder | null> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .select({
          id: orders.id,
          organizationId: orders.organizationId,
          reference: orders.reference,
          eventId: orders.eventId,
          eventName: events.name,
          buyerName: orders.buyerName,
          buyerEmail: orders.buyerEmail,
          totalSatang: orders.totalSatang,
          vatAmountSatang: orders.vatAmountSatang,
          currency: orders.currency,
        })
        .from(orders)
        .innerJoin(events, eq(events.id, orders.eventId))
        .where(
          and(
            eq(orders.id, orderId),
            eq(orders.organizationId, organizationId),
            ne(orders.status, 'cancelled'),
          ),
        )
        .limit(1);
      if (!row) return null;
      return {
        ...row,
        organizationId: Number(row.organizationId),
        totalSatang: Number(row.totalSatang),
        vatAmountSatang: Number(row.vatAmountSatang),
      };
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
  async settleOrder(
    input: SettleOrderInput & { mode: 'approval' },
  ): Promise<ApprovalSettlement>;
  async settleOrder(
    input: SettleOrderInput & { mode?: 'payment' },
  ): Promise<PaymentSettlement>;
  async settleOrder(input: SettleOrderInput): Promise<SettlementOutcome> {
    const mode = input.mode ?? 'payment';
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
      // Already paid for and waiting for the organizer: a second payment, which
      // the caller refunds as a duplicate exactly as for a confirmed order.
      if (mode === 'payment' && isAwaitingApproval(order)) {
        await input.recordPayment(tx);
        return {
          outcome: 'already_settled',
          reference: order.reference,
          ticketCount: 0,
        };
      }
      if (!this.isOpenFor(mode, order.status)) {
        // An organizer approving something already decided is a lost race, not
        // stray money: nothing to cancel and nothing to send back.
        if (mode === 'approval') {
          throw DomainException.conflict(DECIDED_ELSEWHERE);
        }
        return this.refuseSettlement(
          tx,
          input,
          order,
          'The order was no longer open when the payment arrived.',
        );
      }
      const context = await this.loadSettlement(tx, input, order);
      const blocked = settlementBlocker(context, mode);
      if (blocked) {
        // Nothing has been written yet on either path, so an approval simply
        // reports back and leaves the registration exactly as it found it.
        if (mode === 'approval') {
          return {
            outcome: 'unavailable',
            reference: order.reference,
            ticketCount: 0,
            reason: blocked,
          };
        }
        return this.refuseSettlement(tx, input, order, blocked);
      }
      if (mode === 'payment' && order.requiresApproval) {
        return this.awaitDecision(tx, input, order, context);
      }
      return this.completeSettlement(tx, input, order, context);
    });
  }

  /**
   * The money arrived on an order that requires approval (US-REG-02): it pays
   * for places that now wait for the organizer, not for tickets. Its places are
   * counted in `sold` here — the tier is locked by `loadSettlement` — so nobody
   * else can take them while the organizer decides, and approval will not count
   * them again. A GA hold then reserves nothing more and converts; a reserved
   * seat's hold stays with the order until the decision.
   *
   * No confirmation and no receipt are queued: both go with the tickets, on
   * approval. A seat whose hold was released while the buyer paid cannot be
   * kept for anyone — it may already be someone else's — so the money goes
   * back rather than waiting on a seat the order no longer has.
   */
  private async awaitDecision(
    tx: Tx,
    input: SettleOrderInput,
    order: OrderRow,
    context: SettlementContext,
  ): Promise<PaymentSettlement> {
    if (await this.seatHoldLost(tx, input.organizationId, order.id)) {
      return this.refuseSettlement(
        tx,
        input,
        order,
        BLOCKERS.payment.seatsReleased,
      );
    }
    const line = context.line as NonNullable<SettlementContext['line']>;
    await this.countSale(tx, line, input.now);
    await this.holdForDecision(tx, input.organizationId, order.id);
    await tx
      .update(orders)
      .set({
        paymentStatus: 'paid',
        approvalRequestedAt: input.now,
        updatedAt: input.now,
        version: order.version + 1,
      })
      .where(eq(orders.id, order.id));
    await input.recordPayment(tx);
    return {
      outcome: 'awaiting_approval',
      reference: order.reference,
      ticketCount: 0,
    };
  }

  /** Raise the (already locked) tier's `sold` by the order line. */
  private async countSale(
    tx: Tx,
    line: NonNullable<SettlementContext['line']>,
    now: Date,
  ): Promise<void> {
    await tx
      .update(ticketTypes)
      .set({ sold: line.sold + line.quantity, updatedAt: now })
      .where(eq(ticketTypes.id, line.ticketTypeId));
  }

  /**
   * An order's holds once its places are counted and it waits for a decision:
   * GA holds convert — `sold` carries them now — and reserved seats stay held,
   * until a date no clock reaches, because a seat can only be assigned to a
   * ticket and there is none yet.
   */
  private async holdForDecision(
    tx: Tx,
    organizationId: number,
    orderId: string,
  ): Promise<void> {
    await tx
      .update(seatHolds)
      .set({ status: 'converted', orderId: null })
      .where(
        and(
          eq(seatHolds.organizationId, organizationId),
          eq(seatHolds.orderId, orderId),
          isNull(seatHolds.seatId),
        ),
      );
    await tx
      .update(seatHolds)
      .set({ expiresAt: DECISION_HOLD_EXPIRY })
      .where(
        and(
          eq(seatHolds.organizationId, organizationId),
          eq(seatHolds.orderId, orderId),
          isNotNull(seatHolds.seatId),
          eq(seatHolds.status, ACTIVE_HOLD),
        ),
      );
  }

  /**
   * One of the order's seats is no longer held for it. Read after
   * `loadSettlement` has locked the seats, so no other buyer can be taking one
   * while this looks.
   */
  private async seatHoldLost(
    tx: Tx,
    organizationId: number,
    orderId: string,
  ): Promise<boolean> {
    const [lost] = await tx
      .select({ id: seatHolds.id })
      .from(seatHolds)
      .where(
        and(
          eq(seatHolds.organizationId, organizationId),
          eq(seatHolds.orderId, orderId),
          isNotNull(seatHolds.seatId),
          ne(seatHolds.status, ACTIVE_HOLD),
        ),
      )
      .limit(1);
    return lost !== undefined;
  }

  /**
   * A payment may only land on a `pending` order. An organizer may also decide
   * a `waitlisted` one — approving off the waitlist into a seat that freed up
   * is the whole point of the queue (US-REG-02).
   */
  private isOpenFor(mode: SettlementMode, status: string): boolean {
    if (mode === 'approval') {
      return (AWAITING_DECISION as readonly string[]).includes(status);
    }
    return status === 'pending';
  }

  /**
   * The organizer refused a sign-up (US-REG-02): its places go back so they
   * can go to someone else, and a notice is queued. Terminal, and it moves no
   * money itself — every rule is re-checked HERE, under the row lock, because
   * a payment can land between the organizer opening the list and clicking
   * Reject.
   *
   * Money captured on an ordinary sale still refuses: that is cancel-and-
   * refund. Money taken while the registration waited for approval does not:
   * the rejection commits first — so an approval racing it cannot win after
   * the money went back — and `refundDue` tells the caller to refund it. The
   * payment status is left `paid` until that refund lands.
   *
   * Idempotent: rejecting twice gives back and notifies once, and a repeat
   * still reports `refundDue` while the money is owed, so a retry can finish
   * an interrupted refund.
   */
  async rejectOrder(input: RejectOrderInput): Promise<RejectedOrder> {
    return withTenant(this.db, input.organizationId, async (tx) => {
      const order = await this.lockOrder(tx, input);
      const refundDue = rejectionRefunds(order);
      if (order.status === 'rejected') {
        return { reference: order.reference, refundDue };
      }
      if (!isRejectable(order)) {
        throw DomainException.conflict(DECIDED_ELSEWHERE);
      }
      if (refundDue && !input.mayRefund) {
        throw DomainException.conflict(PAID_WHILE_DECIDING);
      }
      // Its places are in `sold` — give them back, so `sold` ends where it
      // started. A registration that never waited counted nothing there.
      if (isAwaitingApproval(order)) {
        await this.givePlacesBack(
          tx,
          input.organizationId,
          order.id,
          input.now,
        );
      }
      await tx
        .update(orders)
        .set({
          status: 'rejected',
          rejectedAt: input.now,
          decidedBy: input.decidedBy,
          rejectionReason: input.reason,
          updatedAt: input.now,
          version: order.version + 1,
        })
        .where(eq(orders.id, order.id));
      await this.releaseActiveHolds(tx, input.organizationId, order.id);
      await this.outbox.enqueueIn(tx, input.buildRejectedEvent(order));
      return { reference: order.reference, refundDue };
    });
  }

  /** Hand a waiting registration's counted places back to its tiers. */
  private async givePlacesBack(
    tx: Tx,
    organizationId: number,
    orderId: string,
    now: Date,
  ): Promise<void> {
    const lines = await tx
      .select({
        ticketTypeId: orderItems.ticketTypeId,
        quantity: orderItems.quantity,
      })
      .from(orderItems)
      .where(
        and(
          eq(orderItems.organizationId, organizationId),
          eq(orderItems.orderId, orderId),
        ),
      );
    const byType = new Map<string, number>();
    for (const { ticketTypeId, quantity } of lines) {
      byType.set(ticketTypeId, (byType.get(ticketTypeId) ?? 0) + quantity);
    }
    await this.giveBackStock(tx, organizationId, byType, now);
  }

  /** The seats an order still holds go back on sale. */
  private async releaseActiveHolds(
    tx: Tx,
    organizationId: number,
    orderId: string,
  ): Promise<void> {
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

  /**
   * Give the inventory back after a refund (US-FIN-02): void the order's live
   * tickets, release their seat assignments, and hand the tier's stock back.
   * `recordRefund` runs inside the same transaction as all of it.
   *
   * Stock goes back by the tickets THIS call voided, so a repeated refund —
   * which finds nothing left to void — gives nothing back twice.
   *
   * A registration refunded while it still waits for approval (US-REG-02) has
   * no tickets: its places are counted in `sold` and a reserved seat is held,
   * so those go back instead. A rejected one gave them back when it was
   * rejected, and stays `rejected` — the refund is the consequence of that
   * decision, not a cancellation. The order is locked first, so this and a
   * rejection or an approval of the same registration take turns.
   */
  async refundOrder(
    organizationId: number,
    orderId: string,
    recordRefund: (tx: Tx) => Promise<void>,
    now: Date,
  ): Promise<{ ticketsVoided: number; seatsReleased: number }> {
    return withTenant(this.db, organizationId, async (tx) => {
      const order = await this.lockOrder(tx, { organizationId, orderId });
      if (isAwaitingApproval(order)) {
        await this.givePlacesBack(tx, organizationId, orderId, now);
        await this.releaseActiveHolds(tx, organizationId, orderId);
      }
      const voided = await tx
        .update(tickets)
        .set({ status: 'refunded', updatedAt: now })
        .where(
          and(
            eq(tickets.orderId, orderId),
            eq(tickets.organizationId, organizationId),
            inArray(tickets.status, LIVE_TICKET_STATUSES),
          ),
        )
        .returning({ id: tickets.id, ticketTypeId: tickets.ticketTypeId });
      await this.returnStock(tx, organizationId, voided, now);
      const released = await tx
        .update(seatAssignments)
        .set({ releasedAt: now })
        .where(
          and(
            eq(seatAssignments.organizationId, organizationId),
            inArray(
              seatAssignments.ticketId,
              voided.map((t) => t.id),
            ),
            isNull(seatAssignments.releasedAt),
          ),
        )
        .returning({ id: seatAssignments.id });
      await tx
        .update(orders)
        .set({
          status: statusAfterRefund(order.status),
          paymentStatus: 'refunded',
          updatedAt: now,
        })
        .where(eq(orders.id, orderId));
      await recordRefund(tx);
      return { ticketsVoided: voided.length, seatsReleased: released.length };
    });
  }

  /**
   * Lower each ticket type's `sold` by the tickets voided from it.
   *
   * `sold` is what every "is anything left?" check reads — checkout's live
   * status, the seat-hold engine, a waitlist offer — and it counts every
   * issued ticket, reserved seats included: both places that mint tickets
   * raise it, whatever the seating. So it comes down for every voided ticket.
   * Releasing a reserved seat alone left a free seat on a ticket type still
   * reading "sold out", which refused it.
   *
   * One UPDATE per type takes that row's lock, as the increments do, and in
   * id order so two refunds touching the same types cannot deadlock.
   * `GREATEST(…, 0)`: a count already lower than the tickets it should cover is
   * wrong, and a refund must not compound it into a negative that sells places
   * which do not exist.
   */
  private async returnStock(
    tx: Tx,
    organizationId: number,
    voided: { ticketTypeId: string | null }[],
    now: Date,
  ): Promise<void> {
    const byType = new Map<string, number>();
    for (const { ticketTypeId } of voided) {
      // A ticket type since deleted has no stock left to give back to.
      if (ticketTypeId) {
        byType.set(ticketTypeId, (byType.get(ticketTypeId) ?? 0) + 1);
      }
    }
    await this.giveBackStock(tx, organizationId, byType, now);
  }

  /** Lower each ticket type's `sold` by its count — see `returnStock`. */
  private async giveBackStock(
    tx: Tx,
    organizationId: number,
    byType: Map<string, number>,
    now: Date,
  ): Promise<void> {
    for (const [ticketTypeId, count] of [...byType].sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      await tx
        .update(ticketTypes)
        .set({
          sold: sql`GREATEST(${ticketTypes.sold} - ${count}, 0)`,
          updatedAt: now,
        })
        .where(
          and(
            eq(ticketTypes.id, ticketTypeId),
            eq(ticketTypes.organizationId, organizationId),
          ),
        );
    }
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

  private async lockOrder(
    tx: Tx,
    input: { organizationId: number; orderId: string },
  ): Promise<OrderRow> {
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
      placesCounted: isAwaitingApproval(order),
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
  ): Promise<PaymentSettlement> {
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
    if (!context.placesCounted) await this.countSale(tx, line, input.now);
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
        // The moment it actually became confirmed — what the queue renders as
        // the confirmation date, and previously never written at all.
        confirmedAt: input.now,
        ...(input.mode === 'approval'
          ? { approvedAt: input.now, decidedBy: input.decidedBy }
          : {}),
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

  /** This buyer's entry for this ticket, if they are already in line. */
  private async alreadyWaiting(
    tx: Tx,
    input: JoinWaitlistInput,
  ): Promise<OrderRow | null> {
    const [row] = await tx
      .select({ order: orders })
      .from(orders)
      .innerJoin(orderItems, eq(orderItems.orderId, orders.id))
      .where(
        and(
          eq(orders.organizationId, input.organizationId),
          eq(orders.eventId, input.eventId),
          eq(orders.buyerEmail, input.buyer.email),
          eq(orders.status, WAITLISTED.status),
          eq(orderItems.ticketTypeId, input.ticketTypeId),
        ),
      )
      .limit(1);
    return row?.order ?? null;
  }

  private async insertWaitlistEntry(
    tx: Tx,
    input: JoinWaitlistInput,
  ): Promise<OrderRow> {
    const attendeeId = await this.upsertAttendee(tx, input);
    const order = await this.insertOrder(tx, input, attendeeId, WAITLISTED);
    await this.insertOrderItem(tx, input, order.id);
    return order;
  }

  /**
   * How many are ahead of this registration in line for the same ticket:
   * first come, first served by when they joined, with the id breaking a tie
   * so the order is total and two people can never both be "next".
   *
   * The subqueries are literal SQL with their own aliases — Drizzle drops the
   * table qualifier from an interpolated column inside a subquery, and an
   * unqualified `id` there would silently compare the outer row to itself.
   */
  private async waitlistAhead(
    tx: Tx,
    organizationId: number,
    orderId: string,
  ): Promise<number> {
    const [row] = await tx
      .select({ ahead: sql<number>`count(*)::int` })
      .from(orders)
      .innerJoin(orderItems, eq(orderItems.orderId, orders.id))
      .where(
        and(
          eq(orders.organizationId, organizationId),
          eq(orders.status, WAITLISTED.status),
          ne(orders.id, orderId),
          sql`${orderItems.ticketTypeId} = (SELECT mi.ticket_type_id FROM order_items mi WHERE mi.order_id = ${orderId} LIMIT 1)`,
          sql`(${orders.registeredAt}, ${orders.id}) < (SELECT me.registered_at, me.id FROM orders me WHERE me.id = ${orderId})`,
        ),
      );
    return row.ahead;
  }

  /** One CRM row per person per workspace; a repeat buyer updates, never duplicates. */
  private async upsertAttendee(
    tx: Tx,
    input: Pick<PlaceOrderInput, 'organizationId' | 'buyer' | 'now'>,
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
    input: OrderInsert,
    attendeeId: number,
    state: OrderState,
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
        status: state.status,
        paymentStatus: state.paymentStatus,
        requiresApproval: input.requiresApproval ?? false,
        approvalRequestedAt: state.approvalRequestedAt ?? null,
        seats: input.quantity,
        subtotalSatang: input.totals.subtotalSatang,
        discountCodeId: input.discountCodeId ?? null,
        discountAmountSatang: input.totals.discountSatang,
        vatAmountSatang: input.totals.vatSatang,
        totalSatang: input.totals.totalSatang,
        createdBy: input.createdBy ?? null,
      })
      .returning();
    return row;
  }

  private async insertOrderItem(
    tx: Tx,
    input: Pick<
      PlaceOrderInput,
      | 'organizationId'
      | 'ticketTypeId'
      | 'quantity'
      | 'unitPriceSatang'
      | 'totals'
    >,
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

  /** What becomes of the buyer's holds once their order exists. */
  private async settleHolds(
    tx: Tx,
    input: PlaceOrderInput,
    orderId: string,
  ): Promise<void> {
    if (input.issueTickets) return this.convertHolds(tx, input);
    if (input.awaitsDecision) {
      return this.reserveForDecision(tx, input, orderId);
    }
    // A paid order keeps its holds live but stamps them with the order, so
    // settlement can find its seats and an expiry can release exactly these.
    return this.attachHolds(tx, input, orderId);
  }

  /**
   * A free registration now waiting for the organizer (US-REG-02). Its places
   * are counted at once — under the tier lock, with the same sold-out refusal
   * a ticketed order gets — so the public count is true and nobody else can
   * take them. A GA hold then reserves nothing more and converts; a reserved
   * seat's hold stays with the order until the decision, because a seat is
   * assigned to a ticket and there is no ticket yet.
   */
  private async reserveForDecision(
    tx: Tx,
    input: PlaceOrderInput,
    orderId: string,
  ): Promise<void> {
    await this.reserveAllocation(tx, input);
    if (input.seatIds && input.seatIds.length > 0) {
      return this.attachHolds(tx, input, orderId, DECISION_HOLD_EXPIRY);
    }
    return this.convertHolds(tx, input);
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

  /** `expiresAt` replaces the checkout timer — only a decision hold passes one. */
  private async attachHolds(
    tx: Tx,
    input: PlaceOrderInput,
    orderId: string,
    expiresAt?: Date,
  ): Promise<void> {
    if (input.holdIds.length === 0) return;
    await tx
      .update(seatHolds)
      .set({ orderId, ...(expiresAt ? { expiresAt } : {}) })
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
 * Still awaiting a decision, and not money captured on an ordinary sale —
 * that is cancel-and-refund. Money taken while it waited for approval is the
 * rejection's to give back.
 */
function isRejectable(order: OrderRow): boolean {
  const awaiting = (AWAITING_DECISION as readonly string[]).includes(
    order.status,
  );
  return (
    awaiting &&
    (order.paymentStatus !== 'paid' || order.approvalRequestedAt !== null)
  );
}

/**
 * Where a placed order starts: ticketed if nothing is owed and nobody decides,
 * otherwise pending — and, when only the organizer's decision is left,
 * already waiting for it.
 */
function initialState(input: PlaceOrderInput): OrderState {
  if (input.issueTickets) return { status: 'confirmed', paymentStatus: 'paid' };
  return {
    status: 'pending',
    paymentStatus: 'pending',
    approvalRequestedAt: input.awaitsDecision ? input.now : null,
  };
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
