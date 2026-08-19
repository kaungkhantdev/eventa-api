import { Injectable, Logger } from '@nestjs/common';
import {
  PaymentProviderPort,
  type VerifyResult,
} from './ports/payment-provider.port';

/** A provider account reference always looks like `acct_…`. */
const ACCOUNT_PATTERN = /^acct_[A-Za-z0-9]+$/;

/**
 * Dev/test payment provider: validates the shape of the account reference
 * without calling out. Swap the binding in PaymentSettingsModule for a real
 * Stripe adapter — nothing else changes, because callers depend on the port.
 */
@Injectable()
export class StubPaymentProvider extends PaymentProviderPort {
  private readonly logger = new Logger('PaymentProvider');

  verify(accountId: string): Promise<VerifyResult> {
    if (!ACCOUNT_PATTERN.test(accountId)) {
      return Promise.resolve({
        ok: false,
        reason: 'Account reference must look like acct_XXXX.',
      });
    }
    this.logger.log({ accountId }, 'Verified payment account (dev provider)');
    return Promise.resolve({ ok: true });
  }
}
