import { Injectable } from '@nestjs/common';
import { Paginated } from '../../common/http/paginated';
import type { AuthContext } from '../auth/auth.types';
import type {
  LedgerFilters,
  LedgerRow,
  StatusCounts,
} from './payments.repository';
import { PaymentsRepository } from './payments.repository';
import type { LedgerEntryDto } from './dto/list-payments.dto';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;

/** Why an action is unavailable, in the words the story asks for. */
const NO_COMPLETED_CHARGE = 'No completed charge yet.';
const NOT_ELIGIBLE = 'This attempt failed, so it is not eligible for refund.';
const ALREADY_REFUNDED = 'This payment was already refunded.';

export interface Ledger {
  page: Paginated<LedgerEntryDto>;
  counts: StatusCounts;
}

/**
 * The finance ledger (US-FIN-01): every charge, refund and failed attempt, with
 * the filters an organizer reconciles by.
 *
 * Two things the story pins down that are easy to get subtly wrong:
 *
 * - **The status counts cover the whole ledger, not the page.** They drive
 *   tabs, so counting the current page would make them change as you paginate.
 *   The other filters (search, method, event) DO apply, so the tabs always
 *   describe the same set the list is drawn from.
 * - **Each row says what it allows and why not.** "Refund" and "View invoice"
 *   have to be unavailable with a reason on pending and failed rows, so the
 *   reason belongs in the payload rather than being re-derived by the client —
 *   the server decides eligibility, and a hidden button is not authorization.
 */
@Injectable()
export class PaymentsLedgerService {
  constructor(private readonly repo: PaymentsRepository) {}

  async list(
    auth: AuthContext,
    query: Record<string, unknown>,
  ): Promise<Ledger> {
    const filters = toFilters(query);
    const [{ items, total }, counts] = await Promise.all([
      this.repo.listLedger(auth.organizationId, filters),
      // Deliberately without `status`: the tabs count every status.
      this.repo.countByStatus(auth.organizationId, withoutStatus(filters)),
    ]);
    return {
      page: Paginated.of(
        items.map(toEntry),
        total,
        filters.page,
        filters.limit,
      ),
      counts,
    };
  }
}

function toFilters(query: Record<string, unknown>): LedgerFilters {
  return {
    page: (query.page as number) ?? DEFAULT_PAGE,
    limit: (query.limit as number) ?? DEFAULT_LIMIT,
    status: query.status as LedgerFilters['status'],
    method: query.method as LedgerFilters['method'],
    eventId: query.eventId as string | undefined,
    search: query.search as string | undefined,
  };
}

function withoutStatus(filters: LedgerFilters): Omit<LedgerFilters, 'status'> {
  return {
    page: filters.page,
    limit: filters.limit,
    method: filters.method,
    eventId: filters.eventId,
    search: filters.search,
  };
}

/** A completed charge is the only thing with an invoice or a refund behind it. */
function toEntry(row: LedgerRow): LedgerEntryDto {
  const settled = row.status === 'paid' || row.status === 'refunded';
  return {
    id: row.id,
    txn: row.txn,
    payerName: row.payerName,
    eventName: row.eventName,
    method: row.method,
    amountSatang: row.amountSatang,
    currency: row.currency,
    status: row.status,
    paidAt: row.paidAt?.toISOString() ?? null,
    canViewInvoice: settled,
    canRefund: row.status === 'paid',
    refundBlockedReason: refundBlockedReason(row.status),
  };
}

function refundBlockedReason(status: LedgerRow['status']): string | null {
  if (status === 'paid') return null;
  if (status === 'refunded') return ALREADY_REFUNDED;
  if (status === 'failed') return NOT_ELIGIBLE;
  return NO_COMPLETED_CHARGE;
}
