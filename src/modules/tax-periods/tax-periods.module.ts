import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { PaymentsModule } from '../payments/payments.module';
import { TaxPeriodsController } from './tax-periods.controller';
import { TaxPeriodsRepository } from './tax-periods.repository';
import { TaxPeriodsService } from './tax-periods.service';

/**
 * Tax periods: the monthly VAT ledger and PP30 filing (US-FIN-11/12). It owns
 * the `tax_periods` table, which holds ONLY filed returns — an open period is
 * recomputed from the payment ledger on every read, so there is no running
 * total to drift out of step with the money.
 *
 * It reads what was collected through `TaxableSalesPort`, which Payments binds;
 * the workspace's VAT rate comes from the tenant row, as elsewhere in the app.
 * `AccessModule` supplies `PermissionsService` for the US-FIN-14 role split.
 */
@Module({
  imports: [AccessModule, PaymentsModule],
  controllers: [TaxPeriodsController],
  providers: [TaxPeriodsService, TaxPeriodsRepository],
  exports: [TaxPeriodsService],
})
export class TaxPeriodsModule {}
