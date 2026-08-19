import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { CheckoutModule } from '../checkout/checkout.module';
import { PaymentsModule } from '../payments/payments.module';
import { InvoicesController } from './invoices.controller';
import { InvoicesLedgerService } from './invoices-ledger.service';
import { InvoicesRepository } from './invoices.repository';
import { InvoicesService } from './invoices.service';

/**
 * Invoices: raising, ageing, printing and voiding Thai tax invoices
 * (US-FIN-06/07/08/10). It owns the `invoices` table and the number sequence,
 * and nothing else does.
 *
 * Two facets of one concern: `InvoicesService` changes the legal record (issue,
 * void) while `InvoicesLedgerService` only reports it — a split that matters
 * because the two carry different permissions.
 *
 * It reads two things it does not own, both through consumer-owned ports bound
 * by the module that does:
 *   · `InvoiceOrderPort` (Checkout) — the order being billed, and the VAT that
 *     was actually charged on it.
 *   · `InvoicePaymentPort` (Payments) — how and when that order was settled, so
 *     an invoice for a paid order reads Paid rather than outstanding.
 * `AccessModule` supplies `PermissionsService` for the `PermissionsGuard` that
 * enforces the US-FIN-14 role split. No `forwardRef`: neither Checkout nor
 * Payments needs Invoices back.
 */
@Module({
  imports: [AccessModule, CheckoutModule, PaymentsModule],
  controllers: [InvoicesController],
  providers: [InvoicesService, InvoicesLedgerService, InvoicesRepository],
  exports: [InvoicesService, InvoicesLedgerService],
})
export class InvoicesModule {}
