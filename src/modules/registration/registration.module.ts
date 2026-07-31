import { Module } from '@nestjs/common';
import { SeatHoldRepository } from './seat-hold.repository';
import { SeatHoldService } from './seat-hold.service';

/**
 * Registration & Orders bounded context. First capability: the checkout seat-hold
 * engine (reserve / release / expire inventory). It runs the money-path reservation
 * transaction directly against the seating/ticketing inventory tables — the
 * sanctioned atomic exception to the module-boundary rule (CLAUDE.md). The HTTP
 * surface and order/attendee model arrive with the checkout (`POST /orders`) slice.
 */
@Module({
  providers: [SeatHoldService, SeatHoldRepository],
  exports: [SeatHoldService],
})
export class RegistrationModule {}
