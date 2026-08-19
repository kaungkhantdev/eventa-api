import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Clock } from '../../common/time/clock';
import type { Env } from '../../config/env.validation';
import { AccessModule } from '../access/access.module';
import { CheckoutModule } from '../checkout/checkout.module';
import { InvoicePaymentPort } from '../invoices/ports/invoice-payment.port';
import { SettledFundsPort } from '../payouts/ports/settled-funds.port';
import { TaxableSalesPort } from '../tax-periods/ports/taxable-sales.port';
import { InvoicePaymentAdapter } from './invoice-payment.adapter';
import { SettledFundsAdapter } from './settled-funds.adapter';
import { TaxableSalesAdapter } from './taxable-sales.adapter';
import { PaymentsController } from './payments.controller';
import { FinanceController } from './finance.controller';
import { PaymentsLedgerService } from './payments-ledger.service';
import { RefundsService } from './refunds.service';
import { PaymentsRepository } from './payments.repository';
import { PaymentsService } from './payments.service';
import { PaymentProviderPort } from './ports/payment-provider.port';
import { StripePaymentAdapter } from './providers/stripe-payment.adapter';
import { RevenueInsightsPort } from '../dashboard/ports/revenue-insights.port';
import { RevenueInsightsAdapter } from './revenue-insights.adapter';

/**
 * Payments (US-DISC-05): collect an order's total by card or PromptPay, and act
 * on what the provider reports back. Owns the `payments` ledger and the inbound
 * `webhook_events` log — and nothing else: the order and its tickets stay behind
 * the Payments-owned `OrderPaymentPort`, which Checkout binds.
 *
 * The provider sits behind `PaymentProviderPort` — the PCI SAQ-A boundary; see
 * the port's docstring. There is one implementation and it is the real one:
 * a stand-in that can mint a "paid" order does not belong in the shipped app,
 * so the test suite supplies its own. Both Stripe secrets are required at
 * boot rather than discovered at the till.
 */
@Module({
  imports: [AccessModule, CheckoutModule],
  controllers: [PaymentsController, FinanceController],
  providers: [
    { provide: RevenueInsightsPort, useClass: RevenueInsightsAdapter },
    PaymentsService,
    RefundsService,
    PaymentsLedgerService,
    PaymentsRepository,
    {
      provide: PaymentProviderPort,
      // A factory, not `useClass`: the adapter takes an optional Stripe client
      // as a third argument so a test can pass its own, and Nest would try to
      // resolve that as a dependency.
      useFactory: (clock: Clock, config: ConfigService<Env, true>) =>
        new StripePaymentAdapter(clock, config),
      inject: [Clock, ConfigService],
    },
    { provide: InvoicePaymentPort, useClass: InvoicePaymentAdapter },
    { provide: TaxableSalesPort, useClass: TaxableSalesAdapter },
    { provide: SettledFundsPort, useClass: SettledFundsAdapter },
  ],
  exports: [
    RevenueInsightsPort,
    PaymentsService,
    InvoicePaymentPort,
    TaxableSalesPort,
    SettledFundsPort,
    // Payouts shares the provider seam: the hosted settings link and the
    // re-submitted transfer both go through the same adapter.
    PaymentProviderPort,
  ],
})
export class PaymentsModule {}
