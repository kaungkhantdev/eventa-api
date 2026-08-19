import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MAX_SEATS_PER_BOOKING } from '../../common/booking/booking.limits';
import { Clock } from '../../common/time/clock';
import { DomainException } from '../../common/errors/domain.exception';
import type { Env } from '../../config/env.validation';
import { TicketEligibilityPort } from './ports/ticket-eligibility.port';
import { SeatHoldRepository } from './seat-hold.repository';
import type {
  HoldQuantityInput,
  HoldSeatsInput,
  SeatHoldActor,
  SeatHoldRow,
} from './seat-hold.types';
import { TicketEligibilityPolicy } from './ticket-eligibility.policy';

const MS_PER_SECOND = 1000;

/**
 * The checkout seat-hold engine: reserve inventory for a buyer while they check
 * out, release it, and expire it. Concurrency-safe holds (one active hold per
 * seat; GA capacity never oversold) are enforced in the repository transaction;
 * this service owns the booking rules (1–8 per booking) and the TTL, and gates
 * every reservation through the per-tier eligibility policy (on sale, inside the
 * sales window, within per-order bounds) before the engine runs — so a closed
 * window refuses a purchase even when the badge still reads "On sale" (US-TKT-03).
 */
@Injectable()
export class SeatHoldService {
  private readonly ttlSeconds: number;

  constructor(
    private readonly repo: SeatHoldRepository,
    private readonly clock: Clock,
    config: ConfigService<Env, true>,
    private readonly eligibility: TicketEligibilityPort,
    private readonly eligibilityPolicy: TicketEligibilityPolicy,
  ) {
    this.ttlSeconds = config.getOrThrow('HOLD_TTL_SECONDS', { infer: true });
  }

  /** Hold specific seats (all-or-nothing); 409 if any was just taken. */
  async holdSeats(
    actor: SeatHoldActor,
    input: HoldSeatsInput,
  ): Promise<SeatHoldRow[]> {
    const seatIds = [...new Set(input.seatIds)];
    this.assertBookingSize(seatIds.length);
    const now = this.clock.now();
    await this.assertSeatTiersOnSale(
      actor.organizationId,
      input.eventId,
      seatIds,
      now,
    );
    const result = await this.repo.holdSeats(
      actor.organizationId,
      input.eventId,
      seatIds,
      this.expiryFrom(now),
      now,
      input.orderId,
    );
    if (!result.ok) {
      throw DomainException.conflict(
        'Some of those seats were just taken. Please choose different seats.',
        { unavailableSeatIds: result.unavailableSeatIds },
      );
    }
    return result.holds;
  }

  /** Hold a quantity against a GA tier; 409 if fewer than requested remain. */
  async holdQuantity(
    actor: SeatHoldActor,
    input: HoldQuantityInput,
  ): Promise<SeatHoldRow> {
    this.assertBookingSize(input.quantity);
    const now = this.clock.now();
    const info = await this.eligibility.getEligibility(
      actor.organizationId,
      input.eventId,
      input.ticketTypeId,
    );
    if (!info) {
      throw DomainException.notFound(
        'That ticket type is not available for this event.',
      );
    }
    this.eligibilityPolicy.assertPurchasable(info, input.quantity, now);
    const result = await this.repo.holdQuantity(
      actor.organizationId,
      input.eventId,
      input.ticketTypeId,
      input.quantity,
      this.expiryFrom(now),
      now,
      input.orderId,
    );
    if (!result.ok) {
      throw DomainException.conflict(
        `Only ${result.available} left — please reduce your quantity.`,
        { available: result.available },
      );
    }
    return result.hold;
  }

  /** Release active holds early (buyer abandoned the checkout). */
  async release(actor: SeatHoldActor, holdIds: number[]): Promise<void> {
    await this.repo.release(actor.organizationId, holdIds);
  }

  /** Sweep this tenant's lapsed holds to `expired`, freeing their inventory. */
  async expireStale(actor: SeatHoldActor, now?: Date): Promise<number> {
    return this.repo.expireStale(actor.organizationId, now ?? this.clock.now());
  }

  private assertBookingSize(count: number): void {
    if (count < 1 || count > MAX_SEATS_PER_BOOKING) {
      throw DomainException.validation(
        `Choose between 1 and ${MAX_SEATS_PER_BOOKING} seats per booking.`,
      );
    }
  }

  /**
   * Every tier backing the requested seats must be on sale (per-order bounds are
   * enforced per line item at order composition). Seats with no tier skip it.
   */
  private async assertSeatTiersOnSale(
    organizationId: number,
    eventId: string,
    seatIds: number[],
    now: Date,
  ): Promise<void> {
    const tierIds = await this.repo.ticketTypeIdsForSeats(
      organizationId,
      eventId,
      seatIds,
    );
    if (tierIds.length === 0) return;
    const byId = await this.eligibility.getEligibilityByIds(
      organizationId,
      tierIds,
    );
    for (const tierId of tierIds) {
      const info = byId.get(tierId);
      if (!info) {
        throw DomainException.conflict(
          'One of those seats is no longer available for sale.',
        );
      }
      this.eligibilityPolicy.assertOnSale(info, now);
    }
  }

  private expiryFrom(now: Date): Date {
    return new Date(now.getTime() + this.ttlSeconds * MS_PER_SECOND);
  }
}
