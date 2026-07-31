import { Module } from '@nestjs/common';
import { SeatHoldRepository } from './seat-hold.repository';
import { SeatHoldService } from './seat-hold.service';

/**
 * Registration & Orders: the checkout seat-hold engine (reserve / release / expire
 * inventory) — the sanctioned money-path transaction (CLAUDE.md), synchronous,
 * row-locked and idempotent. The Monitor read model lives in
 * RegistrationStatsModule; the HTTP surface and order/attendee write model arrive
 * with the checkout (`POST /orders`) slice.
 */
@Module({
  providers: [SeatHoldService, SeatHoldRepository],
  exports: [SeatHoldService],
})
export class RegistrationModule {}
