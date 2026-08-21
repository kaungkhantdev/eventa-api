import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { OrganizationModule } from '../organization/organization.module';
import { TicketingModule } from '../ticketing/ticketing.module';
import { PayoutAccountPort } from '../payouts/ports/payout-account.port';
import { PaymentMethodsService } from './payment-methods.service';
import { PayoutAccountAdapter } from './payout-account.adapter';
import { PaymentSettingsController } from './payment-settings.controller';
import { PaymentSettingsRepository } from './payment-settings.repository';
import { PaymentSettingsService } from './payment-settings.service';
import { PaymentSetupPort } from '../dashboard/ports/workspace-setup.port';
import { PaymentSetupAdapter } from './payment-setup.adapter';
import { PaymentProviderPort } from './ports/payment-provider.port';
import { StubPaymentProvider } from './stub-payment.provider';

/**
 * Settings → Payments (US-SET-08/09/10): the workspace's payment connection,
 * which methods checkout offers, and the receipt/statement preferences.
 *
 * Depends on service interfaces only — OrganizationService for the workspace
 * currency, and TicketSalesPort (implemented by Ticketing) to know whether paid
 * tickets are sold before letting the last payment method be switched off.
 * PaymentProviderPort is bound to a dev provider; swap the useClass for a real
 * Stripe adapter without touching a caller.
 */
@Module({
  imports: [AccessModule, OrganizationModule, TicketingModule],
  controllers: [PaymentSettingsController],
  providers: [
    PaymentSettingsService,
    PaymentMethodsService,
    PaymentSettingsRepository,
    { provide: PaymentProviderPort, useClass: StubPaymentProvider },
    { provide: PayoutAccountPort, useClass: PayoutAccountAdapter },
    { provide: PaymentSetupPort, useClass: PaymentSetupAdapter },
  ],
  exports: [PaymentSettingsService, PayoutAccountPort, PaymentSetupPort],
})
export class PaymentSettingsModule {}
