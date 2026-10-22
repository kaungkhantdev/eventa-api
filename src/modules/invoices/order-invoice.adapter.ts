import { Injectable } from '@nestjs/common';
import type { Tx } from '../../db/tenant';
import {
  OrderInvoicePort,
  type InvoicePaidInput,
  type InvoiceRefundedInput,
} from '../payments/ports/order-invoice.port';
import { bangkokToday } from './invoice-ageing';
import { InvoicesRepository } from './invoices.repository';
import { REFUND_VOID_REASON } from '../../common/constants/invoices.constants';

/**
 * Invoices' implementation of Payments' `OrderInvoicePort`. Invoices owns the
 * `invoices` table, so Payments keeps an order's invoice in step with its
 * money by asking, never by writing across the boundary.
 */
@Injectable()
export class OrderInvoiceAdapter extends OrderInvoicePort {
  constructor(private readonly repo: InvoicesRepository) {
    super();
  }

  markPaidIn(tx: Tx, input: InvoicePaidInput): Promise<void> {
    return this.repo.markPaidForOrderIn(tx, {
      organizationId: input.organizationId,
      orderId: input.orderId,
      paidVia: input.method,
      paidOn: bangkokToday(input.paidAt),
    });
  }

  voidForRefundIn(tx: Tx, input: InvoiceRefundedInput): Promise<void> {
    return this.repo.voidForRefundIn(tx, {
      organizationId: input.organizationId,
      orderId: input.orderId,
      voidedBy: input.actorUserId,
      voidReason: REFUND_VOID_REASON,
      now: input.now,
    });
  }
}
