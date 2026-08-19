import { Injectable } from '@nestjs/common';
import { formatBaht } from '../../common/money/baht';
import {
  type EnteredRegistration,
  type RegistrationEntry,
  RegistrationEntryPort,
} from '../registrations/ports/registration-entry.port';
import { CheckoutService } from './checkout.service';
import { CheckoutOrderService } from './checkout-order.service';

/** What a free registration's amount reads as, rather than "฿0.00". */
const FREE_LABEL = 'Free';

/**
 * Checkout's implementation of the Registrations-owned entry port (US-REG-03).
 *
 * Three steps, all of them the attendee's own: price the selection (so the
 * VAT-inclusive total is computed, never typed), reserve it against capacity
 * (so an over-booking is refused with how many are actually left), then place
 * it (so the attendee is matched to the directory or added, and a free booking
 * confirms with its ticket immediately).
 *
 * The reservation is a real hold rather than a shortcut into `placeOrder`: it is
 * what serializes an organizer's walk-up against the last seat someone else is
 * buying online at the same moment.
 */
@Injectable()
export class RegistrationEntryAdapter extends RegistrationEntryPort {
  constructor(
    private readonly checkout: CheckoutService,
    private readonly orders: CheckoutOrderService,
  ) {
    super();
  }

  async add(entry: RegistrationEntry): Promise<EnteredRegistration> {
    const selection = {
      eventId: entry.eventId,
      ticketTypeId: entry.ticketTypeId,
      quantity: entry.quantity,
      actorOrganizationId: entry.organizationId,
    };
    const { holdIds } = await this.checkout.hold(selection);
    const placed = await this.orders.confirm(
      {
        ...selection,
        holdIds,
        buyer: entry.attendee,
        idempotencyKey: entry.idempotencyKey,
      },
      {
        organizationId: entry.organizationId,
        createdBy: entry.createdBy,
        notify: entry.sendConfirmation,
      },
    );
    return {
      orderId: placed.orderId,
      reference: placed.reference,
      status: placed.status,
      paymentStatus: placed.paymentStatus,
      totalSatang: placed.totalSatang,
      vatSatang: placed.vatSatang,
      amountLabel:
        placed.totalSatang > 0 ? formatBaht(placed.totalSatang) : FREE_LABEL,
      ticketCount: placed.tickets.length,
      paymentRequired: placed.paymentRequired,
    };
  }
}
