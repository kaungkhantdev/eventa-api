import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DomainException } from '../../common/errors/domain.exception';
import { Clock } from '../../common/time/clock';
import type { Env } from '../../config/env.validation';
import { SeatHoldService } from '../registration/seat-hold.service';
import {
  type ApprovalResult,
  type DecidableOrder,
  type OfferResult,
  RegistrationApprovalPort,
  type RejectionInput,
} from '../registrations/ports/registration-approval.port';
import {
  type ApprovalSettlement,
  CheckoutRepository,
  type OrderRow,
} from './checkout.repository';
import { registrationConfirmedEvent } from './events/registration-confirmed.event';
import { registrationRejectedEvent } from './events/registration-rejected.event';
import { refundRequiredEvent } from './events/refund-required.event';
import { waitlistOfferedEvent } from './events/waitlist-offered.event';
import { generateQrToken } from './order-reference';
import { CheckoutEventPort } from './ports/checkout-event.port';
import { ticketsUrlFor } from './ticket-links';

/** Approval moves no money, so the settlement's ledger hook does nothing. */
const NO_PAYMENT = () => Promise.resolve();
const MS_PER_HOUR = 60 * 60 * 1000;
const GONE = "This registration isn't available.";

/**
 * Checkout's implementation of the Registrations-owned decision port
 * (US-REG-02). The organizer's Approve runs THE settlement transaction — the
 * one a card payment runs — in `approval` mode, so a hand-approved registration
 * and a bought one are issued by the same code, seat the attendee the same way,
 * and emit the same `registration.confirmed` contract the worker already sends
 * mail from. The only differences are that no money moves and that a refusal
 * leaves the registration alone instead of cancelling it.
 */
@Injectable()
export class RegistrationApprovalAdapter extends RegistrationApprovalPort {
  private readonly publicWebUrl: string;
  private readonly offerWindowMs: number;

  constructor(
    private readonly repo: CheckoutRepository,
    private readonly events: CheckoutEventPort,
    private readonly clock: Clock,
    config: ConfigService<Env, true>,
    private readonly holds: SeatHoldService,
  ) {
    super();
    this.publicWebUrl = config.getOrThrow('PUBLIC_WEB_URL', { infer: true });
    this.offerWindowMs =
      config.getOrThrow('WAITLIST_OFFER_HOURS', { infer: true }) * MS_PER_HOUR;
  }

  /**
   * Offer a waitlisted registration its seats (US-REG-04).
   *
   * Two steps, in this order. The seats are held first, through the seat-hold
   * engine's row-locked availability check — the one authority on whether a
   * seat is free, so an offer can never oversell. Only then is the offer
   * recorded, under the order's own lock. If that second step fails —
   * somebody decided first, or the write failed — the hold is given straight
   * back: left alone it would keep a seat off sale for the whole offer window.
   */
  async offer(
    organizationId: number,
    orderId: string,
    offeredBy: string,
  ): Promise<OfferResult> {
    const entry = await this.repo.waitlistEntry(organizationId, orderId);
    if (!entry) throw DomainException.notFound(GONE);
    const { order } = entry;
    if (order.status === 'pending' && order.offerExpiresAt) {
      return {
        outcome: 'already_offered',
        reference: order.reference,
        offerExpiresAt: order.offerExpiresAt,
      };
    }
    const now = this.clock.now();
    const offerExpiresAt = new Date(now.getTime() + this.offerWindowMs);
    const actor = { organizationId };
    const hold = await this.holds.holdForOffer(actor, {
      eventId: order.eventId,
      ticketTypeId: entry.ticketTypeId,
      quantity: entry.quantity,
      orderId,
      expiresAt: offerExpiresAt,
    });
    if (!hold) {
      return {
        outcome: 'no_seat',
        reference: order.reference,
        offerExpiresAt: null,
      };
    }
    try {
      await this.repo.markOffered({
        organizationId,
        orderId,
        offeredBy,
        offerExpiresAt,
        now,
        buildEvent: (offered) =>
          waitlistOfferedEvent({
            organizationId,
            orderId: offered.id,
            reference: offered.reference,
            eventId: offered.eventId,
            buyerEmail: offered.buyerEmail,
            buyerName: offered.buyerName,
            ticketTypeName: entry.ticketTypeName,
            ticketCount: offered.seats,
            totalSatang: offered.totalSatang,
            currency: offered.currency,
            offerExpiresAt,
            payUrl: ticketsUrlFor(this.publicWebUrl, offered.id),
            occurredAt: now,
          }),
      });
    } catch (error) {
      await this.holds.release(actor, [hold.id]);
      throw error;
    }
    return { outcome: 'offered', reference: order.reference, offerExpiresAt };
  }

  async findDecidable(
    organizationId: number,
    orderId: string,
  ): Promise<DecidableOrder | null> {
    const order = await this.repo.orderById(organizationId, orderId);
    if (!order) return null;
    return {
      id: order.id,
      reference: order.reference,
      status: order.status,
      paymentStatus: order.paymentStatus,
      totalSatang: order.totalSatang,
    };
  }

  async approve(
    organizationId: number,
    orderId: string,
    decidedBy: string,
  ): Promise<ApprovalResult> {
    const order = await this.repo.orderById(organizationId, orderId);
    if (!order) return this.gone(orderId);
    // Resolved before the transaction opens — no cross-connection reads while
    // holding row locks, exactly as the payment path does it.
    const isOnline =
      (await this.events.findPublishedById(order.eventId))?.isOnline ?? false;
    const now = this.clock.now();
    const result = await this.repo.settleOrder({
      organizationId,
      orderId,
      mode: 'approval',
      decidedBy,
      mintQrToken: generateQrToken,
      buildConfirmedEvent: (settled, ticketCount) =>
        this.confirmedEvent(settled, ticketCount, isOnline, now),
      // Unreachable in `approval` mode — a refusal there writes nothing and
      // queues nothing — but the settlement contract asks for a builder.
      buildRefundEvent: (refused, reason) =>
        refundRequiredEvent({
          organizationId,
          orderId: refused.id,
          reference: refused.reference,
          eventId: refused.eventId,
          buyerEmail: refused.buyerEmail,
          amountSatang: refused.totalSatang,
          currency: refused.currency,
          reason,
          occurredAt: now.toISOString(),
        }),
      recordPayment: NO_PAYMENT,
      now,
    });
    return {
      outcome: APPROVAL_OUTCOMES[result.outcome],
      reference: result.reference,
      ticketCount: result.ticketCount,
      reason: result.reason ?? null,
    };
  }

  async reject(
    organizationId: number,
    orderId: string,
    input: RejectionInput,
  ): Promise<{ reference: string }> {
    const now = this.clock.now();
    return this.repo.rejectOrder({
      organizationId,
      orderId,
      decidedBy: input.decidedBy,
      reason: input.reason,
      buildRejectedEvent: (order) =>
        registrationRejectedEvent({
          organizationId,
          orderId: order.id,
          reference: order.reference,
          eventId: order.eventId,
          buyerEmail: order.buyerEmail,
          buyerName: order.buyerName,
          reason: input.reason,
          occurredAt: now.toISOString(),
        }),
      now,
    });
  }

  private gone(orderId: string): ApprovalResult {
    return {
      outcome: 'unavailable',
      reference: orderId,
      ticketCount: 0,
      reason: "This registration isn't available.",
    };
  }

  private confirmedEvent(
    order: OrderRow,
    ticketCount: number,
    isOnline: boolean,
    now: Date,
  ) {
    return registrationConfirmedEvent({
      organizationId: order.organizationId,
      orderId: order.id,
      reference: order.reference,
      eventId: order.eventId,
      buyerEmail: order.buyerEmail,
      buyerName: order.buyerName,
      buyerPhone: order.buyerPhone,
      ticketCount,
      totalSatang: order.totalSatang,
      vatSatang: order.vatAmountSatang,
      currency: order.currency,
      isOnline,
      // A free registration was never paid for; saying otherwise would put a
      // "payment received" line in the attendee's confirmation.
      paid: order.totalSatang > 0,
      ticketsUrl: ticketsUrlFor(this.publicWebUrl, order.id),
      occurredAt: now.toISOString(),
    });
  }
}

/**
 * The settlement's vocabulary, in the words a decision is reported in. There is
 * deliberately no `refund_required` key: `settleOrder`'s overloads make that
 * outcome unreachable in `approval` mode, so adding one here would not compile.
 */
const APPROVAL_OUTCOMES = {
  settled: 'approved',
  already_settled: 'already_approved',
  unavailable: 'unavailable',
} as const satisfies Record<
  ApprovalSettlement['outcome'],
  ApprovalResult['outcome']
>;
