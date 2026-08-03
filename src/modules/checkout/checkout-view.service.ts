import { Injectable } from '@nestjs/common';
import { MAX_SEATS_PER_BOOKING } from '../../common/booking/booking.limits';
import { DomainException } from '../../common/errors/domain.exception';
import { formatBaht } from '../../common/money/baht';
import { Clock } from '../../common/time/clock';
import { CheckoutPolicy } from './checkout.policy';
import type {
  CheckoutContext,
  CheckoutEvent,
  CheckoutSeat,
  CheckoutTier,
} from './checkout.types';
import type { CheckoutTierDto, CheckoutViewDto } from './dto/checkout-view.dto';
import { CheckoutEventPort } from './ports/checkout-event.port';
import { SeatMapPort } from './ports/seat-map.port';
import { TicketCatalogPort } from './ports/ticket-catalog.port';

const FREE_LABEL = 'Free';
const ONSALE = 'onsale';
/** An allocation of 0 means unlimited — mirrors `TicketingPolicy`. */
const UNLIMITED = 0;
const GA_SEATING_NOTE = 'Seating is first-come, first-served.';
const ONLINE_DELIVERY_NOTE =
  'A join link will be emailed to you before the event starts.';

/**
 * Assembles what a buyer sees when checkout opens (US-DISC-04), and loads the
 * context every other checkout action starts from.
 *
 * Two things here are load-bearing rather than cosmetic. Resolving the event is
 * also the authorization check on this anonymous surface — a draft or private
 * event is simply "not available", indistinguishable from one that never
 * existed — and the `organizationId` it yields is what establishes the tenant for
 * everything that follows, so a caller can never name a workspace of their own
 * choosing. And prices come from the catalog port at the moment of use, never
 * from the client, so a stale page cannot buy at yesterday's price.
 */
@Injectable()
export class CheckoutViewService {
  constructor(
    private readonly events: CheckoutEventPort,
    private readonly catalog: TicketCatalogPort,
    private readonly seatMap: SeatMapPort,
    private readonly policy: CheckoutPolicy,
    private readonly clock: Clock,
  ) {}

  async view(slug: string): Promise<CheckoutViewDto> {
    const event = this.requireOpen(await this.events.findPublishedBySlug(slug));
    const tiers = await this.catalog.tiersForEvent(
      event.organizationId,
      event.id,
    );
    return {
      event: this.toEventDto(event),
      tiers: tiers.map((tier) => this.toTierDto(tier)),
      seatMap: await this.toSeatMap(event),
      notes: this.notes(event),
      maxPerBooking: MAX_SEATS_PER_BOOKING,
      // "no fees are added, and the payment step is skipped" for a free event.
      paymentRequired: tiers.some((t) => this.canSelect(t) && !this.isFree(t)),
    };
  }

  /** The event a checkout action is against, with its tenant already resolved. */
  async load(eventId: string): Promise<CheckoutContext> {
    const event = this.requireOpen(
      await this.events.findPublishedById(eventId),
    );
    return { event };
  }

  /** The tier being bought, priced by the catalog rather than by the client. */
  async requireTier(
    organizationId: number,
    eventId: string,
    ticketTypeId: string,
  ): Promise<CheckoutTier> {
    const tier = await this.catalog.tierById(
      organizationId,
      eventId,
      ticketTypeId,
    );
    if (!tier) {
      throw DomainException.notFound(
        "That ticket type isn't available for this event.",
      );
    }
    return tier;
  }

  /** Every seat of a reserved-seating event, taken ones included (greyed out). */
  seatsFor(
    event: CheckoutEvent,
    ownHoldIds?: number[],
  ): Promise<CheckoutSeat[]> {
    return this.seatMap.seatsForEvent(
      event.organizationId,
      event.id,
      this.clock.now(),
      ownHoldIds,
    );
  }

  private requireOpen(event: CheckoutEvent | null): CheckoutEvent {
    if (!event) throw DomainException.notFound("This event isn't available.");
    this.policy.assertRegistrationOpen(event.startAt, this.clock.now());
    return event;
  }

  private async toSeatMap(
    event: CheckoutEvent,
  ): Promise<CheckoutViewDto['seatMap']> {
    if (event.seatingMode !== 'reserved') return null;
    return { seats: await this.seatsFor(event) };
  }

  private toEventDto(event: CheckoutEvent): CheckoutViewDto['event'] {
    const physical = !event.isOnline;
    return {
      id: event.id,
      slug: event.slug,
      name: event.name,
      startAt: event.startAt.toISOString(),
      endAt: event.endAt?.toISOString() ?? null,
      timezone: event.timezone,
      isOnline: event.isOnline,
      // An online event never publishes a venue, whatever the row happens to hold.
      venueName: physical ? event.venueName : null,
      venueAddress: physical ? event.venueAddress : null,
      city: physical ? event.city : null,
      coverImage: event.coverImage,
      organizerName: event.organizerName,
      seatingMode: event.seatingMode,
    };
  }

  private toTierDto(tier: CheckoutTier): CheckoutTierDto {
    return {
      id: tier.id,
      name: tier.name,
      priceLabel: this.isFree(tier) ? FREE_LABEL : formatBaht(tier.priceSatang),
      priceSatang: tier.priceSatang,
      isFree: tier.isFree,
      status: tier.status,
      canSelect: this.canSelect(tier),
      minPerOrder: tier.minPerOrder,
      maxPerOrder: tier.maxPerOrder,
      remaining:
        tier.total === UNLIMITED ? null : Math.max(0, tier.total - tier.sold),
    };
  }

  private notes(event: CheckoutEvent): CheckoutViewDto['notes'] {
    return {
      seating: event.seatingMode === 'ga' ? GA_SEATING_NOTE : null,
      delivery: event.isOnline ? ONLINE_DELIVERY_NOTE : null,
    };
  }

  /** The catalog hands back a live status, so this is the whole rule. */
  private canSelect(tier: CheckoutTier): boolean {
    return tier.status === ONSALE;
  }

  private isFree(tier: CheckoutTier): boolean {
    return tier.isFree || tier.priceSatang === 0;
  }
}
