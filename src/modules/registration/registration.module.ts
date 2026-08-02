import { Module, forwardRef } from '@nestjs/common';
import { CheckoutActivityPort } from '../ticketing/ports/checkout-activity.port';
import { TicketingModule } from '../ticketing/ticketing.module';
import { CheckoutActivityAdapter } from './checkout-activity.adapter';
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
 * Registration and Ticketing are genuinely bidirectional, so each side owns the
 * port it consumes and neither reads the other's tables (`forwardRef`):
 *   · Registration → Ticketing: `TicketEligibilityPort`, "may this tier be sold
 *     right now?" — the gate that refuses a sale outside the window (US-TKT-03).
 *   · Ticketing → Registration: `CheckoutActivityPort`, "is anyone mid-checkout
 *     with this tier?" — so retiring one never yanks inventory from a buyer
 *     who is paying (US-TKT-05). Registration binds the adapter here.
 */
@Module({
  imports: [forwardRef(() => TicketingModule)],
  providers: [
    SeatHoldService,
    SeatHoldRepository,
    TicketEligibilityPolicy,
    { provide: CheckoutActivityPort, useClass: CheckoutActivityAdapter },
  ],
  exports: [SeatHoldService, CheckoutActivityPort],
})
export class RegistrationModule {}
