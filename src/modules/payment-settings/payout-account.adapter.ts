import { Injectable } from '@nestjs/common';
import {
  type PayoutAccount,
  PayoutAccountPort,
} from '../payouts/ports/payout-account.port';
import { PaymentSettingsRepository } from './payment-settings.repository';

/**
 * PaymentSettings' implementation of Payouts' `PayoutAccountPort`. It owns the
 * `payment_settings` row (US-SET-08), so Payouts asks whether the workspace can
 * be paid rather than reading that table itself.
 */
@Injectable()
export class PayoutAccountAdapter extends PayoutAccountPort {
  constructor(private readonly repo: PaymentSettingsRepository) {
    super();
  }

  async findAccount(organizationId: number): Promise<PayoutAccount> {
    const settings = await this.repo.findOrCreate(organizationId);
    // Both must hold: a row can be marked connected but carry no account
    // reference, and paying an account we cannot name is not a thing to try.
    const connected =
      settings.status === 'connected' && Boolean(settings.accountId);
    return { connected, accountId: settings.accountId ?? null };
  }
}
