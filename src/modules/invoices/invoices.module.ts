import { Module, forwardRef } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { CheckoutModule } from '../checkout/checkout.module';
import { PaymentsModule } from '../payments/payments.module';
import { OrderInvoicePort } from '../payments/ports/order-invoice.port';
import { InvoicesController } from './invoices.controller';
import { InvoicesLedgerService } from './invoices-ledger.service';
import { InvoicesRepository } from './invoices.repository';
import { InvoicesService } from './invoices.service';
import { OrderInvoiceAdapter } from './order-invoice.adapter';

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
 * enforces the US-FIN-14 role split.
 *
 * It binds Payments' `OrderInvoicePort` in turn: an invoice issued before its
 * order was paid must turn Paid when the money lands, and a refunded sale's
 * invoice must turn Void (US-FIN-02, US-FIN-06/07), both inside Payments' own
 * transaction. That makes Invoices ↔ Payments a genuine two-way dependency —
 * each asks the other about the half it owns — hence the `forwardRef`.
 * Checkout does not need Invoices back.
 */
@Module({
  imports: [AccessModule, CheckoutModule, forwardRef(() => PaymentsModule)],
  controllers: [InvoicesController],
  providers: [
    InvoicesService,
    InvoicesLedgerService,
    InvoicesRepository,
    { provide: OrderInvoicePort, useClass: OrderInvoiceAdapter },
  ],
  exports: [InvoicesService, InvoicesLedgerService, OrderInvoicePort],
})
export class InvoicesModule {}
