import { Injectable } from '@nestjs/common';
import {
  InvoicePaymentPort,
  type OrderSettlement,
} from '../invoices/ports/invoice-payment.port';
import { PaymentsRepository } from './payments.repository';

/**
 * Payments' implementation of Invoices' `InvoicePaymentPort`. Payments owns the
 * `payments` table, so an invoice learns "paid, by PromptPay, on 14 Jun" by
 * asking rather than by joining across a context boundary.
 */
@Injectable()
export class InvoicePaymentAdapter extends InvoicePaymentPort {
  constructor(private readonly repo: PaymentsRepository) {
    super();
  }

  findSettlement(
    organizationId: number,
    orderId: string,
  ): Promise<OrderSettlement | null> {
    return this.repo.findSettlementForOrder(organizationId, orderId);
  }
}
