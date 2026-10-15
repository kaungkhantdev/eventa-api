import type { PaymentMethodChoice } from '../../payments/ports/payment-provider.port';

/**
 * Checkout's view of which ways to pay a workspace offers (US-SET-09): the
 * methods it switched on that checkout can collect, so a method an Admin
 * turned off no longer appears. Checkout owns the abstraction; PaymentSettings
 * — which owns `payment_method_settings` — binds the adapter.
 */
export abstract class CheckoutPaymentMethodsPort {
  abstract acceptedMethods(
    organizationId: number,
  ): Promise<readonly PaymentMethodChoice[]>;
}
