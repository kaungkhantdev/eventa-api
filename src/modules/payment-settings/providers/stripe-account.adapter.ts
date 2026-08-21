import { Injectable } from '@nestjs/common';
import Stripe from 'stripe';
import { STRIPE_API_VERSION } from '../../../common/stripe/stripe-api-version';
import {
  PaymentProviderPort,
  type VerifyResult,
} from '../ports/payment-provider.port';

/** How a Stripe client is made from a key. Injected so a test can supply its own. */
export type StripeClientFactory = (secretKey: string) => Stripe;

export const defaultStripeClient: StripeClientFactory = (secretKey) =>
  new Stripe(secretKey, { apiVersion: STRIPE_API_VERSION, typescript: true });

/**
 * Stripe, behind PaymentSettings' `PaymentProviderPort` — proving a workspace's
 * own key is real and able to take money (US-SET-08).
 *
 * Read-only by design: "Test connection" must never move money, so this asks
 * Stripe about the account behind the key and nothing more.
 *
 * The key is the identity here. There is no platform key that could look up an
 * arbitrary account, so `accounts.retrieve()` is called with **no argument** —
 * "the account this key belongs to". That is what makes the check meaningful:
 * an organizer cannot verify their way into somebody else's standing.
 *
 * **The key is borrowed, never kept.** It arrives decrypted for the length of
 * one call, is used to build one client, and is never stored, logged, or
 * returned — including in a failure reason.
 *
 * **PCI SAQ-A:** no card data passes through here.
 */
@Injectable()
export class StripeAccountAdapter extends PaymentProviderPort {
  constructor(
    private readonly clientFor: StripeClientFactory = defaultStripeClient,
  ) {
    super();
  }

  async verifyKey(secretKey: string): Promise<VerifyResult> {
    try {
      const account =
        await this.clientFor(secretKey).accounts.retrieveCurrent();
      if (!account.charges_enabled) {
        return { ok: false, reason: whyNotChargeable(account) };
      }
      return { ok: true, accountId: account.id };
    } catch (error) {
      return { ok: false, reason: refusalReason(error) };
    }
  }
}

/**
 * Why Stripe will not let this account take money yet, in the order an
 * organizer can act on: an explicit block first, then how much onboarding is
 * left, then a plain statement when Stripe volunteers neither.
 */
function whyNotChargeable(account: Stripe.Account): string {
  const requirements = account.requirements;
  if (requirements?.disabled_reason) {
    return `Stripe has disabled charges on this account (${requirements.disabled_reason}).`;
  }
  const outstanding = requirements?.currently_due?.length ?? 0;
  if (outstanding > 0) {
    const detail = outstanding === 1 ? 'detail' : 'details';
    return `Stripe still needs ${outstanding} ${detail} on this account before it can take payments.`;
  }
  return 'Stripe has not enabled charges on this account yet.';
}

/**
 * Stripe's own message is written for the person who pasted the key — "Invalid
 * API Key provided" is exactly what they need, and Stripe truncates the key in
 * it. Anything else is our problem, not theirs: its detail does not belong in
 * an API response, and an arbitrary error could carry the key verbatim.
 */
function refusalReason(error: unknown): string {
  if (error instanceof Stripe.errors.StripeError) return error.message;
  return 'Stripe could not be reached to check this key. Please try again.';
}
