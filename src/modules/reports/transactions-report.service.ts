import { Injectable } from '@nestjs/common';
import { Clock } from '../../common/time/clock';
import {
  DEFAULT_REPORT_LIMIT,
  type ReportFilterQueryDto,
} from './dto/report-filter.query.dto';
import {
  TransactionLedgerPort,
  type LedgerEntry,
  type LedgerTotals,
} from './ports/transaction-ledger.port';
import { resolveReportPeriod, type ReportPeriod } from './reports-period';

/**
 * The transaction ledger (US-RPT-06).
 *
 * A ledger, so this service changes nothing and computes almost nothing: the
 * rows arrive from Payments already merged, and the amounts stay positive with
 * their direction carried by `kind`. The screen adds the minus sign, because a
 * ledger holding negatives makes every sum a trap.
 *
 * The one figure worked out here is the success rate, which the story defines
 * precisely — successful charges over ATTEMPTED ones, so a failure counts
 * against it even though its money is excluded from the takings.
 */

export interface TransactionTotalsView extends LedgerTotals {
  /** Percent of charges that succeeded. Null when none were attempted. */
  successRate: number | null;
}

export interface TransactionsReportView {
  period: ReportPeriod;
  rows: LedgerEntry[];
  matchedEntries: number;
  totals: TransactionTotalsView;
}

const PERCENT = 100;

@Injectable()
export class TransactionsReportService {
  constructor(
    private readonly ledger: TransactionLedgerPort,
    private readonly clock: Clock,
  ) {}

  async load(
    organizationId: number,
    filter: ReportFilterQueryDto,
  ): Promise<TransactionsReportView> {
    const period = resolveReportPeriod(filter, this.clock.now());

    const page = await this.ledger.ledger(organizationId, {
      from: period.from,
      to: period.to,
      eventId: filter.eventId,
      search: filter.q,
      page: filter.page ?? 1,
      limit: filter.limit ?? DEFAULT_REPORT_LIMIT,
    });

    return {
      period,
      rows: page.rows,
      matchedEntries: page.matchedEntries,
      totals: { ...page.totals, successRate: successRateOf(page.totals) },
    };
  }
}

/**
 * Successful charges over attempted ones.
 *
 * Refunds are not in the denominator: a reversal is not an attempt at anything,
 * and counting it would make a well-run event with generous refunds look like
 * it had a payment problem. Null rather than zero when nothing was attempted —
 * a window holding only refunds has no rate, and 0% would read as "everything
 * failed".
 */
function successRateOf(totals: LedgerTotals): number | null {
  const attempts = totals.payments + totals.failed;
  if (attempts === 0) return null;
  return Math.round((totals.payments / attempts) * PERCENT);
}
