import type { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import type { Env } from '../../../config/env.validation';
import { StripeAccountAdapter } from './stripe-account.adapter';

const ACCOUNT = 'acct_1A2b3C';

function config(): ConfigService<Env, true> {
  return {
    getOrThrow: () => 'sk_test_dummy',
  } as unknown as ConfigService<Env, true>;
}

function harness(retrieve: jest.Mock): StripeAccountAdapter {
  const client = { accounts: { retrieve } } as unknown as Stripe;
  return new StripeAccountAdapter(config(), client);
}

const answering = (account: Partial<Stripe.Account>) =>
  jest.fn().mockResolvedValue(account);

const refusing = (error: unknown) => jest.fn().mockRejectedValue(error);

/**
 * "Connected" has to mean Stripe agrees, not that a string looked plausible.
 *
 * This replaced a regex that only checked the reference began `acct_`. A typo,
 * an account from another platform, or one whose onboarding was never finished
 * all passed it — and the workspace was then marked connected, shown as ready
 * to take money, and only found out at the till when a real buyer's charge
 * failed. Asking Stripe is the whole job of this adapter.
 */
describe('StripeAccountAdapter', () => {
  it('accepts an account Stripe will let take money', async () => {
    const adapter = harness(answering({ charges_enabled: true }));
    await expect(adapter.verify(ACCOUNT)).resolves.toEqual({ ok: true });
  });

  it('asks Stripe about the account it was given', async () => {
    const retrieve = answering({ charges_enabled: true });
    await harness(retrieve).verify(ACCOUNT);
    expect(retrieve).toHaveBeenCalledWith(ACCOUNT);
  });

  describe('an account that cannot take money', () => {
    it('refuses one Stripe has disabled, and says which reason', async () => {
      const adapter = harness(
        answering({
          charges_enabled: false,
          requirements: {
            disabled_reason: 'requirements.past_due',
          } as Stripe.Account.Requirements,
        }),
      );
      const result = await adapter.verify(ACCOUNT);
      expect(result.ok).toBe(false);
      expect(result.reason).toContain('requirements.past_due');
    });

    /**
     * Mid-onboarding is the common case, and the count is the actionable part:
     * the field paths Stripe returns (`business_profile.mcc`) are not written
     * for the person reading them, but "still needs 3 details" tells an
     * organizer to go back and finish.
     */
    it('counts what Stripe is still waiting for', async () => {
      const adapter = harness(
        answering({
          charges_enabled: false,
          requirements: {
            disabled_reason: null,
            currently_due: ['business_profile.mcc', 'external_account'],
          } as Stripe.Account.Requirements,
        }),
      );
      const result = await adapter.verify(ACCOUNT);
      expect(result.ok).toBe(false);
      expect(result.reason).toContain('2');
    });

    it('still refuses when Stripe offers no reason at all', async () => {
      const adapter = harness(answering({ charges_enabled: false }));
      const result = await adapter.verify(ACCOUNT);
      expect(result.ok).toBe(false);
      expect(result.reason).toBeTruthy();
    });
  });

  /**
   * A rejected lookup is an ANSWER — "no" — not a server fault. Retrieving an
   * account id that does not exist, or belongs to another platform, throws
   * here; letting that escape would turn an organizer's typo into a 500.
   */
  describe('when Stripe rejects the lookup', () => {
    it('reports Stripe’s own words rather than throwing', async () => {
      const adapter = harness(
        refusing(
          new Stripe.errors.StripeInvalidRequestError({
            type: 'invalid_request_error',
            message: 'No such account: acct_1A2b3C',
          }),
        ),
      );
      const result = await adapter.verify(ACCOUNT);
      expect(result.ok).toBe(false);
      expect(result.reason).toContain('No such account');
    });

    it('survives a failure that is not a Stripe error', async () => {
      const adapter = harness(refusing(new Error('ECONNREFUSED')));
      const result = await adapter.verify(ACCOUNT);
      expect(result.ok).toBe(false);
      // Not the raw connection error: that says nothing to an organizer, and
      // internal failure detail does not belong in an API response.
      expect(result.reason).not.toContain('ECONNREFUSED');
      expect(result.reason).toBeTruthy();
    });
  });
});
