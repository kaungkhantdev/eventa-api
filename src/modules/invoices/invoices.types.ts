import { invoiceStatusEnum } from '../../db/schema';

/** Derived from the Drizzle enum so the two can never drift apart. */
export type InvoiceStatus = (typeof invoiceStatusEnum.enumValues)[number];

/** `INV-2026-0001` — sequential per workspace per year, never reused. */
export const INVOICE_NUMBER_PREFIX = 'INV';
export const INVOICE_SEQUENCE_WIDTH = 4;

/** The invoice as the ledger and the document both need it. */
export interface InvoiceRow {
  id: number;
  organizationId: number;
  number: string;
  orderId: string;
  orderReference: string;
  eventId: string;
  eventName: string;
  buyerName: string;
  buyerEmail: string;
  issuedAt: string;
  dueAt: string;
  subtotalSatang: number;
  vatAmountSatang: number;
  amountSatang: number;
  currency: string;
  status: InvoiceStatus;
  paidVia: string | null;
  paidOn: string | null;
  voidReason: string | null;
}

/** Everything the printable tax invoice shows beyond the invoice itself. */
export interface InvoiceDocumentRow extends InvoiceRow {
  sellerName: string;
  sellerAddress: string | null;
  sellerTaxId: string | null;
  vatRate: number;
}

/** How the invoice ledger is narrowed (US-FIN-06). */
export interface InvoiceFilters {
  page: number;
  limit: number;
  status?: InvoiceStatus;
  eventId?: string;
  search?: string;
}

export interface InvoiceCounts {
  issued: number;
  paid: number;
  overdue: number;
  void: number;
}
