/** The workspace's account at the provider, as the till needs it. */
export interface MerchantAccount {
  /** Whether this workspace can take money at all. */
  connected: boolean;
  /** The provider's connected-account reference (`acct_…`) — never a secret. */
  accountId: string | null;
}

/**
 * Whose account a charge lands in (US-SET-08).
 *
 * Eventa holds one platform secret key and charges **on behalf of** each
 * workspace's connected account — that is what makes the product multi-tenant
 * without ever storing a tenant's own Stripe secret. Without this port the
 * account reference never reaches the adapter, and every workspace's money
 * lands in the platform's account instead of its own.
 *
 * Deliberately separate from Payouts' `PayoutAccountPort`, which reads the same
 * row: "can this workspace take money" and "can this workspace be paid" are
 * different questions at the provider (`charges_enabled` against
 * `payouts_enabled`), and one must never stand in as the answer to the other.
 *
 * PaymentSettings owns `payment_settings` and binds the adapter.
 */
export abstract class MerchantAccountPort {
  abstract findAccount(organizationId: number): Promise<MerchantAccount>;
}
