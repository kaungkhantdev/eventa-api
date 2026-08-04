import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Clock } from '../../common/time/clock';
import type { Env } from '../../config/env.validation';
import { CheckoutModule } from '../checkout/checkout.module';
import { PaymentsController } from './payments.controller';
import { PaymentsRepository } from './payments.repository';
import { PaymentsService } from './payments.service';
import { PaymentProviderPort } from './ports/payment-provider.port';
import { FakePaymentAdapter } from './providers/fake-payment.adapter';

/**
 * Payments (US-DISC-05): collect an order's total by card or PromptPay, and act
 * on what the provider reports back. Owns the `payments` ledger and the inbound
 * `webhook_events` log — and nothing else: the order and its tickets stay behind
 * the Payments-owned `OrderPaymentPort`, which Checkout binds.
 *
 * The provider sits behind `PaymentProviderPort` — the PCI SAQ-A boundary; see
 * the port's docstring. Selection is by `PAYMENT_PROVIDER`, defaulting to the
 * fake so nothing charges a card by accident. Choosing `stripe` fails at BOOT
 * until the Stripe adapter lands — a clear crash at startup beats a buyer
 * discovering it at the till.
 */
@Module({
  imports: [CheckoutModule],
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    PaymentsRepository,
    {
      provide: PaymentProviderPort,
      useFactory: (clock: Clock, config: ConfigService<Env, true>) => {
        const provider = config.getOrThrow('PAYMENT_PROVIDER', {
          infer: true,
        });
        if (provider === 'stripe') {
          throw new Error(
            'PAYMENT_PROVIDER=stripe is configured but the Stripe adapter is not built yet — set PAYMENT_PROVIDER=fake.',
          );
        }
        return new FakePaymentAdapter(clock, config);
      },
      inject: [Clock, ConfigService],
    },
  ],
  exports: [PaymentsService],
})
export class PaymentsModule {}
