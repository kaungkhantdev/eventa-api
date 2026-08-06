/** Whether this workspace can be paid at all, and which account to pay. */
export interface PayoutAccount {
  connected: boolean;
  /** The provider's connected-account reference; never a bank account number. */
  accountId: string | null;
}

/**
 * Payouts' view of the workspace's payment connection. PaymentSettings owns the
 * `payment_settings` row (US-SET-08) and binds the adapter.
 */
export abstract class PayoutAccountPort {
  abstract findAccount(organizationId: number): Promise<PayoutAccount>;
}
