/** How and when an order's money actually landed. */
export interface OrderSettlement {
  /** A `payment_method` value — Card, PromptPay, Bank transfer, … */
  method: string;
  /** The Bangkok calendar date it cleared, `YYYY-MM-DD`. */
  paidOn: string;
}

/**
 * Invoices' view of the payment behind an order — what makes an invoice read
 * "Paid, by PromptPay, on 14 Jun" rather than merely outstanding (US-FIN-07).
 * Payments owns the `payments` table and binds the adapter.
 */
export abstract class InvoicePaymentPort {
  /** The settled payment for this order, or null while nothing has cleared. */
  abstract findSettlement(
    organizationId: number,
    orderId: string,
  ): Promise<OrderSettlement | null>;
}
