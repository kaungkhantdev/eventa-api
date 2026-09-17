import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DomainException } from '../../common/errors/domain.exception';
import type { Env } from '../../config/env.validation';
import { Clock } from '../../common/time/clock';
import { CheckoutService, type PricedSelection } from './checkout.service';
import {
  CheckoutRepository,
  type OrderRow,
  type PlaceOrderInput,
  type TicketRow,
} from './checkout.repository';
import { registrationConfirmedEvent } from './events/registration-confirmed.event';
import { generateOrderReference, generateQrToken } from './order-reference';
import { ticketsUrlFor } from './ticket-links';
import type { ConfirmOrderDto } from './dto/confirm-order.dto';
import type { GuestOrderDto } from './dto/guest-order.dto';
import type { OrderPlacedDto } from './dto/order-placed.dto';

/**
 * Present only when an ORGANIZER placed this booking themselves (US-REG-03),
 * absent on the attendee's own checkout. It carries the three things that
 * differ: whose workspace resolves the event, who to credit on the order, and
 * whether the attendee hears about it at all.
 */
export interface OrganizerEntry {
  organizationId: number;
  createdBy: string;
  notify: boolean;
}

/** How many fresh references to try before admitting defeat (32^8 collisions). */
const REFERENCE_ATTEMPTS = 3;
const UNIQUE_VIOLATION = '23505';

/**
 * Placing the registration (US-DISC-06): one order, one ticket per admission,
 * exactly once.
 *
 * The summary is re-quoted here rather than taken from the request, so what is
 * charged is what the tier and the code are worth at this instant — not what the
 * page showed some minutes ago. Everything then happens inside
 * `CheckoutRepository.placeOrder`'s single transaction, which is also where the
 * confirmation event is written, so an attendee can never end up with a ticket
 * and no email or an email and no ticket.
 *
 * A free order confirms immediately and its tickets are issued. A paid one is
 * placed as `pending` with its seats still held, and the tickets are minted when
 * the payment settles (US-DISC-05) — so nobody holds a QR for something they
 * have not paid for.
 */
/** Said for a bad id and for somebody else's alike — the two must not be
 *  distinguishable, or the endpoint becomes a way to probe for orders. */
const ORDER_NOT_FOUND = 'That order could not be found.';

@Injectable()
export class CheckoutOrderService {
  private readonly publicWebUrl: string;

  constructor(
    private readonly checkout: CheckoutService,
    private readonly repo: CheckoutRepository,
    private readonly clock: Clock,
    config: ConfigService<Env, true>,
  ) {
    this.publicWebUrl = config.getOrThrow('PUBLIC_WEB_URL', { infer: true });
  }

  async confirm(
    input: ConfirmOrderDto,
    entry?: OrganizerEntry,
  ): Promise<OrderPlacedDto> {
    // Re-priced here, never taken from the request: what is charged is what the
    // tier and the code are worth now, not what the page showed ten minutes ago.
    // US-REG-03 leans on the same rule — the organizer never types an amount.
    const priced = await this.checkout.priceSelection({
      ...input,
      buyerEmail: input.buyer.email,
      actorOrganizationId: entry?.organizationId,
    });
    const placed = await this.place(input, priced, entry);
    return this.toResponse(placed.order, placed.tickets, priced);
  }

  private async place(
    input: ConfirmOrderDto,
    priced: PricedSelection,
    entry?: OrganizerEntry,
  ): Promise<{ order: OrderRow; tickets: TicketRow[] }> {
    const { summary, event } = priced;
    const now = this.clock.now();
    // Nothing owed → the registration is complete the moment it is placed.
    const issueTickets = !summary.paymentRequired;
    // US-REG-03's "Send confirmation" toggle. Off means the ticket is created
    // quietly for the organizer to hand over — so no outbox row is written at
    // all, rather than one the worker is asked to ignore.
    const notify = entry?.notify ?? true;
    const base: Omit<PlaceOrderInput, 'reference'> = {
      organizationId: event.organizationId,
      eventId: event.id,
      idempotencyKey: input.idempotencyKey,
      buyer: input.buyer,
      ticketTypeId: summary.ticketTypeId,
      ticketTypeName: summary.ticketTypeName,
      quantity: summary.quantity,
      seatIds: summary.seatIds,
      holdIds: input.holdIds,
      unitPriceSatang: summary.unitPriceSatang,
      totals: summary,
      discountCodeId: priced.discountCodeId,
      createdBy: entry?.createdBy,
      issueTickets,
      qrTokens: issueTickets
        ? Array.from({ length: summary.quantity }, () => generateQrToken())
        : [],
      buildEvent: (order, issued) =>
        issueTickets && notify
          ? registrationConfirmedEvent({
              organizationId: event.organizationId,
              orderId: order.id,
              reference: order.reference,
              eventId: event.id,
              buyerEmail: order.buyerEmail,
              buyerName: order.buyerName,
              buyerPhone: order.buyerPhone,
              ticketCount: issued.length,
              totalSatang: order.totalSatang,
              vatSatang: order.vatAmountSatang,
              currency: order.currency,
              isOnline: event.isOnline,
              paid: order.totalSatang > 0,
              ticketsUrl: ticketsUrlFor(this.publicWebUrl, order.id),
              occurredAt: now.toISOString(),
            })
          : null,
      now,
    };
    return this.withFreshReference(base);
  }

  /**
   * References are random, so a collision is astronomically unlikely but not
   * impossible; `uq_orders_org_reference` catches it and we simply try another.
   * Note this retries ONLY on the reference — the idempotency key is untouched,
   * so a retry still resolves to the one order this buyer meant to place.
   */
  private async withFreshReference(
    base: Omit<PlaceOrderInput, 'reference'>,
  ): Promise<{ order: OrderRow; tickets: TicketRow[] }> {
    for (let attempt = 1; attempt <= REFERENCE_ATTEMPTS; attempt += 1) {
      try {
        return await this.repo.placeOrder({
          ...base,
          reference: generateOrderReference(),
        });
      } catch (error) {
        if (!isReferenceCollision(error) || attempt === REFERENCE_ATTEMPTS) {
          throw error;
        }
      }
    }
    throw DomainException.conflict(
      "We couldn't complete your booking. Please try again.",
    );
  }

  /**
   * The buyer's own copy of their order (US-DISC-06/07).
   *
   * Registration never requires an account, so whoever just paid must be able
   * to see what they bought without signing in to one they do not have. The
   * order's uuid is the capability — the same link the confirmation email
   * carries — so this returns the tickets, QR tokens included, to whoever holds
   * it. A missing order is a plain 404: "no such order" and "not yours" must
   * not be distinguishable, or the endpoint becomes a way to probe for orders.
   */
  async viewGuestOrder(orderId: string): Promise<GuestOrderDto> {
    const found = await this.repo.findGuestOrder(orderId);
    if (!found) throw DomainException.notFound(ORDER_NOT_FOUND);
    const { order, tickets, eventName, lines } = found;
    // The buyer's actual deadline. Without it the page can only say "awaiting
    // payment", which stays true and stops being useful the moment it lapses.
    const holdExpiresAt = await this.repo.holdExpiryForOrder(order.id);
    return {
      orderId: order.id,
      reference: order.reference,
      status: order.status,
      paymentStatus: order.paymentStatus,
      eventName,
      buyerEmail: order.buyerEmail,
      buyerName: order.buyerName,
      totalSatang: order.totalSatang,
      vatSatang: order.vatAmountSatang,
      subtotalSatang: order.subtotalSatang,
      discountSatang: order.discountAmountSatang,
      currency: order.currency,
      lines,
      tickets: tickets.map((ticket) => ({
        id: ticket.id,
        qrToken: ticket.qrToken,
        holderName: ticket.holderName,
        ticketLabel: ticket.ticketLabel,
        status: ticket.status,
      })),
      // Owed until the money has actually arrived — a pending order is exactly
      // when somebody comes looking for this page.
      paymentRequired: order.paymentStatus !== 'paid',
      placedAt: order.createdAt.toISOString(),
      holdExpiresAt: holdExpiresAt?.toISOString() ?? null,
    };
  }

  private toResponse(
    order: OrderRow,
    issued: TicketRow[],
    priced: PricedSelection,
  ): OrderPlacedDto {
    const { summary, event } = priced;
    return {
      orderId: order.id,
      reference: order.reference,
      status: order.status,
      paymentStatus: order.paymentStatus,
      eventName: event.name,
      buyerEmail: order.buyerEmail,
      totalSatang: order.totalSatang,
      vatSatang: order.vatAmountSatang,
      summary,
      tickets: issued.map((ticket) => ({
        id: ticket.id,
        qrToken: ticket.qrToken,
        holderName: ticket.holderName,
        ticketLabel: ticket.ticketLabel,
        status: ticket.status,
      })),
      // Only a fully-placed, paid-up order has anything to show yet.
      paymentRequired: summary.paymentRequired,
    };
  }
}

/** A duplicate `reference` — the one collision worth retrying blind. */
function isReferenceCollision(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  const constraint = (error as { constraint_name?: string } | null)
    ?.constraint_name;
  return code === UNIQUE_VIOLATION && constraint === 'uq_orders_org_reference';
}
