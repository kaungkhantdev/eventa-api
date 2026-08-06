import { Injectable } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain.exception';
import { Clock } from '../../common/time/clock';
import type { AuthContext } from '../auth/auth.types';
import { bangkokToday } from '../invoices/invoice-ageing';
import { TaxableSalesPort } from './ports/taxable-sales.port';
import { TaxPeriodsRepository } from './tax-periods.repository';
import type {
  FiledPeriod,
  TaxPeriodRow,
  VatHeadlines,
} from './tax-periods.types';
import {
  MONTHS_IN_YEAR,
  isLateFiling,
  monthLabel,
  periodDueDate,
  periodStatus,
  vatOnSales,
} from './vat-period';

export interface ListPeriodsQuery {
  year: number;
  status?: TaxPeriodRow['status'];
}

export interface FilePeriodInput {
  year: number;
  month: number;
  /** Withholding tax reconciled for this period (Thai PND); optional. */
  whtSatang?: number;
}

const NOT_DUE =
  'Only a period that has ended can be filed — this one is still running.';
const ALREADY_FILED = 'This period has already been filed.';
const BAD_MONTH = 'Month must be between 1 and 12.';

/**
 * The monthly VAT ledger (US-FIN-11) and recording a PP30 filing (US-FIN-12).
 *
 * Open periods are COMPUTED from what the payment ledger actually collected, so
 * a refund settled today corrects this month's position with no reconciliation
 * step. Filed periods are FROZEN at the figures that were filed: a return that
 * has gone to the Revenue Department must never silently change afterwards, and
 * because takings are dated by when the money moved, a later refund lands in
 * the next open period on its own.
 */
@Injectable()
export class TaxPeriodsService {
  constructor(
    private readonly repo: TaxPeriodsRepository,
    private readonly sales: TaxableSalesPort,
    private readonly clock: Clock,
  ) {}

  async list(
    auth: AuthContext,
    query: ListPeriodsQuery,
  ): Promise<{ rows: TaxPeriodRow[]; headlines: VatHeadlines }> {
    const all = await this.yearRows(auth.organizationId, query.year);
    return {
      rows: query.status ? all.filter((r) => r.status === query.status) : all,
      // The headline is the YEAR's tax position, so it is computed before the
      // status filter — filtering to "Due" must not make it look like less is
      // owed than actually is.
      headlines: headlinesOf(all),
    };
  }

  async file(auth: AuthContext, input: FilePeriodInput): Promise<TaxPeriodRow> {
    if (input.month < 1 || input.month > MONTHS_IN_YEAR) {
      throw DomainException.validation(BAD_MONTH);
    }
    const rows = await this.yearRows(auth.organizationId, input.year);
    const period = rows[input.month - 1];
    if (period.status === 'filed') {
      throw DomainException.conflict(ALREADY_FILED);
    }
    if (period.status !== 'due') throw DomainException.conflict(NOT_DUE);
    const now = this.clock.now();
    const filed: FiledPeriod = {
      year: input.year,
      month: input.month,
      salesSatang: period.salesSatang,
      vatSatang: period.vatSatang,
      whtSatang: input.whtSatang ?? 0,
      // Recording the filing IS remitting it — the figure is never keyed by
      // hand, so it cannot disagree with the return that was submitted.
      remittedSatang: period.vatSatang,
      filedAt: now,
    };
    await this.repo.recordFiling(auth.organizationId, filed);
    return this.toRow(input.year, input.month, filed, bangkokToday(now));
  }

  /** Every month of the year, filed ones frozen and the rest computed. */
  private async yearRows(
    organizationId: number,
    year: number,
  ): Promise<TaxPeriodRow[]> {
    const today = bangkokToday(this.clock.now());
    const [rate, filed, takings] = await Promise.all([
      this.repo.vatRate(organizationId),
      this.repo.filedPeriods(organizationId, year),
      this.sales.totalsByMonth(organizationId, year),
    ]);
    const filedByMonth = new Map(filed.map((f) => [f.month, f]));
    const grossByMonth = new Map(takings.map((t) => [t.month, t.grossSatang]));
    return Array.from({ length: MONTHS_IN_YEAR }, (_, i) => {
      const month = i + 1;
      const frozen = filedByMonth.get(month);
      if (frozen) return this.toRow(year, month, frozen, today);
      const { salesSatang, vatSatang } = vatOnSales(
        grossByMonth.get(month) ?? 0,
        rate,
      );
      return {
        year,
        month,
        period: monthLabel(month),
        dueAt: periodDueDate(year, month),
        salesSatang,
        vatSatang,
        whtSatang: 0,
        remittedSatang: 0,
        status: periodStatus(year, month, today, false),
        filedAt: null,
        late: false,
      };
    });
  }

  private toRow(
    year: number,
    month: number,
    filed: FiledPeriod,
    today: string,
  ): TaxPeriodRow {
    return {
      year,
      month,
      period: monthLabel(month),
      dueAt: periodDueDate(year, month),
      salesSatang: filed.salesSatang,
      vatSatang: filed.vatSatang,
      whtSatang: filed.whtSatang,
      remittedSatang: filed.remittedSatang,
      status: periodStatus(year, month, today, true),
      filedAt: filed.filedAt,
      late: isLateFiling(bangkokToday(filed.filedAt), year, month),
    };
  }
}

/** Payable is always collected − remitted, over the same rows shown. */
function headlinesOf(rows: TaxPeriodRow[]): VatHeadlines {
  const sum = (pick: (r: TaxPeriodRow) => number) =>
    rows.reduce((total, r) => total + pick(r), 0);
  const vatCollectedSatang = sum((r) => r.vatSatang);
  const vatRemittedSatang = sum((r) => r.remittedSatang);
  return {
    vatCollectedSatang,
    vatRemittedSatang,
    vatPayableSatang: vatCollectedSatang - vatRemittedSatang,
    withholdingSatang: sum((r) => r.whtSatang),
  };
}
