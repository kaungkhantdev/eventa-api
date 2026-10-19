import { Module, forwardRef } from '@nestjs/common';
import { CheckoutActivityPort } from '../ticketing/ports/checkout-activity.port';
import { TicketingModule } from '../ticketing/ticketing.module';
import { SeatMapPort } from '../checkout/ports/seat-map.port';
import { SeatOccupancyPort } from '../event-seating/ports/seat-occupancy.port';
import { CheckoutActivityAdapter } from './checkout-activity.adapter';
import { SeatMapAdapter } from './seat-map.adapter';
import { SeatOccupancyAdapter } from './seat-occupancy.adapter';
import { SeatHoldRepository } from './seat-hold.repository';
import { SeatHoldService } from './seat-hold.service';
import { TicketEligibilityPolicy } from './ticket-eligibility.policy';

/**
 * Registration & Orders: the checkout seat-hold engine (reserve / release / expire
 * inventory) — the sanctioned money-path transaction (AGENTS.md), synchronous,
 * row-locked and idempotent. The Monitor read model lives in
 * RegistrationStatsModule; the HTTP surface and order/attendee write model arrive
 * with the checkout (`POST /orders`) slice.
 *
 * Registration and Ticketing are genuinely bidirectional, so each side owns the
 * port it consumes and neither reads the other's tables (`forwardRef`):
 *   · Registration → Ticketing: `TicketEligibilityPort`, "may this tier be sold
 *     right now?" — the gate that refuses a sale outside the window (US-TKT-03).
 *   · Ticketing → Registration: `CheckoutActivityPort`, "is anyone mid-checkout
 *     with this tier?" — so retiring one never yanks inventory from a buyer
 *     who is paying (US-TKT-05). Registration binds the adapter here.
 *
 * It also answers Seating's `SeatOccupancyPort` ("which of these seats are
 * booked or held?", US-EVT-05) from the same holds and assignments — Seating
 * imports this module; nothing here imports Seating, so there is no cycle.
 */
@Module({
  imports: [forwardRef(() => TicketingModule)],
  providers: [
    SeatHoldService,
    SeatHoldRepository,
    TicketEligibilityPolicy,
    { provide: CheckoutActivityPort, useClass: CheckoutActivityAdapter },
    { provide: SeatMapPort, useClass: SeatMapAdapter },
    { provide: SeatOccupancyPort, useClass: SeatOccupancyAdapter },
  ],
  exports: [
    SeatHoldService,
    SeatHoldRepository,
    CheckoutActivityPort,
    SeatMapPort,
    SeatOccupancyPort,
  ],
})
export class RegistrationModule {}
