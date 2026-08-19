/**
 * Payouts' view of what has actually settled. Payments owns the `payments` and
 * `refunds` ledgers and binds the adapter, so the balance is derived from the
 * money that really moved rather than from a running total someone maintains.
 */
export abstract class SettledFundsPort {
  /** Everything ever collected, net of refunds, VAT-inclusive satang. */
  abstract lifetimeNetSatang(organizationId: number): Promise<number>;
}
