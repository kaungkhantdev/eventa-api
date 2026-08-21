import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { STRIPE_API_VERSION } from '../../../common/stripe/stripe-api-version';
import type { Env } from '../../../config/env.validation';
import {
  PaymentProviderPort,
  type VerifyResult,
} from '../ports/payment-provider.port';

/**
 * Stripe, behind PaymentSettings' `PaymentProviderPort` — proving a workspace's
 * connected account is real and able to take money (US-SET-08).
 *
 * Read-only by design: "Test connection" must never move money, so this asks
 * Stripe about the account and nothing more.
 *
 * The platform key is what makes the check meaningful. `accounts.retrieve` on a
 * connected account only succeeds for accounts connected to THIS platform, so
 * an organizer cannot paste a stranger's `acct_…` and have it accepted — Stripe
 * refuses the lookup, and a refusal is an answer rather than an error.
 *
 * **PCI SAQ-A:** no card data, and no tenant secret. `acct_…` is a reference.
 */
@Injectable()
export class StripeAccountAdapter extends PaymentProviderPort {
  private readonly stripe: Stripe;

  constructor(config: ConfigService<Env, true>, client?: Stripe) {
    super();
    this.stripe =
      client ??
      new Stripe(config.getOrThrow('STRIPE_SECRET_KEY', { infer: true }), {
        apiVersion: STRIPE_API_VERSION,
        typescript: true,
      });
  }

  async verify(accountId: string): Promise<VerifyResult> {
    try {
      const account = await this.stripe.accounts.retrieve(accountId);
      if (!account.charges_enabled) {
        return { ok: false, reason: whyNotChargeable(account) };
      }
      return { ok: true };
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
 * Stripe's own message is written for the person who typed the account id — "No
 * such account: acct_…" is exactly what they need. Anything else is our
 * problem, not theirs, and its detail does not belong in an API response.
 */
function refusalReason(error: unknown): string {
  if (error instanceof Stripe.errors.StripeError) return error.message;
  return 'Stripe could not be reached to check this account. Please try again.';
}
