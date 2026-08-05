/** The two states a transaction can show in the history (US-DISC-10). */
export type TransactionStatus = 'paid' | 'refunded';

/** One settled transaction, joined to what the history row shows. */
export interface TransactionRow {
  paymentId: string;
  orderId: string;
  /** The order reference doubles as the invoice number until E9 mints its own. */
  reference: string;
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
