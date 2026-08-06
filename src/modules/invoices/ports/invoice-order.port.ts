/** The slice of an order an invoice may be raised against. Money is satang. */
export interface BillableOrder {
  id: string;
  organizationId: number;
  reference: string;
  eventId: string;
  eventName: string;
  buyerName: string;
  buyerEmail: string;
  /** VAT-INCLUSIVE — what the buyer actually owes. */
  totalSatang: number;
  /** The VAT embedded in `totalSatang`, as recorded at checkout. */
  vatAmountSatang: number;
  currency: string;
}

/**
 * Invoices' view of the order it bills. Invoices owns the abstraction (DIP);
 * Checkout — which owns the `orders` table — binds the adapter, so Invoices
 * never reads another context's tables.
 */
export abstract class InvoiceOrderPort {
  abstract findBillable(
    organizationId: number,
    orderId: string,
  ): Promise<BillableOrder | null>;
}
