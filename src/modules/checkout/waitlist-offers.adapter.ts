import { Injectable, Logger } from '@nestjs/common';
import { Clock } from '../../common/time/clock';
import { SeatHoldService } from '../registration/seat-hold.service';
import { WaitlistOffersPort } from '../ticketing/ports/waitlist-offers.port';
import { CheckoutRepository, type WaitlistEntry } from './checkout.repository';
import { CheckoutEventPort } from './ports/checkout-event.port';
import { RegistrationApprovalAdapter } from './registration-approval.adapter';
import { autoOffersWaitlist, confirmsOnOffer } from './waitlist-rules';

/**
 * How long a free registration's place is held while its approval runs. The
 * hold only has to outlive the approval that converts it, and a short expiry
 * means a crash between the two cannot keep a place off sale for long.
 */
const CONFIRM_HOLD_MS = 5 * 60 * 1000;

/** Nobody chose them: the line did, in order. Recorded as no offerer/decider. */
const NOBODY = null;

const STOPPED_EARLY = 'Waitlist auto-offer stopped early';

/**
 * Checkout's implementation of Ticketing's `WaitlistOffersPort` (US-REG-04):
 * when an organizer raises a ticket's allocation, the new places go to the
 * people waiting for it, strictly in line order.
 *
 * Each person goes through the SAME code an organizer's offer runs
 * (`RegistrationApprovalAdapter`), so an automatic offer holds, records and
 * emails exactly as a manual one does — a paid registration is held its places
 * for the offer window and sent `waitlist.offered`; a free one is confirmed
 * through the approval settlement. The line stops at the first person whose
 * request no longer fits: serving whoever is behind them would be skipping
 * them. An event that requires approval is left to its organizer
 * (`autoOffersWaitlist`).
 */
@Injectable()
export class WaitlistOffersAdapter extends WaitlistOffersPort {
  private readonly logger = new Logger(WaitlistOffersAdapter.name);

  constructor(
    private readonly repo: CheckoutRepository,
    private readonly events: CheckoutEventPort,
    private readonly approvals: RegistrationApprovalAdapter,
    private readonly holds: SeatHoldService,
    private readonly clock: Clock,
  ) {
    super();
  }

  /**
   * Never rejects: the capacity change this follows is already saved, and an
   * organizer's edit must not fail because an offer did. A failure part-way
   * is logged for operations and the offers already made are reported.
   */
  async offerNewPlaces(
    organizationId: number,
    eventId: string,
    ticketTypeId: string,
  ): Promise<number> {
    const served: string[] = [];
    try {
      const event = await this.events.findOwnedById(organizationId, eventId);
      if (event && autoOffersWaitlist(event)) {
        await this.serveInOrder(organizationId, ticketTypeId, served);
      }
    } catch (err) {
      this.logger.warn(
        { err, eventId, ticketTypeId, offered: served.length },
        STOPPED_EARLY,
      );
    }
    return served.length;
  }

  /**
   * The front of the line, one person at a time, until someone does not fit.
   * `served` is filled as it goes, so a failure part-way still counts the
   * places already given.
   */
  private async serveInOrder(
    organizationId: number,
    ticketTypeId: string,
    served: string[],
  ): Promise<void> {
    for (;;) {
      const next = await this.repo.frontOfLine(organizationId, ticketTypeId);
      // A line that did not move would otherwise be served for ever.
      if (!next || served.includes(next.order.id)) return;
      if (!(await this.placeFor(organizationId, next))) return;
      served.push(next.order.id);
    }
  }

  private placeFor(
    organizationId: number,
    entry: WaitlistEntry,
  ): Promise<boolean> {
    return confirmsOnOffer(entry.order)
      ? this.confirmFree(organizationId, entry)
      : this.offerPaid(organizationId, entry);
  }

  /** Held for the offer window and offered — or, with no room, left in line. */
  private async offerPaid(
    organizationId: number,
    entry: WaitlistEntry,
  ): Promise<boolean> {
    const result = await this.approvals.offer(
      organizationId,
      entry.order.id,
      NOBODY,
    );
    return result.outcome === 'offered';
  }

  /**
   * Confirmed through approval — but only after the seat-hold engine has held
   * the place. Approval on its own judges only `sold` against `total`, and
   * ignores other buyers' live holds: fine for one human decision, not for a
   * loop handing out places, which must ask the one authority on what is
   * free. The approval then converts this hold (it matches holds by order),
   * and when it does not go through the place goes straight back.
   */
  private async confirmFree(
    organizationId: number,
    entry: WaitlistEntry,
  ): Promise<boolean> {
    const actor = { organizationId };
    const hold = await this.holds.holdForOffer(actor, {
      eventId: entry.order.eventId,
      ticketTypeId: entry.ticketTypeId,
      quantity: entry.quantity,
      orderId: entry.order.id,
      expiresAt: new Date(this.clock.now().getTime() + CONFIRM_HOLD_MS),
    });
    if (!hold) return false;
    let confirmed = false;
    try {
      const result = await this.approvals.approve(
        organizationId,
        entry.order.id,
        NOBODY,
      );
      confirmed = result.outcome === 'approved';
      return confirmed;
    } finally {
      if (!confirmed) await this.holds.release(actor, [hold.id]);
    }
  }
}
