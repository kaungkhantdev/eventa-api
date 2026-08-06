import { Injectable } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain.exception';
import { Clock } from '../../common/time/clock';
import type { AuthContext } from '../auth/auth.types';
import type { InvoiceDetailDto } from './dto/list-invoices.dto';
import { bangkokToday, dueDateFor } from './invoice-ageing';
import { toInvoiceDetail } from './invoices.mapper';
import { InvoicesRepository } from './invoices.repository';
import { InvoiceOrderPort } from './ports/invoice-order.port';
import { InvoicePaymentPort } from './ports/invoice-payment.port';

const NO_AMOUNT =
  'This order has nothing to bill — an invoice needs a positive amount.';
const NO_BUYER_EMAIL =
  'This order has no buyer email, so the invoice has nobody to bill.';
const VOID_PAID =
  'A paid invoice cannot be voided — refund its payment instead, which voids it.';
const ALREADY_VOID = 'This invoice is already void.';

/**
 * Issuing and voiding tax invoices (US-FIN-07, US-FIN-10).
 *
 * A Thai tax invoice is a legal document, which drives two rules that look
 * unusual next to ordinary CRUD:
 *
 * - **Figures are reproduced, never recomputed.** The VAT is the amount charged
 *   at checkout and recorded on the order. Recomputing it here would let a
 *   later change to the workspace's VAT rate silently restate tax that was
 *   already collected at the old one.
 * - **Nothing is edited and nothing is deleted.** A correction is a void plus a
 *   brand-new invoice, so the number sequence stays unbroken and auditable.
 */
@Injectable()
export class InvoicesService {
  constructor(
    private readonly repo: InvoicesRepository,
    private readonly orders: InvoiceOrderPort,
    private readonly payments: InvoicePaymentPort,
    private readonly clock: Clock,
  ) {}

  /**
   * Raise the invoice for an order. Idempotent by construction: the partial
   * unique index on a live `order_id` means a second attempt finds the first
   * invoice instead of burning another number from the sequence.
   */
  async issue(
    auth: AuthContext,
    input: { orderId: string },
  ): Promise<InvoiceDetailDto> {
    const order = await this.requireBillable(auth, input.orderId);
    const settlement = await this.payments.findSettlement(
      auth.organizationId,
      order.id,
    );
    const issuedAt = bangkokToday(this.clock.now());
    const { invoice } = await this.repo.issue({
      organizationId: auth.organizationId,
      orderId: order.id,
      eventId: order.eventId,
      buyerName: order.buyerName,
      buyerEmail: order.buyerEmail,
      issuedAt,
      dueAt: dueDateFor(issuedAt),
      subtotalSatang: order.totalSatang - order.vatAmountSatang,
      vatAmountSatang: order.vatAmountSatang,
      amountSatang: order.totalSatang,
      currency: order.currency,
      status: settlement ? 'paid' : 'issued',
      paidVia: settlement?.method ?? null,
      paidOn: settlement?.paidOn ?? null,
      actorUserId: auth.userId,
    });
    return toInvoiceDetail(invoice, issuedAt);
  }

  /** Void an invoice raised in error; its number is retired, never reused. */
  async voidInvoice(
    auth: AuthContext,
    invoiceId: number,
    reason?: string,
  ): Promise<InvoiceDetailDto> {
    const invoice = await this.repo.findById(auth.organizationId, invoiceId);
    if (!invoice) throw DomainException.notFound('Invoice not found.');
    if (invoice.status === 'paid') throw DomainException.conflict(VOID_PAID);
    if (invoice.status === 'void') throw DomainException.conflict(ALREADY_VOID);
    const voided = await this.repo.markVoid(auth.organizationId, invoiceId, {
      voidedBy: auth.userId,
      voidReason: reason ?? null,
      now: this.clock.now(),
    });
    return toInvoiceDetail(voided, bangkokToday(this.clock.now()));
  }

  private async requireBillable(auth: AuthContext, orderId: string) {
    const order = await this.orders.findBillable(auth.organizationId, orderId);
    if (!order) throw DomainException.notFound('Order not found.');
    if (order.totalSatang <= 0) throw DomainException.validation(NO_AMOUNT);
    if (!order.buyerEmail) throw DomainException.validation(NO_BUYER_EMAIL);
    return order;
  }
}
