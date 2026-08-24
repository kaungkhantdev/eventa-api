import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Clock } from '../../common/time/clock';
import type { Env } from '../../config/env.validation';
import { AccessModule } from '../access/access.module';
import { OrganizationModule } from '../organization/organization.module';
import { OrganizationService } from '../organization/organization.service';
import { TicketingModule } from '../ticketing/ticketing.module';
import { GatewayCredentialsPort } from '../payments/ports/gateway-credentials.port';
import { MerchantAccountPort } from '../payments/ports/merchant-account.port';
import { PayoutAccountPort } from '../payouts/ports/payout-account.port';
import { GatewayCredentialsAdapter } from './gateway-credentials.adapter';
import { MerchantAccountAdapter } from './merchant-account.adapter';
import { SecretCipher } from '../../common/crypto/secret-cipher';
import { PaymentCredentialsRepository } from './payment-credentials.repository';
import { PaymentKeysService } from './payment-keys.service';
import { PaymentMethodsService } from './payment-methods.service';
import { PayoutAccountAdapter } from './payout-account.adapter';
import { PaymentSettingsController } from './payment-settings.controller';
import { PaymentSettingsRepository } from './payment-settings.repository';
import { PaymentSettingsService } from './payment-settings.service';
import { PaymentSetupPort } from '../dashboard/ports/workspace-setup.port';
import { PaymentSetupAdapter } from './payment-setup.adapter';
import { PaymentProviderPort } from './ports/payment-provider.port';
import { StripeAccountAdapter } from './providers/stripe-account.adapter';

/**
 * Settings → Payments (US-SET-08/09/10): the workspace's payment connection,
 * which methods checkout offers, and the receipt/statement preferences.
 *
 * Depends on service interfaces only — OrganizationService for the workspace
 * currency, and TicketSalesPort (implemented by Ticketing) to know whether paid
 * tickets are sold before letting the last payment method be switched off.
 *
 * It also binds the two ports OTHER modules use to read this row: whose account
 * a charge is made on (`MerchantAccountPort`), and whether the workspace can be
 * paid out (`PayoutAccountPort`). Both are consumer-owned, so this module
 * supplies the answer without either caller touching `payment_settings`.
 */
@Module({
  imports: [AccessModule, OrganizationModule, TicketingModule],
  controllers: [PaymentSettingsController],
  providers: [
    {
      provide: PaymentSettingsService,
      useFactory: (
        repo: PaymentSettingsRepository,
        organization: OrganizationService,
        clock: Clock,
        config: ConfigService<Env, true>,
      ) =>
        new PaymentSettingsService(
          repo,
          organization,
          clock,
          config.getOrThrow('PUBLIC_API_URL', { infer: true }),
          config.getOrThrow('NODE_ENV', { infer: true }),
        ),
      inject: [
        PaymentSettingsRepository,
        OrganizationService,
        Clock,
        ConfigService,
      ],
    },
    {
      provide: PaymentKeysService,
      useFactory: (
        credentials: PaymentCredentialsRepository,
        settings: PaymentSettingsRepository,
        provider: PaymentProviderPort,
        cipher: SecretCipher,
        clock: Clock,
        config: ConfigService<Env, true>,
      ) =>
        new PaymentKeysService(
          credentials,
          settings,
          provider,
          cipher,
          clock,
          config.getOrThrow('NODE_ENV', { infer: true }),
        ),
      inject: [
        PaymentCredentialsRepository,
        PaymentSettingsRepository,
        PaymentProviderPort,
        SecretCipher,
        Clock,
        ConfigService,
      ],
    },
    PaymentMethodsService,
    PaymentSettingsRepository,
    PaymentCredentialsRepository,
    SecretCipher,
    {
      provide: PaymentProviderPort,
      // A factory, not `useClass`: the adapter takes an optional client
      // factory so a test can supply its own, and Nest would try to resolve
      // that as a dependency. Same reason as PaymentsModule's provider.
      useFactory: () => new StripeAccountAdapter(),
    },
    { provide: PayoutAccountPort, useClass: PayoutAccountAdapter },
    { provide: MerchantAccountPort, useClass: MerchantAccountAdapter },
    { provide: GatewayCredentialsPort, useClass: GatewayCredentialsAdapter },
    { provide: PaymentSetupPort, useClass: PaymentSetupAdapter },
  ],
  exports: [
    PaymentSettingsService,
    {
      provide: PaymentKeysService,
      useFactory: (
        credentials: PaymentCredentialsRepository,
        settings: PaymentSettingsRepository,
        provider: PaymentProviderPort,
        cipher: SecretCipher,
        clock: Clock,
        config: ConfigService<Env, true>,
      ) =>
        new PaymentKeysService(
          credentials,
          settings,
          provider,
          cipher,
          clock,
          config.getOrThrow('NODE_ENV', { infer: true }),
        ),
      inject: [
        PaymentCredentialsRepository,
        PaymentSettingsRepository,
        PaymentProviderPort,
        SecretCipher,
        Clock,
        ConfigService,
      ],
    },
    PayoutAccountPort,
    MerchantAccountPort,
    GatewayCredentialsPort,
    PaymentSetupPort,
  ],
})
export class PaymentSettingsModule {}
