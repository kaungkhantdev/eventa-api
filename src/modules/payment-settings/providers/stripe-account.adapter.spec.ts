import Stripe from 'stripe';
import { StripeAccountAdapter } from './stripe-account.adapter';

/**
 * A LIVE key throughout, because that is the mode whose account standing
 * matters: a live charge on an unactivated account fails at the till, in front
 * of a buyer. The test-mode cases below use TEST_SECRET deliberately.
 */
const SECRET = 'sk_live_51P9xEventa7hV6tL1pX';
const TEST_SECRET = 'sk_test_51P9xEventa7hV6tL1pX';
const ACCOUNT = 'acct_1A2b3C';

const answering = (account: Partial<Stripe.Account>) =>
  jest.fn().mockResolvedValue(account);

const refusing = (error: unknown) => jest.fn().mockRejectedValue(error);

/**
 * A harness that records which key the client was built with, so the adapter
 * cannot quietly authenticate as somebody else.
 */
function harness(retrieve: jest.Mock) {
  const built: string[] = [];
  const adapter = new StripeAccountAdapter((key) => {
    built.push(key);
    return { accounts: { retrieveCurrent: retrieve } } as unknown as Stripe;
  });
  return { adapter, built };
}

/**
 * "Connected" has to mean Stripe agrees, and it has to mean Stripe agrees
 * **with this workspace's own key**.
 *
 * This replaced a regex that only checked a reference began `acct_`. A typo, an
 * account belonging to somebody else, or one whose onboarding was never
 * finished all passed it — the workspace was marked connected, shown as ready
 * to take money, and found out at the till, by a buyer.
 */
describe('StripeAccountAdapter', () => {
  it('accepts a key Stripe will let take money, and reports whose it is', async () => {
    const { adapter } = harness(
      answering({ id: ACCOUNT, charges_enabled: true }),
    );
    await expect(adapter.verifyKey(SECRET)).resolves.toEqual({
      ok: true,
      accountId: ACCOUNT,
    });
  });

  /**
   * The key is the identity. Building the client with anything else would
   * verify the wrong account and mark a workspace ready on somebody else's
   * standing.
   */
  it('authenticates as the key it was given, not a shared one', async () => {
    const { adapter, built } = harness(
      answering({ id: ACCOUNT, charges_enabled: true }),
    );
    await adapter.verifyKey(SECRET);
    expect(built).toEqual([SECRET]);
  });

  /**
   * `retrieveCurrent` is Stripe's own name for "the account this key belongs
   * to". `retrieve(id)` would ask a different, weaker question — and under
   * per-workspace keys there is no key that could name anyone else's account.
   */
  it('asks about the key’s own account', async () => {
    const retrieve = answering({ id: ACCOUNT, charges_enabled: true });
    await harness(retrieve).adapter.verifyKey(SECRET);
    expect(retrieve).toHaveBeenCalledWith();
  });

  /**
   * `charges_enabled` is Stripe's word on whether the account may take **live**
   * charges, and only that. A brand-new or sandbox account reports `false`
   * while its test key takes test payments perfectly well — so demanding it of
   * a `sk_test_` key refused working sandboxes with "Stripe has not enabled
   * charges on this account yet", which is true and completely unhelpful.
   */
  describe('a test key, where charges_enabled says nothing useful', () => {
    it('accepts a sandbox key Stripe has not activated for live charges', async () => {
      const { adapter } = harness(
        answering({ id: ACCOUNT, charges_enabled: false }),
      );
      await expect(adapter.verifyKey(TEST_SECRET)).resolves.toEqual({
        ok: true,
        accountId: ACCOUNT,
      });
    });

    it('accepts one still mid-onboarding, for the same reason', async () => {
      const { adapter } = harness(
        answering({
          id: ACCOUNT,
          charges_enabled: false,
          requirements: {
            disabled_reason: null,
            currently_due: ['business_profile.mcc'],
          } as Stripe.Account.Requirements,
        }),
      );
      await expect(adapter.verifyKey(TEST_SECRET)).resolves.toMatchObject({
        ok: true,
      });
    });

    /** The key still has to BE a key: a bad one fails at Stripe, as before. */
    it('still refuses a test key Stripe rejects', async () => {
      const { adapter } = harness(
        refusing(
          new Stripe.errors.StripeAuthenticationError({
            message: 'Invalid API Key provided: sk_test_***',
            type: 'invalid_request_error',
          }),
        ),
      );
      const result = await adapter.verifyKey(TEST_SECRET);
      expect(result.ok).toBe(false);
    });
  });

  describe('a live account that cannot take money', () => {
    it('refuses one Stripe has disabled, and says which reason', async () => {
      const { adapter } = harness(
        answering({
          id: ACCOUNT,
          charges_enabled: false,
          requirements: {
            disabled_reason: 'requirements.past_due',
          } as Stripe.Account.Requirements,
        }),
      );
      const result = await adapter.verifyKey(SECRET);
      expect(result.ok).toBe(false);
      expect(result.reason).toContain('requirements.past_due');
    });

    /**
     * Mid-onboarding is the common case, and the count is the actionable part:
     * the field paths Stripe returns (`business_profile.mcc`) are not written
     * for the person reading them, but "still needs 2 details" tells an
     * organizer to go back to Stripe and finish.
     */
    it('counts what Stripe is still waiting for', async () => {
      const { adapter } = harness(
        answering({
          id: ACCOUNT,
          charges_enabled: false,
          requirements: {
            disabled_reason: null,
            currently_due: ['business_profile.mcc', 'external_account'],
          } as Stripe.Account.Requirements,
        }),
      );
      const result = await adapter.verifyKey(SECRET);
      expect(result.ok).toBe(false);
      expect(result.reason).toContain('2');
    });

    it('still refuses when Stripe offers no reason at all', async () => {
      const { adapter } = harness(answering({ id: ACCOUNT }));
      const result = await adapter.verifyKey(SECRET);
      expect(result.ok).toBe(false);
      expect(result.reason).toBeTruthy();
    });
  });

  /**
   * A rejected lookup is an ANSWER — "no" — not a server fault. A revoked or
   * mistyped key throws here; letting that escape would turn a paste error into
   * a 500 on a settings page.
   */
  describe('when Stripe rejects the key', () => {
    it('reports Stripe’s own words rather than throwing', async () => {
      const { adapter } = harness(
        refusing(
          new Stripe.errors.StripeAuthenticationError({
            type: 'invalid_request_error',
            message: 'Invalid API Key provided: sk_test_***',
          }),
        ),
      );
      const result = await adapter.verifyKey(SECRET);
      expect(result.ok).toBe(false);
      expect(result.reason).toContain('Invalid API Key');
    });

    it('survives a failure that is not a Stripe error', async () => {
      const { adapter } = harness(refusing(new Error('ECONNREFUSED')));
      const result = await adapter.verifyKey(SECRET);
      expect(result.ok).toBe(false);
      // Not the raw connection error: it says nothing to an organizer, and
      // internal failure detail does not belong in an API response.
      expect(result.reason).not.toContain('ECONNREFUSED');
      expect(result.reason).toBeTruthy();
    });

    /**
     * Whatever goes wrong, the key must not come back out. Stripe truncates it
     * in its own messages; this proves we never widen that.
     */
    it('never echoes the key back in the reason', async () => {
      const { adapter } = harness(
        refusing(new Error(`bad key ${SECRET} rejected`)),
      );
      const result = await adapter.verifyKey(SECRET);
      expect(result.reason).not.toContain(SECRET);
    });
  });
});
