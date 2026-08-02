import { Module } from '@nestjs/common';
import { TicketingModule } from '../ticketing/ticketing.module';
import { SeatHoldRepository } from './seat-hold.repository';
import { SeatHoldService } from './seat-hold.service';
import { TicketEligibilityPolicy } from './ticket-eligibility.policy';

/**
 * Registration & Orders: the checkout seat-hold engine (reserve / release / expire
 * inventory) — the sanctioned money-path transaction (CLAUDE.md), synchronous,
 * row-locked and idempotent. The Monitor read model lives in
 * RegistrationStatsModule; the HTTP surface and order/attendee write model arrive
 * with the checkout (`POST /orders`) slice.
 *
 * Imports TicketingModule only for the `TicketEligibilityPort` it binds: this
 * module owns that abstraction (it is the consumer) and never reads `ticket_types`
 * itself — the gate that refuses a sale outside the window (US-TKT-03) asks
 * Ticketing, it does not query it.
 */
@Module({
  imports: [TicketingModule],
  providers: [SeatHoldService, SeatHoldRepository, TicketEligibilityPolicy],
  exports: [SeatHoldService],
})
export class RegistrationModule {}
