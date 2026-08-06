import type { InvoiceStatus } from './invoices.types';

/** Thai invoice terms are fixed at 14 days from issue (US-FIN-06/07). */
export const INVOICE_TERM_DAYS = 14;

const BANGKOK = 'Asia/Bangkok';
/** `en-CA` formats as `YYYY-MM-DD`, which is what a `date` column stores. */
const ISO_DATE_LOCALE = 'en-CA';
const MS_PER_DAY = 86_400_000;

export interface Ageing {
  /** What the row actually reads as once its due date is taken into account. */
  status: InvoiceStatus;
  /** Days from today to the due date; negative once overdue (−3 = 3 days late). */
  daysUntilDue: number;
}

/**
 * Today's calendar date in Bangkok. Ageing is judged on the organizer's day,
 * not UTC's — at 23:00 in Bangkok it is still yesterday in London, and an
 * invoice must not tip to Overdue seven hours early.
 */
export function bangkokToday(now: Date): string {
  return now.toLocaleDateString(ISO_DATE_LOCALE, { timeZone: BANGKOK });
}

/** The due date 14 days after an issue date, both as `YYYY-MM-DD`. */
export function dueDateFor(issuedAt: string): string {
  const due = new Date(`${issuedAt}T00:00:00Z`);
  due.setUTCDate(due.getUTCDate() + INVOICE_TERM_DAYS);
  return due.toISOString().slice(0, 10);
}

/**
 * How an invoice reads today (US-FIN-06). Overdue is DERIVED from the due date
 * rather than written by a nightly job: a stored flag is wrong for the hours
 * between midnight and whenever the job runs, and the ledger must never show a
 * bill as current when the organizer would call it late.
 *
 * Paid and Void are terminal — settling a debt late, or cancelling it, stops
 * the clock; only an outstanding invoice can age.
 */
export function ageInvoice(
  stored: InvoiceStatus,
  dueAt: string,
  today: string,
): Ageing {
  const daysUntilDue = Math.round(
    (Date.parse(`${dueAt}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) /
      MS_PER_DAY,
  );
  if (stored === 'paid' || stored === 'void') {
    return { status: stored, daysUntilDue };
  }
  return { status: daysUntilDue < 0 ? 'overdue' : 'issued', daysUntilDue };
}
