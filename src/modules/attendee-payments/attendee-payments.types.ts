/** The two states a transaction can show in the history (US-DISC-10). */
export type TransactionStatus = 'paid' | 'refunded';

/** One settled transaction, joined to what the history row shows. */
export interface TransactionRow {
  paymentId: string;
  orderId: string;
  /** The order's own reference. */
  reference: string;
  /**
   * The number of the tax invoice the organizer issued for the order
   * (US-DISC-10) — its live one, else the last one voided. Null when none was
   * ever issued: invoices are raised by the organizer, not at checkout.
   */
  invoiceNumber: string | null;
  eventName: string;
  method: string;
  status: TransactionStatus;
  amountSatang: number;
  vatSatang: number;
  paidAt: Date | null;
}

/** The three summary tiles. Money is integer satang. */
export interface TransactionSummary {
  totalSpentSatang: number;
  totalRefundedSatang: number;
  transactionCount: number;
}

/** Everything a VAT receipt prints, beyond the transaction itself. */
export interface ReceiptRow extends TransactionRow {
  buyerName: string;
  buyerEmail: string;
  organizerName: string;
  organizerAddress: string | null;
  organizerTaxId: string | null;
  /** The workspace's VAT rate at print time, e.g. 0.07. */
  vatRate: number;
}
