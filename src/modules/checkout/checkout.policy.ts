import { Injectable } from '@nestjs/common';
import { MAX_SEATS_PER_BOOKING } from '../../common/booking/booking.limits';
import { DomainException } from '../../common/errors/domain.exception';
import type {
  CheckoutSeat,
  CheckoutSelection,
  SeatingMode,
  SelectionInput,
} from './checkout.types';

/**
 * The rules a checkout selection must satisfy before any money or inventory is
 * touched (US-DISC-04). Pure and stateless: it decides on the values handed to
 * it, so the services stay orchestration.
 *
 * Note what is deliberately NOT here. Whether a tier may be sold right now, and
 * whether a quantity sits inside that tier's own per-order bounds, is
 * `TicketEligibilityPolicy`'s job and is enforced inside the hold; whether a seat
 * survives the race is settled by the reservation transaction. This layer owns
 * only the shape of the pick — that it matches how the event seats people, that
 * it is within the platform booking cap, and that every seat chosen is one this
 * ticket type actually prices.
 */
@Injectable()
export class CheckoutPolicy {
  /**
   * Parse the client's pick into the one shape this event supports. The EVENT
   * decides, never the client's claim about itself: a reserved-seating event
   * cannot be bought by the yard, and a general-admission one has no seats to
   * name.
   */
  resolveSelection(
    seatingMode: SeatingMode,
    input: SelectionInput,
  ): CheckoutSelection {
    return seatingMode === 'reserved'
      ? this.resolveReserved(input)
      : this.resolveGeneralAdmission(input);
  }

  /**
   * The tier's own per-order bounds (US-TKT-01), applied while the buyer is still
   * choosing. The reservation transaction applies them again through
   * `TicketEligibilityPolicy` and stays the authority — this earlier copy exists
   * so a summary never quotes a quantity the tier would refuse at the till.
   */
  assertWithinTierBounds(
    tier: { minPerOrder: number; maxPerOrder: number },
    count: number,
  ): void {
    if (count < tier.minPerOrder) {
      throw DomainException.validation(
        `You must buy at least ${tier.minPerOrder} of this ticket type per order.`,
      );
    }
    if (count > tier.maxPerOrder) {
      throw DomainException.validation(
        `You can buy at most ${tier.maxPerOrder} of this ticket type per order.`,
      );
    }
  }

  /** Registration closes when the event begins — same rule as the public page. */
  assertRegistrationOpen(startAt: Date, now: Date): void {
    if (startAt.getTime() > now.getTime()) return;
    throw DomainException.conflict('Registration is closed for this event.');
  }

  /**
   * Match the chosen seat ids to the map, in the order asked. Every seat must
   * exist, still be free, and be priced by the ticket type being bought —
   * otherwise the summary would quote a price the seat does not carry.
   */
  resolveSeats(
    seats: CheckoutSeat[],
    seatIds: number[],
    ticketTypeId: string,
  ): CheckoutSeat[] {
    const byId = new Map(seats.map((s) => [s.id, s]));
    return seatIds.map((id) => {
      const seat = byId.get(id);
      if (!seat) {
        throw DomainException.conflict(
          'One of those seats is no longer available. Please choose again.',
        );
      }
      if (seat.ticketTypeId !== ticketTypeId) {
        throw DomainException.validation(
          'Those seats belong to a different ticket type. Please choose again.',
        );
      }
      if (!seat.available) {
        throw DomainException.conflict(
          'Some of those seats were just taken. Please choose different seats.',
        );
      }
      return seat;
    });
  }

  private resolveReserved(input: SelectionInput): CheckoutSelection {
    const seatIds = input.seatIds ?? [];
    if (seatIds.length === 0) {
      throw DomainException.validation(
        'This event has reserved seating — please pick your seats.',
      );
    }
    if (new Set(seatIds).size !== seatIds.length) {
      throw DomainException.validation(
        'The same seat was picked twice. Please choose again.',
      );
    }
    this.assertBookingSize(seatIds.length);
    return { mode: 'reserved', ticketTypeId: input.ticketTypeId, seatIds };
  }

  private resolveGeneralAdmission(input: SelectionInput): CheckoutSelection {
    if (input.seatIds && input.seatIds.length > 0) {
      throw DomainException.validation(
        'This event is general admission — choose a quantity instead of seats.',
      );
    }
    const quantity = input.quantity ?? 0;
    this.assertBookingSize(quantity);
    return { mode: 'ga', ticketTypeId: input.ticketTypeId, quantity };
  }

  /** The platform-wide cap, on top of whatever the tier itself allows. */
  private assertBookingSize(count: number): void {
    if (count >= 1 && count <= MAX_SEATS_PER_BOOKING) return;
    throw DomainException.validation(
      `Choose between 1 and ${MAX_SEATS_PER_BOOKING} tickets per booking.`,
    );
  }
}
