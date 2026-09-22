import { Injectable } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain.exception';
import { Clock } from '../../common/time/clock';
import { CheckoutRepository } from './checkout.repository';
import { CheckoutService } from './checkout.service';
import type {
  JoinWaitlistDto,
  WaitlistJoinedDto,
} from './dto/join-waitlist.dto';
import { withFreshReference } from './order-reference';
import { WAITLIST_TICKETS_LEFT, waitlistRefusal } from './waitlist-rules';

/**
 * Joining a sold-out ticket's waitlist (US-REG-04).
 *
 * An entry is a registration in the `waitlisted` status: it names the ticket
 * and how many, is priced by the catalog NOW exactly as a purchase would be,
 * and holds no seat. That makes an offer later the ordinary checkout —
 * `pending`, a seat hold, the same payment page — rather than a second way to
 * buy a ticket.
 *
 * Nothing is emailed on joining. The page tells the buyer where they stand,
 * and the message that matters is the offer.
 */
@Injectable()
export class CheckoutWaitlistService {
  constructor(
    private readonly checkout: CheckoutService,
    private readonly repo: CheckoutRepository,
    private readonly clock: Clock,
  ) {}

  async join(input: JoinWaitlistDto): Promise<WaitlistJoinedDto> {
    const { event, tier, summary } = await this.checkout.priceSelection({
      eventId: input.eventId,
      ticketTypeId: input.ticketTypeId,
      quantity: input.quantity,
      buyerEmail: input.buyer.email,
    });
    const refusal = waitlistRefusal(event, tier);
    if (refusal) throw refusalFor(refusal);

    const { order, position } = await withFreshReference((reference) =>
      this.repo.joinWaitlist({
        organizationId: event.organizationId,
        eventId: event.id,
        reference,
        idempotencyKey: input.idempotencyKey,
        buyer: input.buyer,
        ticketTypeId: summary.ticketTypeId,
        quantity: summary.quantity,
        unitPriceSatang: summary.unitPriceSatang,
        totals: summary,
        now: this.clock.now(),
      }),
    );
    return {
      orderId: order.id,
      reference: order.reference,
      eventName: event.name,
      ticketTypeName: summary.ticketTypeName,
      quantity: order.seats,
      position,
    };
  }
}

/**
 * Tickets freeing up since the page loaded is a race the buyer can act on —
 * 409, so the page can send them back to buy. The event's own settings are
 * not going to change on a retry, so they are 422.
 */
function refusalFor(reason: string): DomainException {
  return reason === WAITLIST_TICKETS_LEFT
    ? DomainException.conflict(reason)
    : DomainException.validation(reason);
}
