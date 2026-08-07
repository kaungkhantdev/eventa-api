import { Module } from '@nestjs/common';
import { DiscountsModule } from '../discounts/discounts.module';
import { PlatformModule } from '../platform/platform.module';
import { EventsModule } from '../events/events.module';
import { RegistrationModule } from '../registration/registration.module';
import { TicketingModule } from '../ticketing/ticketing.module';
import { InvoiceOrderPort } from '../invoices/ports/invoice-order.port';
import { OrderPaymentPort } from '../payments/ports/order-payment.port';
import { RegistrationApprovalPort } from '../registrations/ports/registration-approval.port';
import { CheckoutController } from './checkout.controller';
import { InvoiceOrderAdapter } from './invoice-order.adapter';
import { OrderPaymentAdapter } from './order-payment.adapter';
import { RegistrationApprovalAdapter } from './registration-approval.adapter';
import { CheckoutOrderService } from './checkout-order.service';
import { CheckoutPolicy } from './checkout.policy';
import { CheckoutRepository } from './checkout.repository';
import { CheckoutService } from './checkout.service';
import { CheckoutViewService } from './checkout-view.service';

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
 * reservation, and `DiscountRedemptionService` for what a code is worth. No
 * `forwardRef` anywhere — nothing in those contexts needs Checkout back.
 */
@Module({
  imports: [
    EventsModule,
    TicketingModule,
    RegistrationModule,
    DiscountsModule,
    PlatformModule,
  ],
  controllers: [CheckoutController],
  providers: [
    CheckoutViewService,
    CheckoutService,
    CheckoutOrderService,
    CheckoutRepository,
    CheckoutPolicy,
    { provide: OrderPaymentPort, useClass: OrderPaymentAdapter },
    { provide: InvoiceOrderPort, useClass: InvoiceOrderAdapter },
    {
      provide: RegistrationApprovalPort,
      useClass: RegistrationApprovalAdapter,
    },
  ],
  exports: [
    CheckoutViewService,
    CheckoutService,
    CheckoutOrderService,
    OrderPaymentPort,
    InvoiceOrderPort,
    RegistrationApprovalPort,
  ],
})
export class CheckoutModule {}
