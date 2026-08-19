import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { PaymentSettingsModule } from '../payment-settings/payment-settings.module';
import { PaymentsModule } from '../payments/payments.module';
import { PayoutsController } from './payouts.controller';
import { PayoutsRepository } from './payouts.repository';
import { PayoutsService } from './payouts.service';

/**
 * Payouts: balances, settlement history, and recovering a failed transfer
 * (US-FIN-03/04/05). It owns the `payouts` and `payout_items` tables.
 *
 * It reads two things it does not own, through consumer-owned ports:
 *   · `SettledFundsPort` (Payments) — what has actually been collected, net of
 *     refunds, which is the ceiling on what can be paid out.
 *   · `PayoutAccountPort` (PaymentSettings) — whether a payout account is
 *     connected, and which one.
 * `PaymentProviderPort` is the provider seam it shares with Payments: the
 * hosted settings link and the re-submitted transfer both go through it, so no
 * bank detail ever enters this service.
 */
@Module({
  imports: [AccessModule, PaymentsModule, PaymentSettingsModule],
  controllers: [PayoutsController],
  providers: [PayoutsService, PayoutsRepository],
  exports: [PayoutsService],
})
export class PayoutsModule {}
