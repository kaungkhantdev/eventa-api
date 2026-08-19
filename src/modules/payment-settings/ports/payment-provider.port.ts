/** Outcome of a credential check — never carries a secret, only a reason. */
export interface VerifyResult {
  ok: boolean;
  reason?: string;
}

/**
 * The payment provider, as this module needs it (DIP — the consumer owns the
 * port). Verification must be **read-only**: it proves the connected account is
 * reachable and usable without moving any money (US-SET-08 "Test connection").
 */
export abstract class PaymentProviderPort {
  abstract verify(accountId: string): Promise<VerifyResult>;
}
