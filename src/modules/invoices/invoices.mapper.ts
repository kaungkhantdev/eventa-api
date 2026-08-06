import { formatBaht } from '../../common/money/baht';
import { ageInvoice } from './invoice-ageing';
import type {
  InvoiceDetailDto,
  InvoiceEntryDto,
} from './dto/list-invoices.dto';
import type { InvoiceRow } from './invoices.types';

const VOID_PAID = 'Paid — void it by refunding the payment.';
const VOID_ALREADY = 'Already void.';

/**
 * One ledger row (US-FIN-06). The status is the AGED one, so a bill whose term
 * has run out reads Overdue without a nightly job having to rewrite it; the
 * `canVoid`/`voidBlockedReason` pair states server-side what the console may
 * offer, rather than letting the UI guess.
 */
export function toInvoiceEntry(
  row: InvoiceRow,
  today: string,
): InvoiceEntryDto {
  const { status, daysUntilDue } = ageInvoice(row.status, row.dueAt, today);
  return {
    id: row.id,
    number: row.number,
    orderReference: row.orderReference,
    eventId: row.eventId,
    eventName: row.eventName,
    buyerName: row.buyerName,
    buyerEmail: row.buyerEmail,
    issuedAt: row.issuedAt,
    dueAt: row.dueAt,
    daysUntilDue,
    subtotalSatang: row.subtotalSatang,
    vatAmountSatang: row.vatAmountSatang,
    amountSatang: row.amountSatang,
    amountLabel: formatBaht(row.amountSatang),
    currency: row.currency,
    status,
    paidVia: row.paidVia,
    paidOn: row.paidOn,
    canVoid: status === 'issued' || status === 'overdue',
    voidBlockedReason: voidBlockedReason(status),
  };
}

export function toInvoiceDetail(
  row: InvoiceRow,
  today: string,
): InvoiceDetailDto {
  return {
    ...toInvoiceEntry(row, today),
    orderId: row.orderId,
    voidReason: row.voidReason,
  };
}

function voidBlockedReason(status: InvoiceEntryDto['status']): string | null {
  if (status === 'paid') return VOID_PAID;
  if (status === 'void') return VOID_ALREADY;
  return null;
}
