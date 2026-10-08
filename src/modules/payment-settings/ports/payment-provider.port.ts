/**
 * Outcome of a credential check — never carries a secret back, only a verdict,
 * a reason a human can act on, and the account the key turned out to belong to.
 */
export interface VerifyResult {
  ok: boolean;
  reason?: string;
  /**
   * The `acct_…` the key authenticates as, when it worked. Recorded so the
   * screen can show WHICH Stripe account is wired up without ever showing the
   * key — and so a reconciliation has something to match against.
   */
  accountId?: string;
}

/**
 * The payment provider, as this module needs it (DIP — the consumer owns the
 * port).
 *
 * Verification takes the secret key rather than an account reference, because
 * under per-workspace credentials the key IS the identity: there is no platform
 * key that could look up somebody else's account. It must be **read-only** —
 * "Test connection" proves the key works without moving any money (US-SET-08).
 *
 * The key is passed in and never stored by the adapter. Callers hand over a
 * decrypted secret for the length of one call and nothing else.
 */
export abstract class PaymentProviderPort {
  abstract verifyKey(secretKey: string): Promise<VerifyResult>;
}
