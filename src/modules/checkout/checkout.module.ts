import { Module, forwardRef } from '@nestjs/common';
import { DiscountsModule } from '../discounts/discounts.module';
import { PlatformModule } from '../platform/platform.module';
import { EventsModule } from '../events/events.module';
import { RegistrationModule } from '../registration/registration.module';
import { TicketingModule } from '../ticketing/ticketing.module';
import { WaitlistOffersPort } from '../ticketing/ports/waitlist-offers.port';
import { InvoiceOrderPort } from '../invoices/ports/invoice-order.port';
import { OrderPaymentPort } from '../payments/ports/order-payment.port';
import { RegistrationApprovalPort } from '../registrations/ports/registration-approval.port';
import { RegistrationEntryPort } from '../registrations/ports/registration-entry.port';
import {
  CheckoutController,
  GuestOrderController,
} from './checkout.controller';
import { InvoiceOrderAdapter } from './invoice-order.adapter';
import { OrderPaymentAdapter } from './order-payment.adapter';
import { RegistrationApprovalAdapter } from './registration-approval.adapter';
import { RegistrationEntryAdapter } from './registration-entry.adapter';
import { CheckoutOrderService } from './checkout-order.service';
import { CheckoutPolicy } from './checkout.policy';
import { CheckoutRepository } from './checkout.repository';
import { CheckoutService } from './checkout.service';
import { CheckoutViewService } from './checkout-view.service';
import { CheckoutWaitlistService } from './checkout-waitlist.service';
import { WaitlistOffersAdapter } from './waitlist-offers.adapter';

/**
 * Checkout: the attendee's path from "Get tickets" to held inventory
 * (US-DISC-04). Two facets of one concern — `CheckoutViewService` assembles what
 * the buyer sees and loads the context every action starts from;
 * `CheckoutService` prices a selection and reserves it.
 *
 * It consumes four things and owns none of them. Three are consumer-owned ports,
 * bound by the module that owns the data:
 *   · `CheckoutEventPort` (Events) — what is being sold, and which workspace owns
 *     it. Resolving the event IS the authorization check on this anonymous
 *     surface, and it is where the tenant comes from — never from the caller.
 *   · `TicketCatalogPort` (Ticketing) — the price, read at the moment of use, with
 *     a live-derived status so a tier that just sold out cannot be bought.
 *   · `SeatMapPort` (Registration) — which seats can be picked right now.
 * The fourth is a plain service dependency: `SeatHoldService` for the row-locked
 * reservation, and `DiscountRedemptionService` for what a code is worth.
 *
 * Ticketing and Checkout reference each other (`forwardRef`): Checkout reads
 * the tiers through Ticketing's catalog, and Ticketing asks Checkout to give a
 * raised allocation's new places to the waitlist (`WaitlistOffersPort`,
 * US-REG-04) — the waitlist is orders and the places are seat holds, neither
 * of which Ticketing may read. The adapter serves each person through
 * `RegistrationApprovalAdapter`, the organizer's own offer, so that one
 * instance backs both `RegistrationApprovalPort` (`useExisting`) and it.
 */
@Module({
  imports: [
    EventsModule,
    forwardRef(() => TicketingModule),
    RegistrationModule,
    DiscountsModule,
    PlatformModule,
  ],
  controllers: [CheckoutController, GuestOrderController],
  providers: [
    CheckoutViewService,
    CheckoutService,
    CheckoutOrderService,
    CheckoutWaitlistService,
    CheckoutRepository,
    CheckoutPolicy,
    { provide: OrderPaymentPort, useClass: OrderPaymentAdapter },
    { provide: InvoiceOrderPort, useClass: InvoiceOrderAdapter },
    RegistrationApprovalAdapter,
    {
      provide: RegistrationApprovalPort,
      useExisting: RegistrationApprovalAdapter,
    },
    { provide: RegistrationEntryPort, useClass: RegistrationEntryAdapter },
    { provide: WaitlistOffersPort, useClass: WaitlistOffersAdapter },
  ],
  exports: [
    CheckoutViewService,
    CheckoutService,
    CheckoutOrderService,
    OrderPaymentPort,
    InvoiceOrderPort,
    RegistrationApprovalPort,
    RegistrationEntryPort,
    WaitlistOffersPort,
  ],
})
export class CheckoutModule {}
