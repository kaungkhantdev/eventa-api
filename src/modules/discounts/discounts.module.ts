import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { EventsModule } from '../events/events.module';
import { TicketingModule } from '../ticketing/ticketing.module';
import { DiscountCodeGenerator } from './discount-code.generator';
import { DiscountRedemptionService } from './discount-redemption.service';
import { DiscountsController } from './discounts.controller';
import { DiscountsPolicy } from './discounts.policy';
import { DiscountsQueryService } from './discounts-query.service';
import { DiscountsRepository } from './discounts.repository';
import { DiscountsService } from './discounts.service';

/**
 * Promotions: discount codes and their redemption (US-TKT-07…12). Owns
 * `discount_codes` and `discount_redemptions`.
 *
 * Two facets of one concern: `DiscountsService` (+ query) is the organizer's
 * side — create, tune, switch off, browse; `DiscountRedemptionService` is the
 * attendee's — try a code at checkout and see the total. They share the same
 * rules object, so a code cannot mean one thing to the organizer and another at
 * the till.
 *
 * Consumes two ports rather than reading events: `EventOrgLookupPort` (which
 * workspace an event belongs to — how an anonymous quote gets a tenant without
 * trusting the caller) and Ticketing's `EventLookupPort` (names for the list).
 */
@Module({
  imports: [EventsModule, TicketingModule, AccessModule],
  controllers: [DiscountsController],
  providers: [
    DiscountsService,
    DiscountsQueryService,
    DiscountRedemptionService,
    DiscountsRepository,
    DiscountsPolicy,
    DiscountCodeGenerator,
  ],
  exports: [DiscountRedemptionService],
})
export class DiscountsModule {}
