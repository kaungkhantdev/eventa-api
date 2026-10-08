import { Injectable } from '@nestjs/common';
import {
  GatewayCredentialsPort,
  type WebhookIdentity,
} from '../payments/ports/gateway-credentials.port';
import { PaymentKeysService } from './payment-keys.service';
import { PaymentSettingsRepository } from './payment-settings.repository';
import { PAYMENT_MODES } from './payment-settings.types';

/**
 * PaymentSettings' implementation of Payments' `GatewayCredentialsPort`.
 *
 * It owns `payment_credentials` and the cipher, so Payments asks for a key
 * rather than learning where secrets live or how they are encrypted. That is
 * the point of the seam: one door to a credential, and this is behind it.
 */
@Injectable()
export class GatewayCredentialsAdapter extends GatewayCredentialsPort {
  constructor(
    private readonly keys: PaymentKeysService,
    private readonly settings: PaymentSettingsRepository,
  ) {
    super();
  }

  async secretKeyFor(organizationId: number): Promise<string> {
    const row = await this.settings.findOrCreate(organizationId);
    return this.keys.secretFor(organizationId, row.mode);
  }

  /**
   * Both modes' secrets, because the same URL is registered in Stripe's test
   * and live dashboards and each issues its own. Absent ones are dropped rather
   * than passed along as empty strings, which would "verify" nothing but still
   * cost an attempt.
   */
  async webhookIdentityFor(token: string): Promise<WebhookIdentity | null> {
    const row = await this.settings.findByWebhookToken(token);
    if (!row) return null;
    const secrets = await Promise.all(
      PAYMENT_MODES.map((mode) =>
        this.keys.webhookSecretFor(row.organizationId, mode),
      ),
    );
    return {
      organizationId: row.organizationId,
      signingSecrets: secrets.filter((secret): secret is string =>
        Boolean(secret),
      ),
    };
  }
}
