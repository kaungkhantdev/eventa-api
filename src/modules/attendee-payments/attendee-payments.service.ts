import { Injectable } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain.exception';
import { Paginated } from '../../common/http/paginated';
import { formatBaht } from '../../common/money/baht';
import { UsersRepository } from '../users/users.repository';
import { AttendeePaymentsRepository } from './attendee-payments.repository';
import type { TransactionRow } from './attendee-payments.types';
import type {
  ListTransactionsDto,
  PaymentSummaryDto,
  TransactionDto,
} from './dto/payment-history.dto';
import { renderReceiptSvg } from './receipt.svg';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const FIRST_PAGE = 1;
const SATANG_PER_BAHT = 100;
const CSV_HEADER = 'date,reference,event,method,status,amount_baht,vat_baht';

/**
 * The attendee's payment history (US-DISC-10): summary tiles, the paged
 * transaction list, a downloadable VAT receipt per transaction, and a CSV
 * export for expensing.
 *
 * Same identity rule as the rest of the portal: everything keys on the
 * signed-in ACCOUNT's email, resolved server-side — never a parameter. Only
 * settled money appears (paid or refunded); attempts that never charged anyone
 * are not transactions. Refunds are struck through by the client and excluded
 * from the spend tile here, so the two can never disagree.
 */
@Injectable()
export class AttendeePaymentsService {
  constructor(
    private readonly repo: AttendeePaymentsRepository,
    private readonly users: UsersRepository,
  ) {}

  async summary(userId: string): Promise<PaymentSummaryDto> {
    const email = await this.requireEmail(userId);
    const totals = await this.repo.summaryByEmail(email);
    return {
      ...totals,
      totalSpentLabel: formatBaht(totals.totalSpentSatang),
      totalRefundedLabel: formatBaht(totals.totalRefundedSatang),
    };
  }

  async history(
    userId: string,
    query: ListTransactionsDto,
  ): Promise<Paginated<TransactionDto>> {
    const email = await this.requireEmail(userId);
    const page = Math.max(FIRST_PAGE, query.page ?? FIRST_PAGE);
    const limit = Math.min(
      MAX_LIMIT,
      Math.max(1, query.limit ?? DEFAULT_LIMIT),
    );
    const { items, total } = await this.repo.transactionsByEmail(email, {
      limit,
      offset: (page - FIRST_PAGE) * limit,
    });
    return Paginated.of(items.map(toDto), total, page, limit);
  }

  /** The printable VAT receipt; a refunded transaction's is marked REFUNDED. */
  async receiptSvg(userId: string, paymentId: string): Promise<string> {
    const email = await this.requireEmail(userId);
    // Ownership by resolution — a receipt that isn't yours isn't found.
    const row = await this.repo.receiptByIdForEmail(paymentId, email);
    if (!row) throw DomainException.notFound("This receipt isn't available.");
    return renderReceiptSvg(row);
  }

  /** The whole history as CSV — "export" means every row, not the current page. */
  async exportCsv(userId: string): Promise<string> {
    const email = await this.requireEmail(userId);
    const rows = await this.repo.allTransactionsByEmail(email);
    return [CSV_HEADER, ...rows.map(toCsvLine)].join('\n') + '\n';
  }

  private async requireEmail(userId: string): Promise<string> {
    const profile = await this.users.findProfile(userId);
    if (!profile) throw DomainException.notFound('Account not found.');
    return profile.user.email;
  }
}

function toDto(row: TransactionRow): TransactionDto {
  return {
    paymentId: row.paymentId,
    reference: row.reference,
    eventName: row.eventName,
    method: row.method,
    status: row.status,
    amountSatang: row.amountSatang,
    amountLabel: formatBaht(row.amountSatang),
    paidAt: row.paidAt?.toISOString() ?? null,
  };
}

function toCsvLine(row: TransactionRow): string {
  return [
    row.paidAt?.toISOString() ?? '',
    row.reference,
    csvField(row.eventName),
    row.method,
    row.status,
    baht(row.amountSatang),
    baht(row.vatSatang),
  ].join(',');
}

/** Integer satang → a plain decimal Baht amount a spreadsheet can sum. */
function baht(satang: number): string {
  return (satang / SATANG_PER_BAHT).toFixed(2);
}

/** Quote a field so a comma or quote in an event name cannot split the row. */
function csvField(value: string): string {
  if (!/[",\n]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}
