/** The invoices module's named constants. */

export const DEFAULT_LIMIT = 20;

export const MAX_LIMIT = 100;

export const MAX_SEARCH = 120;

export const MAX_REASON = 500;

/** Thai invoice terms are fixed at 14 days from issue (US-FIN-06/07). */
export const INVOICE_TERM_DAYS = 14;

export const BANGKOK = 'Asia/Bangkok';

/** `en-CA` formats as `YYYY-MM-DD`, which is what a `date` column stores. */
export const ISO_DATE_LOCALE = 'en-CA';

export const MS_PER_DAY = 86_400_000;

/** A4 portrait at 72dpi, so it prints as exactly one page. */
export const INVOICE_PAGE_WIDTH = 595;

export const INVOICE_PAGE_HEIGHT = 842;

/** Where the invoice's text starts, and where right-aligned text ends. */
export const INVOICE_LEFT_X = 56;

export const INVOICE_RIGHT_X = INVOICE_PAGE_WIDTH - 56;

export const PERCENT = 100;

/** A hard ceiling on one export, so a huge workspace cannot exhaust memory. */
export const EXPORT_LIMIT = 10_000;

export const NOTHING_TO_EXPORT =
  'There is nothing to export — no invoices match these filters.';

export const EXPORT_HEADER = [
  'invoice_number',
  'issued_at',
  'due_at',
  'days_until_due',
  'buyer_name',
  'buyer_email',
  'event',
  'order_reference',
  'subtotal_baht',
  'vat_baht',
  'total_baht',
  'currency',
  'status',
  'paid_via',
  'paid_on',
];

/** The invoice list's hint for why Void is disabled on a paid row. */
export const VOID_BLOCKED_PAID_HINT =
  'Paid — void it by refunding the payment.';

/** The invoice list's hint for why Void is disabled on a void row. */
export const VOID_BLOCKED_VOID_HINT = 'Already void.';

export const AUDIT_TYPE = 'invoice' as const;

export const DEFAULT_VAT_RATE = 0.07;

export const NO_AMOUNT =
  'This order has nothing to bill — an invoice needs a positive amount.';

export const NO_BUYER_EMAIL =
  'This order has no buyer email, so the invoice has nobody to bill.';

/** The 409 for voiding a paid invoice. */
export const VOID_PAID =
  'A paid invoice cannot be voided — refund its payment instead, which voids it.';

/** The 409 for voiding an invoice twice. */
export const ALREADY_VOID = 'This invoice is already void.';

/** `INV-2026-0001` — sequential per workspace per year, never reused. */
export const INVOICE_NUMBER_PREFIX = 'INV';

export const INVOICE_SEQUENCE_WIDTH = 4;

/** Why an invoice voided by its sale's refund reads Void (US-FIN-02). */
export const REFUND_VOID_REASON = 'Refunded';
