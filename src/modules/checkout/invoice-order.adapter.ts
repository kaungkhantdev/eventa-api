import { Injectable } from '@nestjs/common';
import { CheckoutRepository } from './checkout.repository';
import {
  type BillableOrder,
  InvoiceOrderPort,
} from '../invoices/ports/invoice-order.port';

/**
 * Checkout's implementation of Invoices' `InvoiceOrderPort`. Checkout owns the
 * `orders` table, so the invoice module asks it for the order it bills rather
 * than reading those rows itself.
 *
 * Deliberately tenant-scoped, unlike `OrderPaymentAdapter.findPayable`: an
 * invoice is raised from the organizer console by a signed-in member, so the
 * workspace is already established and an order from another one must not
 * resolve at all.
 */
@Injectable()
export class InvoiceOrderAdapter extends InvoiceOrderPort {
  constructor(private readonly repo: CheckoutRepository) {
    super();
  }

  findBillable(
    organizationId: number,
    orderId: string,
  ): Promise<BillableOrder | null> {
    return this.repo.findBillableOrder(organizationId, orderId);
  }
}
