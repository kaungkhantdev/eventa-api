/** Who a webhook callback belongs to, and what could have signed it. */
export interface WebhookIdentity {
  organizationId: number;
  /**
   * Every signing secret this workspace has — test and live.
   *
   * Both, because a workspace registers the SAME URL in Stripe's test and live
   * dashboards and gets a different secret from each. The event does not say
   * which until it is verified, and it cannot be verified without picking one,
   * so the only way through is to try each. Two attempts, bounded by how many
   * modes exist.
   */
  signingSecrets: readonly string[];
}

/**
 * The workspace's own gateway credentials, as the till needs them (US-SET-08).
 *
 * Eventa charges with the organizer's key, so every call to Stripe has to be
 * made as *that workspace*. This port is how Payments asks for the key without
 * owning, storing, or knowing how to decrypt it — PaymentSettings holds the
 * ciphertext and binds the adapter.
 *
 * **The plaintext is borrowed, never kept.** An implementation hands back a
 * decrypted secret for the length of one call; nothing above this line caches
 * it, logs it, or puts it in an error.
 */
export abstract class GatewayCredentialsPort {
  /**
   * The secret key for this workspace's ACTIVE mode.
   *
   * Throws when none is saved. That refusal is the same one checkout already
   * gives for an unconfigured workspace, and it is the honest answer: there is
   * no platform key to fall back to, and falling back to one would take a
   * buyer's money into an account the organizer cannot reach.
   */
  abstract secretKeyFor(organizationId: number): Promise<string>;

  /** Resolve a webhook URL's token to its workspace. Null when unknown. */
  abstract webhookIdentityFor(token: string): Promise<WebhookIdentity | null>;
}
