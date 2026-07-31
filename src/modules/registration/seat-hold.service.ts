import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Clock } from '../../common/time/clock';
import { DomainException } from '../../common/errors/domain.exception';
import type { Env } from '../../config/env.validation';
import { SeatHoldRepository } from './seat-hold.repository';
import type {
  HoldQuantityInput,
  HoldSeatsInput,
  SeatHoldActor,
  SeatHoldRow,
} from './seat-hold.types';

/** A single booking may hold between 1 and this many seats/units (entities.md ck_orders_seats). */
const MAX_SEATS_PER_BOOKING = 8;
const MS_PER_SECOND = 1000;

/**
 * The checkout seat-hold engine: reserve inventory for a buyer while they check
 * out, release it, and expire it. Concurrency-safe holds (one active hold per
 * seat; GA capacity never oversold) are enforced in the repository transaction;
 * this service owns the booking rules (1–8 per booking) and the TTL.
 */
@Injectable()
export class SeatHoldService {
  private readonly ttlSeconds: number;

  constructor(
    private readonly repo: SeatHoldRepository,
    private readonly clock: Clock,
    config: ConfigService<Env, true>,
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

  private expiryFrom(now: Date): Date {
    return new Date(now.getTime() + this.ttlSeconds * MS_PER_SECOND);
  }
}
