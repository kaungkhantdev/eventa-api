import { Injectable } from '@nestjs/common';
import { CheckoutPaymentMethodsPort } from '../checkout/ports/checkout-payment-methods.port';
import type { PaymentMethodChoice } from '../payments/ports/payment-provider.port';
import { PaymentMethodsService } from './payment-methods.service';

/**
 * PaymentSettings' implementation of Checkout's `CheckoutPaymentMethodsPort`.
 * It owns the per-method switches (US-SET-09), so checkout asks which ways to
 * pay are on rather than reading `payment_method_settings` itself.
 */
@Injectable()
export class CheckoutPaymentMethodsAdapter extends CheckoutPaymentMethodsPort {
  constructor(private readonly methods: PaymentMethodsService) {
    super();
  }

  acceptedMethods(organizationId: number): Promise<PaymentMethodChoice[]> {
    return this.methods.acceptedAtCheckout(organizationId);
  }
}
