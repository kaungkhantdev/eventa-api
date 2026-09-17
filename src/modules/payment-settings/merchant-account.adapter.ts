import { Injectable } from '@nestjs/common';
import {
  type MerchantAccount,
  MerchantAccountPort,
} from '../payments/ports/merchant-account.port';
import { PaymentSettingsRepository } from './payment-settings.repository';

/**
 * PaymentSettings' implementation of Payments' `MerchantAccountPort`. It owns
 * the `payment_settings` row (US-SET-08), so Payments asks whose account to
 * charge on rather than reading that table itself.
 */
@Injectable()
export class MerchantAccountAdapter extends MerchantAccountPort {
  constructor(private readonly repo: PaymentSettingsRepository) {
    super();
  }

  async findAccount(organizationId: number): Promise<MerchantAccount> {
    const settings = await this.repo.findOrCreate(organizationId);
    // Both must hold: a row can be marked connected and carry no account
    // reference, and charging on behalf of an account we cannot name is a
    // platform charge wearing a workspace's label.
    const connected =
      settings.status === 'connected' && Boolean(settings.accountId);
    return { connected, accountId: settings.accountId ?? null };
  }
}
