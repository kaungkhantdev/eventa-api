import { Injectable } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain.exception';
import type { AuthContext } from '../auth/auth.types';
import type {
  DecisionOutcomeDto,
  OfferOutcomeDto,
} from './dto/registration-decision.dto';
import {
  type DecidableOrder,
  RegistrationApprovalPort,
} from './ports/registration-approval.port';
import {
  type Verdict,
  canApprove,
  canOffer,
  canReject,
} from './registration-decision';

export interface RejectRegistrationCommand {
  confirm: boolean;
  reason: string | null;
}

const NEEDS_CONFIRMATION =
  'Rejecting a registration is permanent. Send `confirm=true` to go ahead.';
const GONE = "This registration isn't available.";
/** The blocker had no message of its own — a race we could not name. */
const UNAVAILABLE = 'This registration can no longer be approved.';
/** US-REG-04: "promotion is refused and I'm told to free capacity first". */
export const NO_SEAT_FREE =
  'No seat is free on this ticket — raise its capacity, or wait for one to free up.';

/**
 * The organizer's decision on a sign-up (US-REG-02).
 *
 * Two checks guard every decision, deliberately. This service applies the
 * business rules (`registration-decision.ts`) against a fresh read, so the
 * organizer gets a sentence explaining *why* rather than a bare 409; the
 * settlement transaction behind `RegistrationApprovalPort` then re-checks the
 * same facts under the order's row lock, because between this read and that
 * lock a payment can land, a seat can go, or another organizer can decide
 * first. The first check is for the human, the second is the one that is true.
 *
 * Approving does not mint tickets here — it runs THE settlement transaction
 * through the port, the same one a card payment runs. There is exactly one
 * code path in this system that can issue a QR.
 */
@Injectable()
export class RegistrationDecisionsService {
  constructor(private readonly approvals: RegistrationApprovalPort) {}

  async approve(
    auth: AuthContext,
    orderId: string,
  ): Promise<DecisionOutcomeDto> {
    const order = await this.mustFind(auth, orderId);
    this.assertDecidable(order, 'confirmed', canApprove);
    const result = await this.approvals.approve(
      auth.organizationId,
      orderId,
      auth.userId,
    );
    // Sold out, or the seat went, between the read above and the row lock: the
    // registration is untouched and still awaiting a decision (US-REG-02).
    if (result.outcome === 'unavailable') {
      throw DomainException.conflict(result.reason ?? UNAVAILABLE);
    }
    return {
      outcome: result.outcome,
      reference: result.reference,
      ticketCount: result.ticketCount,
    };
  }

  async reject(
    auth: AuthContext,
    orderId: string,
    command: RejectRegistrationCommand,
  ): Promise<DecisionOutcomeDto> {
    if (!command.confirm) {
      throw DomainException.validation(NEEDS_CONFIRMATION);
    }
    const order = await this.mustFind(auth, orderId);
    this.assertDecidable(order, 'rejected', canReject);
    const { reference } = await this.approvals.reject(
      auth.organizationId,
      orderId,
      { decidedBy: auth.userId, reason: command.reason },
    );
    return { outcome: 'rejected', reference, ticketCount: 0 };
  }

  /**
   * Offer someone on the waitlist a seat (US-REG-04). A paid ticket is held
   * for them to pay for by a deadline; a free one is simply confirmed, which
   * is approval — the story's "free tickets confirm immediately".
   *
   * Offering someone other than the person at the front is allowed; it is
   * recorded on the registration (how many were passed over), not refused.
   */
  async offer(auth: AuthContext, orderId: string): Promise<OfferOutcomeDto> {
    const order = await this.mustFind(auth, orderId);
    if (order.totalSatang === 0) return this.confirmFree(auth, order);
    this.assertDecidable(order, 'pending', canOffer);
    const result = await this.approvals.offer(
      auth.organizationId,
      orderId,
      auth.userId,
    );
    if (result.outcome === 'no_seat') {
      throw DomainException.conflict(NO_SEAT_FREE);
    }
    return {
      outcome: result.outcome,
      reference: result.reference,
      offerExpiresAt: result.offerExpiresAt?.toISOString() ?? null,
      ticketCount: 0,
    };
  }

  private async confirmFree(
    auth: AuthContext,
    order: DecidableOrder,
  ): Promise<OfferOutcomeDto> {
    this.assertDecidable(order, 'confirmed', canOffer);
    const result = await this.approvals.approve(
      auth.organizationId,
      order.id,
      auth.userId,
    );
    // Approval's own sold-out sentence says "offer the attendee the waitlist",
    // which is where this attendee already is.
    if (result.outcome === 'unavailable') {
      throw DomainException.conflict(NO_SEAT_FREE);
    }
    return {
      outcome: 'confirmed',
      reference: result.reference,
      offerExpiresAt: null,
      ticketCount: result.ticketCount,
    };
  }

  /**
   * Refuse a decision the rules forbid — UNLESS the registration already sits in
   * the state that decision aims at. A retried request (a double-click, a
   * network retry) asked for something that is already true, and US-REG-02
   * requires that to be a no-op rather than an error: the call below then
   * reports what it finds without issuing a second ticket or a second email.
   */
  private assertDecidable(
    order: DecidableOrder,
    settled: DecidableOrder['status'],
    rule: (order: DecidableOrder) => Verdict,
  ): void {
    if (order.status === settled) return;
    const verdict = rule(order);
    if (!verdict.allowed) throw DomainException.conflict(verdict.reason ?? '');
  }

  private async mustFind(
    auth: AuthContext,
    orderId: string,
  ): Promise<DecidableOrder> {
    const order = await this.approvals.findDecidable(
      auth.organizationId,
      orderId,
    );
    if (!order) throw DomainException.notFound(GONE);
    return order;
  }
}
